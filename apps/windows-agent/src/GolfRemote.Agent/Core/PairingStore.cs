using System.Text.Json;

namespace GolfRemote.Agent.Core;

public sealed record PairedClient(string ClientId, string Name, string TokenHash, DateTimeOffset PairedAt);

public sealed class PairingStore
{
    private readonly string _path;
    private readonly object _sync = new();
    private Dictionary<string, PairedClient> _clients;

    public PairingStore(string path)
    {
        _path = path;
        _clients = Load(path);
    }

    public bool IsAuthorized(string clientId, string token)
    {
        lock (_sync)
        {
            return _clients.TryGetValue(clientId, out var client) && TokenHasher.Verify(token, client.TokenHash);
        }
    }

    public void Pair(string clientId, string name, string token)
    {
        lock (_sync)
        {
            _clients[clientId] = new PairedClient(clientId, name, TokenHasher.Hash(token), DateTimeOffset.UtcNow);
            Save();
        }
    }

    public IReadOnlyCollection<PairedClient> List()
    {
        lock (_sync) return _clients.Values.OrderBy(client => client.Name).ToArray();
    }

    public bool Revoke(string clientId)
    {
        lock (_sync)
        {
            var removed = _clients.Remove(clientId);
            if (removed) Save();
            return removed;
        }
    }

    public void Clear()
    {
        lock (_sync)
        {
            _clients.Clear();
            Save();
        }
    }

    private static Dictionary<string, PairedClient> Load(string path)
    {
        try
        {
            if (!File.Exists(path)) return new Dictionary<string, PairedClient>(StringComparer.Ordinal);
            var clients = JsonSerializer.Deserialize<List<PairedClient>>(File.ReadAllText(path)) ?? [];
            return clients.ToDictionary(client => client.ClientId, StringComparer.Ordinal);
        }
        catch (Exception exception) when (exception is IOException or JsonException)
        {
            Console.Error.WriteLine($"Kunde inte läsa parkopplingar: {exception.Message}");
            return new Dictionary<string, PairedClient>(StringComparer.Ordinal);
        }
    }

    private void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var temporaryPath = _path + ".tmp";
        File.WriteAllText(temporaryPath, JsonSerializer.Serialize(_clients.Values, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(temporaryPath, _path, true);
    }
}

