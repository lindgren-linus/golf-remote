using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using GolfRemote.Agent.Core;
using GolfRemote.Agent.Protocol;
using GolfRemote.Agent.Windows;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using WireProtocol = GolfRemote.Agent.Protocol.Protocol;

namespace GolfRemote.Agent.Server;

public sealed class AgentWebSocketServer
{
    private readonly IDisplayProvider _displays;
    private readonly PointerController _pointer;
    private readonly PairingStore _pairings;
    private readonly IPairingApproval _pairingApproval;

    public AgentWebSocketServer(IDisplayProvider displays, PointerController pointer, PairingStore pairings, IPairingApproval pairingApproval)
    {
        _displays = displays;
        _pointer = pointer;
        _pairings = pairings;
        _pairingApproval = pairingApproval;
    }

    public async Task RunAsync(int port, CancellationToken cancellationToken)
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
        var app = builder.Build();
        app.UseWebSockets();
        app.Map("/ws", HandleConnectionAsync);
        Console.WriteLine($"Golf Remote agent listens on ws://0.0.0.0:{port}/ws");
        await app.StartAsync(cancellationToken);
        try
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        }
        finally
        {
            await app.StopAsync(CancellationToken.None);
        }
    }

    private async Task HandleConnectionAsync(HttpContext context)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        Console.WriteLine($"Client connected: {context.Connection.RemoteIpAddress}");
        var sequenceGate = new MoveSequenceGate();
        var authenticated = false;

        try
        {
            while (socket.State == WebSocketState.Open)
            {
                var text = await ReceiveTextAsync(socket, context.RequestAborted);
                if (text is null)
                {
                    break;
                }

                var message = WireProtocol.Parse(text);
                if (message is null || message.Version != WireProtocol.Version)
                {
                    await SendAsync(socket, "protocol.error", new { message = "Ogiltigt protokollmeddelande." }, context.RequestAborted);
                    continue;
                }

                authenticated = await HandleMessageAsync(socket, message, sequenceGate, authenticated, context.RequestAborted);
            }
        }
        catch (WebSocketException)
        {
            // Anslutningen kan brytas när mobilen går i bakgrunden.
        }
        finally
        {
            Console.WriteLine($"Client disconnected: {context.Connection.RemoteIpAddress}");
        }
    }

    private async Task<bool> HandleMessageAsync(WebSocket socket, Envelope message, MoveSequenceGate sequenceGate, bool authenticated, CancellationToken cancellationToken)
    {
        if (!authenticated && message.Type is not "client.hello" and not "client.pair.request" and not "connection.ping")
        {
            await SendAuthenticationRequiredAsync(socket, cancellationToken);
            return false;
        }

        switch (message.Type)
        {
            case "client.hello":
                if (!TryGetString(message.Payload, "clientId", out var clientId) || !TryGetString(message.Payload, "token", out var token) || !_pairings.IsAuthorized(clientId, token))
                {
                    await SendAuthenticationRequiredAsync(socket, cancellationToken);
                    return false;
                }
                await SendAsync(socket, "auth.authenticated", new { agentId = AgentIdentity.DeviceId }, cancellationToken);
                await SendDisplayListAsync(socket, cancellationToken);
                var defaultDisplay = _displays.GetDisplays().FirstOrDefault();
                if (defaultDisplay is not null)
                {
                    _pointer.SelectDisplay(defaultDisplay);
                    await SendAsync(socket, "display.selected", new { displayId = defaultDisplay.Id }, cancellationToken);
                }
                return true;

            case "client.pair.request":
                if (!TryGetString(message.Payload, "clientId", out var requestedClientId) || !TryGetString(message.Payload, "clientName", out var clientName) || requestedClientId.Length is > 128 or 0 || clientName.Length is > 64 or 0)
                {
                    await SendAsync(socket, "protocol.error", new { message = "Ogiltig parkopplingsbegäran." }, cancellationToken);
                    return false;
                }
                try
                {
                    var approved = await _pairingApproval.RequestAsync(clientName, cancellationToken);
                    if (!approved)
                    {
                        await SendAsync(socket, "client.pair.denied", new { message = "Parkopplingen nekades på datorn." }, cancellationToken);
                        return false;
                    }
                    var newToken = TokenHasher.CreateToken();
                    _pairings.Pair(requestedClientId, clientName, newToken);
                    await SendAsync(socket, "client.pair.confirm", new { agentId = AgentIdentity.DeviceId, token = newToken }, cancellationToken);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                }
                break;

            case "display.list":
                await SendDisplayListAsync(socket, cancellationToken);
                break;

            case "display.select":
                if (TryGetString(message.Payload, "displayId", out var displayId))
                {
                    var display = _displays.GetDisplays().FirstOrDefault(d => d.Id == displayId);
                    if (display is not null)
                    {
                        _pointer.SelectDisplay(display);
                        await SendAsync(socket, "display.selected", new { displayId }, cancellationToken);
                    }
                    else
                    {
                        await SendAsync(socket, "protocol.error", new { message = "Den valda skärmen finns inte längre." }, cancellationToken);
                    }
                }
                break;

            case "pointer.move":
                if (sequenceGate.Accept(message.Sequence) && TryGetDouble(message.Payload, "dx", out var dx) && TryGetDouble(message.Payload, "dy", out var dy))
                {
                    _pointer.MoveRelative(dx, dy);
                }
                break;

            case "pointer.click":
                if (TryGetString(message.Payload, "button", out var button) && button == "right")
                {
                    _pointer.RightClick();
                }
                else
                {
                    _pointer.LeftClick();
                }
                break;

            case "pointer.doubleClick":
                _pointer.DoubleClick();
                break;

            case "pointer.scroll":
                if (TryGetDouble(message.Payload, "delta", out var delta))
                {
                    _pointer.Scroll((int)Math.Clamp(Math.Round(delta), -1200, 1200));
                }
                break;

            case "connection.ping":
                await SendAsync(socket, "connection.pong", new { }, cancellationToken);
                break;

            case "keyboard.key":
                if (TryGetString(message.Payload, "key", out var key) && KeyboardInput.TryParse(key, out var stroke))
                {
                    _pointer.Key(stroke);
                }
                else
                {
                    await SendAsync(socket, "protocol.error", new { message = "Tangenten stöds inte." }, cancellationToken);
                }
                break;
        }

        return authenticated;
    }

    private static Task SendAuthenticationRequiredAsync(WebSocket socket, CancellationToken cancellationToken) =>
        SendAsync(socket, "auth.required", new { agentId = AgentIdentity.DeviceId, message = "Parkoppling krävs för att styra denna dator." }, cancellationToken);

    private Task SendDisplayListAsync(WebSocket socket, CancellationToken cancellationToken) =>
        SendAsync(socket, "display.list", new
        {
            displays = _displays.GetDisplays().Select(d => new
            {
                id = d.Id,
                name = d.Name,
                x = d.Bounds.Left,
                y = d.Bounds.Top,
                width = d.Bounds.Width,
                height = d.Bounds.Height,
                isPrimary = d.IsPrimary
            })
        }, cancellationToken);

    private static Task SendAsync(WebSocket socket, string type, object payload, CancellationToken cancellationToken)
    {
        var bytes = Encoding.UTF8.GetBytes(WireProtocol.Create(type, payload));
        return socket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken);
    }

    private static async Task<string?> ReceiveTextAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[4096];
        using var stream = new MemoryStream();
        WebSocketReceiveResult result;
        do
        {
            result = await socket.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "Stänger", cancellationToken);
                return null;
            }
            stream.Write(buffer, 0, result.Count);
            if (stream.Length > 64 * 1024)
            {
                throw new WebSocketException("Meddelandet är för stort.");
            }
        } while (!result.EndOfMessage);

        return result.MessageType == WebSocketMessageType.Text ? Encoding.UTF8.GetString(stream.ToArray()) : null;
    }

    private static bool TryGetString(JsonElement payload, string name, out string value)
    {
        value = string.Empty;
        return payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String && (value = property.GetString()!) is not null;
    }

    private static bool TryGetDouble(JsonElement payload, string name, out double value)
    {
        value = 0;
        return payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty(name, out var property) && property.TryGetDouble(out value);
    }
}
