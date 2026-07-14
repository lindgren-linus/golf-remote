using GolfRemote.Agent.Core;

namespace GolfRemote.Agent.Windows;

public sealed class TrayApplicationContext : ApplicationContext
{
    private readonly AgentRuntime _runtime;
    private readonly NotifyIcon _trayIcon;
    private readonly ContextMenuStrip _menu;
    private readonly System.Windows.Forms.Timer _statusTimer;
    private bool _exiting;

    public TrayApplicationContext(AgentRuntime runtime)
    {
        _runtime = runtime;
        _menu = new ContextMenuStrip();
        _menu.Opening += (_, _) => RebuildMenu();
        _trayIcon = new NotifyIcon
        {
            Icon = System.Drawing.SystemIcons.Application,
            Text = "Golf Remote — startar",
            ContextMenuStrip = _menu,
            Visible = true,
        };
        _trayIcon.DoubleClick += async (_, _) => await ToggleServerAsync();
        _statusTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        _statusTimer.Tick += (_, _) => UpdateStatus();
        _statusTimer.Start();
        _ = StartServerAsync();
    }

    private async Task StartServerAsync()
    {
        try
        {
            await _runtime.StartAsync();
            _trayIcon.ShowBalloonTip(2500, "Golf Remote", "Agenten kör och kan hittas på det lokala nätverket.", ToolTipIcon.Info);
        }
        catch (Exception exception)
        {
            MessageBox.Show($"Golf Remote kunde inte starta.\n\n{exception.Message}", "Golf Remote", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        UpdateStatus();
    }

    private async Task ToggleServerAsync()
    {
        if (_runtime.IsRunning)
        {
            await _runtime.StopAsync();
        }
        else
        {
            await StartServerAsync();
        }
        UpdateStatus();
    }

    private void UpdateStatus()
    {
        var state = _runtime.IsRunning ? "kör" : "stoppad";
        _trayIcon.Text = $"Golf Remote — {state}";
    }

    private void RebuildMenu()
    {
        _menu.Items.Clear();
        var running = _runtime.IsRunning;
        _menu.Items.Add(new ToolStripMenuItem(running ? "Golf Remote — ansluten och kör" : "Golf Remote — servern är stoppad") { Enabled = false });
        _menu.Items.Add(new ToolStripMenuItem($"Dator: {Environment.MachineName}") { Enabled = false });
        _menu.Items.Add(new ToolStripSeparator());

        var addresses = _runtime.GetLanAddresses();
        var addressMenu = new ToolStripMenuItem("Anslutningsadresser") { Enabled = addresses.Count > 0 };
        foreach (var address in addresses)
        {
            addressMenu.DropDownItems.Add(new ToolStripMenuItem($"ws://{address}:{_runtime.Port}/ws") { Enabled = false });
        }
        if (addresses.Count == 0) addressMenu.DropDownItems.Add(new ToolStripMenuItem("Ingen aktiv IPv4-adress hittades") { Enabled = false });
        _menu.Items.Add(addressMenu);

        _menu.Items.Add(new ToolStripMenuItem(running ? "Stoppa servern" : "Starta servern", null, async (_, _) => await ToggleServerAsync()));
        var autostart = new ToolStripMenuItem("Starta automatiskt när jag loggar in")
        {
            Checked = StartupRegistration.IsEnabled(),
            Enabled = StartupRegistration.CanRegister,
        };
        autostart.Click += (_, _) =>
        {
            StartupRegistration.SetEnabled(!autostart.Checked);
            RebuildMenu();
        };
        _menu.Items.Add(autostart);

        var pairedClients = _runtime.Pairings.List();
        var clientsMenu = new ToolStripMenuItem("Parade enheter");
        if (pairedClients.Count == 0)
        {
            clientsMenu.DropDownItems.Add(new ToolStripMenuItem("Inga parade enheter") { Enabled = false });
        }
        else
        {
            foreach (var client in pairedClients)
            {
                var clientMenu = new ToolStripMenuItem(client.Name);
                clientMenu.DropDownItems.Add(new ToolStripMenuItem("Återkalla åtkomst", null, (_, _) =>
                {
                    _runtime.Pairings.Revoke(client.ClientId);
                    RebuildMenu();
                }));
                clientsMenu.DropDownItems.Add(clientMenu);
            }
            clientsMenu.DropDownItems.Add(new ToolStripSeparator());
            clientsMenu.DropDownItems.Add(new ToolStripMenuItem("Återställ alla parkopplingar", null, (_, _) =>
            {
                if (MessageBox.Show("Ta bort alla parade telefoner?", "Golf Remote", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                {
                    _runtime.Pairings.Clear();
                    RebuildMenu();
                }
            }));
        }
        _menu.Items.Add(clientsMenu);

        if (!string.IsNullOrWhiteSpace(_runtime.LastError))
        {
            _menu.Items.Add(new ToolStripMenuItem($"Senaste fel: {_runtime.LastError}") { Enabled = false });
        }
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(new ToolStripMenuItem("Avsluta Golf Remote", null, async (_, _) => await ExitAsync()));
    }

    private async Task ExitAsync()
    {
        if (_exiting) return;
        _exiting = true;
        _statusTimer.Stop();
        _trayIcon.Visible = false;
        await _runtime.StopAsync();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _statusTimer.Dispose();
            _trayIcon.Dispose();
            _menu.Dispose();
        }
        base.Dispose(disposing);
    }
}
