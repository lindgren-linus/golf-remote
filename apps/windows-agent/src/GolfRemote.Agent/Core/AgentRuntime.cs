using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using GolfRemote.Agent.Server;
using GolfRemote.Agent.Windows;

namespace GolfRemote.Agent.Core;

public sealed class AgentRuntime
{
    private readonly object _sync = new();
    private readonly bool _simulate;
    private CancellationTokenSource? _shutdown;
    private Task? _serverTask;
    private Task? _smoothingTask;
    private IDisposable? _mdns;
    private PointerController? _pointer;

    public AgentRuntime(int port, bool simulate)
    {
        Port = port;
        _simulate = simulate;
        var pairingPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GolfRemote", "paired-clients.json");
        Pairings = new PairingStore(pairingPath);
    }

    public int Port { get; }
    public bool IsSimulation => _simulate;
    public PairingStore Pairings { get; }

    public bool IsRunning
    {
        get { lock (_sync) return _shutdown is not null && _serverTask is { IsCompleted: false }; }
    }

    public string? LastError { get; private set; }

    public IReadOnlyList<IPAddress> GetLanAddresses() => NetworkAddresses.GetLanAddresses().ToArray();

    public async Task StartAsync()
    {
        lock (_sync)
        {
            if (_shutdown is not null && _serverTask is { IsCompleted: false }) return;
        }

        // A failed listener leaves completed tasks behind. Clean those up so
        // the tray menu can genuinely restart the server after a port error.
        if (_shutdown is not null)
        {
            await StopAsync();
        }

        lock (_sync)
        {
            LastError = null;
            _shutdown = new CancellationTokenSource();
            IPointerPlatform platform = _simulate ? new SimulatedPointerPlatform() : new Win32PointerPlatform();
            _pointer = new PointerController(platform);
            var smoother = new PointerMotionSmoother(_pointer);
            var server = new AgentWebSocketServer(new WindowsDisplayProvider(), _pointer, Pairings, new WindowsPairingApproval());
            _mdns = MdnsAdvertiser.Start(Port);
            _smoothingTask = smoother.RunAsync(_shutdown.Token);
            _serverTask = server.RunAsync(Port, _shutdown.Token);
            _ = _serverTask.ContinueWith(task =>
            {
                if (task.IsFaulted) LastError = task.Exception?.GetBaseException().Message ?? "Servern stoppades oväntat.";
            }, TaskScheduler.Default);
        }

        return;
    }

    public async Task StopAsync()
    {
        CancellationTokenSource? shutdown;
        Task? serverTask;
        Task? smoothingTask;
        IDisposable? mdns;
        PointerController? pointer;
        lock (_sync)
        {
            shutdown = _shutdown;
            serverTask = _serverTask;
            smoothingTask = _smoothingTask;
            mdns = _mdns;
            pointer = _pointer;
            _shutdown = null;
            _serverTask = null;
            _smoothingTask = null;
            _mdns = null;
            _pointer = null;
        }

        if (shutdown is null) return;
        shutdown.Cancel();
        try
        {
            if (serverTask is not null) await serverTask;
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            if (smoothingTask is not null) await smoothingTask;
            pointer?.ReleaseClip();
            mdns?.Dispose();
            shutdown.Dispose();
        }
    }
}

public static class NetworkAddresses
{
    public static IEnumerable<IPAddress> GetLanAddresses() =>
        NetworkInterface.GetAllNetworkInterfaces()
            .Where(adapter => adapter.OperationalStatus == OperationalStatus.Up && adapter.NetworkInterfaceType is not NetworkInterfaceType.Loopback and not NetworkInterfaceType.Tunnel)
            .SelectMany(adapter => adapter.GetIPProperties().UnicastAddresses)
            .Select(address => address.Address)
            .Where(address => address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(address));
}
