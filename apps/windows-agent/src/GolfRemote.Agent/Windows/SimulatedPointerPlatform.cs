using GolfRemote.Agent.Core;

namespace GolfRemote.Agent.Windows;

public sealed class SimulatedPointerPlatform : IPointerPlatform
{
    private (int X, int Y) _position = (0, 0);
    public (int X, int Y) GetPosition() => _position;
    public void SetPosition(int x, int y) { _position = (x, y); Console.WriteLine($"[simulate] cursor {x},{y}"); }
    public void SetClip(ScreenRect? bounds) => Console.WriteLine($"[simulate] clip {bounds}");
    public void LeftClick() => Console.WriteLine("[simulate] left click");
    public void RightClick() => Console.WriteLine("[simulate] right click");
    public void DoubleClick() => Console.WriteLine("[simulate] double click");
    public void Scroll(int delta) => Console.WriteLine($"[simulate] scroll {delta}");
    public void Key(KeyStroke stroke) => Console.WriteLine($"[simulate] key {stroke}");
}
