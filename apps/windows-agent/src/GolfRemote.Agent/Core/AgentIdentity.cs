using System.Security.Cryptography;
using System.Text;

namespace GolfRemote.Agent.Core;

public static class AgentIdentity
{
    public static string DeviceId { get; } = Convert.ToHexString(
        SHA256.HashData(Encoding.UTF8.GetBytes($"golfremote:{Environment.MachineName}")))[..16].ToLowerInvariant();
}

