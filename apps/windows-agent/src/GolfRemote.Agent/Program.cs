using GolfRemote.Agent.Core;
using GolfRemote.Agent.Windows;

var port = 56789;
var simulate = false;
var configureAutostart = false;
var disableAutostart = false;
for (var i = 0; i < args.Length; i++)
{
    if (args[i] is "--simulate") simulate = true;
    if (args[i] is "--configure-autostart") configureAutostart = true;
    if (args[i] is "--disable-autostart") disableAutostart = true;
    if (args[i] is "--port" && i + 1 < args.Length && int.TryParse(args[++i], out var parsedPort) && parsedPort is > 0 and <= 65535) port = parsedPort;
}

if (!OperatingSystem.IsWindows())
{
    MessageBox.Show("Golf Remote-agenten måste köras på Windows.", "Golf Remote", MessageBoxButtons.OK, MessageBoxIcon.Error);
    return;
}

Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
Application.EnableVisualStyles();
Application.SetCompatibleTextRenderingDefault(false);
if (configureAutostart)
{
    StartupRegistration.SetEnabled(true);
    return;
}
if (disableAutostart)
{
    StartupRegistration.SetEnabled(false);
    return;
}

var runtime = new AgentRuntime(port, simulate);
Application.Run(new TrayApplicationContext(runtime));
await runtime.StopAsync();
