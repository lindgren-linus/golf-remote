namespace GolfRemote.Agent.Core;

public enum KeyStrokeKind { Unicode, VirtualKey }

public readonly record struct KeyStroke(KeyStrokeKind Kind, ushort Value);

public static class KeyboardInput
{
    private static readonly IReadOnlyDictionary<string, ushort> SpecialKeys = new Dictionary<string, ushort>(StringComparer.Ordinal)
    {
        ["Backspace"] = 0x08,
        ["Enter"] = 0x0D,
        ["Escape"] = 0x1B,
        ["Space"] = 0x20,
        ["ArrowLeft"] = 0x25,
        ["ArrowUp"] = 0x26,
        ["ArrowRight"] = 0x27,
        ["ArrowDown"] = 0x28
    };

    public static bool TryParse(string key, out KeyStroke stroke)
    {
        if (SpecialKeys.TryGetValue(key, out var virtualKey))
        {
            stroke = new KeyStroke(KeyStrokeKind.VirtualKey, virtualKey);
            return true;
        }

        if (key.Length == 1 && !char.IsControl(key[0]))
        {
            stroke = new KeyStroke(KeyStrokeKind.Unicode, key[0]);
            return true;
        }

        stroke = default;
        return false;
    }
}

