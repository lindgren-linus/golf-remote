using System.Security.Cryptography;
using System.Text;

namespace GolfRemote.Agent.Core;

public static class TokenHasher
{
    public static string CreateToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

    public static string Hash(string token) => Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public static bool Verify(string token, string storedHash) =>
        CryptographicOperations.FixedTimeEquals(
            Convert.FromBase64String(Hash(token)),
            Convert.FromBase64String(storedHash));
}

