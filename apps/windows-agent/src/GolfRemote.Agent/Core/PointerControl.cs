namespace GolfRemote.Agent.Core;

public interface IPointerPlatform
{
    (int X, int Y) GetPosition();
    void SetPosition(int x, int y);
    void SetClip(ScreenRect? bounds);
    void LeftClick();
    void RightClick();
    void DoubleClick();
    void Scroll(int delta);
    void Key(KeyStroke stroke);
}

public sealed class PointerController
{
    private readonly IPointerPlatform _platform;
    private readonly object _sync = new();
    private DisplayInfo? _activeDisplay;
    private double _targetX;
    private double _targetY;
    private double _renderedX;
    private double _renderedY;
    private (int X, int Y) _lastSent;

    public PointerController(IPointerPlatform platform) => _platform = platform;

    public string? ActiveDisplayId
    {
        get { lock (_sync) return _activeDisplay?.Id; }
    }

    public bool SelectDisplay(DisplayInfo display)
    {
        lock (_sync)
        {
            _activeDisplay = display;
            _targetX = _renderedX = display.Bounds.CenterX;
            _targetY = _renderedY = display.Bounds.CenterY;
            _lastSent = (display.Bounds.CenterX, display.Bounds.CenterY);
            _platform.SetPosition(_lastSent.X, _lastSent.Y);
            _platform.SetClip(display.Bounds);
        }
        return true;
    }

    public bool MoveRelative(double dx, double dy)
    {
        lock (_sync)
        {
            if (_activeDisplay is null)
            {
                return false;
            }

            (_targetX, _targetY) = _activeDisplay.Bounds.ClampContinuous(_targetX + dx, _targetY + dy);
            return true;
        }
    }

    /// <summary>Moves part of the remaining distance to the latest remote target.</summary>
    public bool AdvanceTowardsTarget(double interpolation = 0.48)
    {
        lock (_sync)
        {
            if (_activeDisplay is null)
            {
                return false;
            }

            interpolation = Math.Clamp(interpolation, 0.05, 1);
            _renderedX += (_targetX - _renderedX) * interpolation;
            _renderedY += (_targetY - _renderedY) * interpolation;
            var destination = _activeDisplay.Bounds.Clamp(_renderedX, _renderedY);
            if (destination == _lastSent)
            {
                return false;
            }

            _lastSent = destination;
            _platform.SetPosition(destination.X, destination.Y);
            return true;
        }
    }

    public void LeftClick() { lock (_sync) _platform.LeftClick(); }
    public void RightClick() { lock (_sync) _platform.RightClick(); }
    public void DoubleClick() { lock (_sync) _platform.DoubleClick(); }
    public void Scroll(int delta) { lock (_sync) _platform.Scroll(delta); }
    public void Key(KeyStroke stroke) { lock (_sync) _platform.Key(stroke); }
    public void ReleaseClip() { lock (_sync) _platform.SetClip(null); }
}

public sealed class PointerMotionSmoother
{
    private readonly PointerController _pointer;
    private readonly TimeSpan _interval;
    private readonly double _interpolation;

    public PointerMotionSmoother(PointerController pointer, TimeSpan? interval = null, double interpolation = 0.48)
    {
        _pointer = pointer;
        _interval = interval ?? TimeSpan.FromMilliseconds(8);
        _interpolation = interpolation;
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(_interval);
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                _pointer.AdvanceTowardsTarget(_interpolation);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
    }
}

public sealed class MoveSequenceGate
{
    private long _last = -1;

    public bool Accept(long? sequence)
    {
        if (sequence is null)
        {
            return true;
        }

        if (sequence <= _last)
        {
            return false;
        }

        _last = sequence.Value;
        return true;
    }
}
