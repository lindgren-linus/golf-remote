using GolfRemote.Agent.Core;
using GolfRemote.Agent.Protocol;

var tests = new (string Name, Action Run)[]
{
    ("protocol serialization", ProtocolSerialization),
    ("move sequence handling", MoveSequenceHandling),
    ("screen coordinate clamp", ScreenCoordinateClamp),
    ("pointer controller clamps active display", PointerControllerClamps),
    ("keyboard keys are safely parsed", KeyboardKeysAreSafelyParsed),
    ("pairing token hashing", TokenHashing),
    ("pairing store keeps only token hashes", PairingStoreKeepsOnlyHashes)
};

var failed = 0;
foreach (var (name, run) in tests)
{
    try
    {
        run();
        Console.WriteLine($"PASS {name}");
    }
    catch (Exception exception)
    {
        failed++;
        Console.Error.WriteLine($"FAIL {name}: {exception.Message}");
    }
}

return failed == 0 ? 0 : 1;

static void ProtocolSerialization()
{
    var parsed = Protocol.Parse(Protocol.Create("pointer.move", new { dx = 5.4, dy = -2.1 }, 42));
    Assert(parsed is not null && parsed.Version == 1 && parsed.Type == "pointer.move" && parsed.Sequence == 42, "Envelope did not round-trip.");
    Assert(parsed!.Payload.GetProperty("dx").GetDouble() == 5.4, "Payload did not round-trip.");
    Assert(Protocol.Parse("not json") is null, "Malformed JSON was accepted.");
}

static void MoveSequenceHandling()
{
    var gate = new MoveSequenceGate();
    Assert(gate.Accept(1), "First sequence should be accepted.");
    Assert(!gate.Accept(1), "Duplicate sequence should be rejected.");
    Assert(!gate.Accept(0), "Old sequence should be rejected.");
    Assert(gate.Accept(2), "New sequence should be accepted.");
    Assert(gate.Accept(null), "Unsequenced non-move message should pass.");
}

static void ScreenCoordinateClamp()
{
    var rect = new ScreenRect(-1920, 0, 1920, 1080);
    Assert(rect.Clamp(-2000, -1) == (-1920, 0), "Top-left clamp failed.");
    Assert(rect.Clamp(100, 2000) == (-1, 1079), "Bottom-right clamp failed.");
}

static void PointerControllerClamps()
{
    var platform = new FakePointerPlatform();
    var controller = new PointerController(platform);
    var display = new DisplayInfo("projector", "Projektor", new ScreenRect(100, 100, 400, 300), false);
    controller.SelectDisplay(display);
    Assert(platform.Position == (300, 250), "Selection should centre the pointer.");
    controller.MoveRelative(900, -900);
    controller.AdvanceTowardsTarget(1);
    Assert(platform.Position == (499, 100), "Relative move escaped the active display.");
    Assert(platform.Clip == display.Bounds, "Active display was not clipped.");
}

static void TokenHashing()
{
    var token = TokenHasher.CreateToken();
    var hash = TokenHasher.Hash(token);
    Assert(TokenHasher.Verify(token, hash), "Correct token did not verify.");
    Assert(!TokenHasher.Verify(TokenHasher.CreateToken(), hash), "Different token verified.");
}

static void PairingStoreKeepsOnlyHashes()
{
    var path = Path.Combine(Path.GetTempPath(), $"golf-remote-pairing-{Guid.NewGuid():N}.json");
    var token = TokenHasher.CreateToken();
    try
    {
        var store = new PairingStore(path);
        store.Pair("mobile-1", "Testtelefon", token);
        Assert(store.IsAuthorized("mobile-1", token), "Stored token did not authorize its client.");
        Assert(!store.IsAuthorized("mobile-1", TokenHasher.CreateToken()), "Unexpected token was authorized.");
        Assert(!File.ReadAllText(path).Contains(token, StringComparison.Ordinal), "Raw pairing token was written to disk.");
        Assert(new PairingStore(path).IsAuthorized("mobile-1", token), "Persisted pairing did not reload.");
    }
    finally
    {
        File.Delete(path);
    }
}

static void KeyboardKeysAreSafelyParsed()
{
    Assert(KeyboardInput.TryParse("å", out var unicode) && unicode.Kind == KeyStrokeKind.Unicode, "Unicode character was rejected.");
    Assert(KeyboardInput.TryParse("ArrowLeft", out var arrow) && arrow.Kind == KeyStrokeKind.VirtualKey, "Arrow key was rejected.");
    Assert(!KeyboardInput.TryParse("F12", out _), "Unsupported special key was accepted.");
}

static void Assert(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

sealed class FakePointerPlatform : IPointerPlatform
{
    public (int X, int Y) Position { get; private set; }
    public ScreenRect? Clip { get; private set; }
    public (int X, int Y) GetPosition() => Position;
    public void SetPosition(int x, int y) => Position = (x, y);
    public void SetClip(ScreenRect? bounds) => Clip = bounds;
    public void LeftClick() { }
    public void RightClick() { }
    public void DoubleClick() { }
    public void Scroll(int delta) { }
    public void Key(KeyStroke stroke) { }
}
