using System.Runtime.InteropServices;
using GolfRemote.Agent.Core;

namespace GolfRemote.Agent.Windows;

public sealed class Win32PointerPlatform : IPointerPlatform
{
    public (int X, int Y) GetPosition()
    {
        GetCursorPos(out var point);
        return (point.X, point.Y);
    }

    public void SetPosition(int x, int y) => SetCursorPos(x, y);

    public void SetClip(ScreenRect? bounds)
    {
        if (bounds is null)
        {
            ClipCursor(IntPtr.Zero);
            return;
        }
        var b = bounds.Value;
        var rect = new Rect { Left = b.Left, Top = b.Top, Right = b.Right, Bottom = b.Bottom };
        ClipCursor(ref rect);
    }

    public void LeftClick()
    {
        SendMouse(MouseEventLeftDown);
        SendMouse(MouseEventLeftUp);
    }

    public void RightClick()
    {
        SendMouse(MouseEventRightDown);
        SendMouse(MouseEventRightUp);
    }

    public void DoubleClick()
    {
        LeftClick();
        LeftClick();
    }

    public void Scroll(int delta) => SendMouse(MouseEventWheel, delta);

    public void Key(KeyStroke stroke)
    {
        var flags = stroke.Kind == KeyStrokeKind.Unicode ? KeyEventUnicode : 0u;
        SendKeyboard(stroke.Kind == KeyStrokeKind.VirtualKey ? stroke.Value : (ushort)0, stroke.Kind == KeyStrokeKind.Unicode ? stroke.Value : (ushort)0, flags);
        SendKeyboard(stroke.Kind == KeyStrokeKind.VirtualKey ? stroke.Value : (ushort)0, stroke.Kind == KeyStrokeKind.Unicode ? stroke.Value : (ushort)0, flags | KeyEventKeyUp);
    }

    private static void SendMouse(uint flags, int mouseData = 0)
    {
        var input = new Input
        {
            type = 0,
            union = new InputUnion { mouse = new MouseInput { dwFlags = flags, mouseData = unchecked((uint)mouseData) } }
        };
        SendInput(1, new[] { input }, Marshal.SizeOf<Input>());
    }

    private static void SendKeyboard(ushort virtualKey, ushort scanCode, uint flags)
    {
        var input = new Input
        {
            type = 1,
            union = new InputUnion { keyboard = new KeyboardInputData { wVk = virtualKey, wScan = scanCode, dwFlags = flags } }
        };
        SendInput(1, new[] { input }, Marshal.SizeOf<Input>());
    }

    private const uint MouseEventLeftDown = 0x0002;
    private const uint MouseEventLeftUp = 0x0004;
    private const uint MouseEventRightDown = 0x0008;
    private const uint MouseEventRightUp = 0x0010;
    private const uint MouseEventWheel = 0x0800;
    private const uint KeyEventKeyUp = 0x0002;
    private const uint KeyEventUnicode = 0x0004;

    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern bool ClipCursor(IntPtr rect);
    [DllImport("user32.dll")] private static extern bool ClipCursor(ref Rect rect);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] inputs, int size);

    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct Input { public uint type; public InputUnion union; }
    [StructLayout(LayoutKind.Explicit)] private struct InputUnion { [FieldOffset(0)] public MouseInput mouse; [FieldOffset(0)] public KeyboardInputData keyboard; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseInput { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct KeyboardInputData { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
}
