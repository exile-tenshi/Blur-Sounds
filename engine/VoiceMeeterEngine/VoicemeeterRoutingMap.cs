using System.Text.RegularExpressions;

namespace VoiceMeeterEngine;

internal sealed record VoicemeeterRouteTarget(int StripIndex, string BusKey, string RecordingLabel)
{
    public string ParameterName => $"Strip[{StripIndex}].{BusKey}";
}

internal static class VoicemeeterRoutingMap
{
    private static readonly Regex NumericInPattern = new(@"voicemeeter in (\d+)", RegexOptions.IgnoreCase);
    private static readonly Regex ExplicitInPattern = new(@"voicemeeter in ([ab]\d+)", RegexOptions.IgnoreCase);

    public static VoicemeeterRouteTarget? ParseInputDeviceName(string inputDeviceName, int voicemeeterType = 3)
    {
        if (string.IsNullOrWhiteSpace(inputDeviceName))
        {
            return null;
        }

        if (Regex.IsMatch(inputDeviceName, @"voicemeeter aux input", RegexOptions.IgnoreCase))
        {
            var auxStrip = GetAuxStripIndex(voicemeeterType);
            if (auxStrip < 0)
            {
                return null;
            }

            return new VoicemeeterRouteTarget(auxStrip, "A1", "Voicemeeter Aux Output");
        }

        if (Regex.IsMatch(inputDeviceName, @"voicemeeter vaio3 input", RegexOptions.IgnoreCase))
        {
            var vaio3Strip = GetVaio3StripIndex(voicemeeterType);
            if (vaio3Strip < 0)
            {
                return null;
            }

            return new VoicemeeterRouteTarget(vaio3Strip, "A1", "Voicemeeter VAIO3 Output");
        }

        var explicitMatch = ExplicitInPattern.Match(inputDeviceName);
        if (explicitMatch.Success)
        {
            var busId = explicitMatch.Groups[1].Value.ToUpperInvariant();
            return new VoicemeeterRouteTarget(ResolveExtensionStripIndex(busId), busId, $"Voicemeeter Out {busId}");
        }

        var numericMatch = NumericInPattern.Match(inputDeviceName);
        if (numericMatch.Success && int.TryParse(numericMatch.Groups[1].Value, out var inputNumber) && inputNumber >= 1)
        {
            var busKey = $"A{inputNumber}";
            // VAIO In N feeds Voicemeeter hardware input #N (strip index N-1).
            return new VoicemeeterRouteTarget(inputNumber - 1, busKey, $"Voicemeeter Out {busKey}");
        }

        if (Regex.IsMatch(inputDeviceName, @"voicemeeter input", RegexOptions.IgnoreCase) &&
            !Regex.IsMatch(inputDeviceName, @"voicemeeter in", RegexOptions.IgnoreCase))
        {
            return new VoicemeeterRouteTarget(
                GetVirtualInputStripIndex(voicemeeterType),
                "A1",
                "Voicemeeter Output");
        }

        return null;
    }

    public static int GetVirtualInputStripIndex(int voicemeeterType) =>
        voicemeeterType switch
        {
            1 => 2,
            2 => 3,
            _ => 5,
        };

    public static int GetAuxStripIndex(int voicemeeterType) =>
        voicemeeterType switch
        {
            2 => 4,
            3 => 6,
            _ => -1,
        };

    public static int GetVaio3StripIndex(int voicemeeterType) =>
        voicemeeterType switch
        {
            3 => 7,
            _ => -1,
        };

    private static int ResolveExtensionStripIndex(string busId)
    {
        if (busId.StartsWith('A') && int.TryParse(busId[1..], out var aNumber) && aNumber >= 1)
        {
            return aNumber - 1;
        }

        if (busId.StartsWith('B') && int.TryParse(busId[1..], out var bNumber) && bNumber >= 1)
        {
            return bNumber - 1;
        }

        return 0;
    }

    public static int ResolveBusIndex(string busKey)
    {
        if (busKey.StartsWith('A') && int.TryParse(busKey[1..], out var aNumber) && aNumber >= 1)
        {
            return aNumber - 1;
        }

        if (busKey.StartsWith('B') && int.TryParse(busKey[1..], out var bNumber) && bNumber >= 1)
        {
            return 4 + bNumber;
        }

        return 0;
    }
}
