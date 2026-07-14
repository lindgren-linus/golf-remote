namespace GolfRemote.Agent.Core;

public readonly record struct ScreenRect(int Left, int Top, int Width, int Height)
{
    public int Right => Left + Width;
    public int Bottom => Top + Height;
    public int CenterX => Left + Width / 2;
    public int CenterY => Top + Height / 2;

    public (double X, double Y) ClampContinuous(double x, double y) =>
        (Math.Clamp(x, Left, Right - 1), Math.Clamp(y, Top, Bottom - 1));

    public (int X, int Y) Clamp(double x, double y) =>
        ((int)Math.Clamp(Math.Round(x), Left, Right - 1),
         (int)Math.Clamp(Math.Round(y), Top, Bottom - 1));
}

public sealed record DisplayInfo(string Id, string Name, ScreenRect Bounds, bool IsPrimary);

public interface IDisplayProvider
{
    IReadOnlyList<DisplayInfo> GetDisplays();
}
