using System.Text.Json;
using System.Text.Json.Serialization;

namespace GolfRemote.Agent.Protocol;

public sealed record Envelope(
    [property: JsonPropertyName("version")] int Version,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("sequence")] long? Sequence,
    [property: JsonPropertyName("payload")] JsonElement Payload);

public static class Protocol
{
    public const int Version = 1;
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static Envelope? Parse(string message)
    {
        try
        {
            return JsonSerializer.Deserialize<Envelope>(message, JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static string Create(string type, object payload, long? sequence = null) =>
        JsonSerializer.Serialize(new { version = Version, type, sequence, payload }, JsonOptions);
}

