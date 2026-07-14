using GolfRemote.Agent.Core;
using Makaretu.Dns;

namespace GolfRemote.Agent.Server;

public sealed class MdnsAdvertiser : IDisposable
{
    public const string ServiceType = "_golfremote._tcp";
    private readonly ServiceDiscovery? _discovery;
    private readonly ServiceProfile? _profile;

    private MdnsAdvertiser(ServiceDiscovery? discovery, ServiceProfile? profile)
    {
        _discovery = discovery;
        _profile = profile;
    }

    public static MdnsAdvertiser Start(int port)
    {
        try
        {
            var profile = new ServiceProfile(Environment.MachineName, ServiceType, (ushort)port);
            profile.AddProperty("name", Environment.MachineName);
            profile.AddProperty("id", AgentIdentity.DeviceId);
            profile.AddProperty("version", "1");
            var discovery = new ServiceDiscovery();
            discovery.Advertise(profile);
            Console.WriteLine($"mDNS annonserar {Environment.MachineName}.{ServiceType}.local på port {port}.");
            return new MdnsAdvertiser(discovery, profile);
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"mDNS kunde inte startas: {exception.Message}");
            return new MdnsAdvertiser(null, null);
        }
    }

    public void Dispose()
    {
        if (_discovery is null || _profile is null) return;
        try
        {
            _discovery.Unadvertise(_profile);
            _discovery.Dispose();
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"mDNS kunde inte avslutas rent: {exception.Message}");
        }
    }
}
