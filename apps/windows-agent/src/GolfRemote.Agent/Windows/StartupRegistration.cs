using Microsoft.Win32;

namespace GolfRemote.Agent.Windows;

public static class StartupRegistration
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "Golf Remote";

    public static bool CanRegister =>
        Environment.ProcessPath is { } processPath &&
        Path.GetFileName(processPath).Equals("GolfRemote.Agent.exe", StringComparison.OrdinalIgnoreCase);

    public static bool IsEnabled()
    {
        if (!CanRegister) return false;
        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath);
        return key?.GetValue(ValueName) is string value && value.Contains(Environment.ProcessPath!, StringComparison.OrdinalIgnoreCase);
    }

    public static void SetEnabled(bool enabled)
    {
        if (!CanRegister) return;
        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath);
        if (enabled)
        {
            key.SetValue(ValueName, $"\"{Environment.ProcessPath}\"");
        }
        else
        {
            key.DeleteValue(ValueName, false);
        }
    }
}
