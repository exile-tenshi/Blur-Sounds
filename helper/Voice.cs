// Offline "clip it" voice trigger using Vosk (Kaldi) with a restricted grammar.
using System.Text.Json.Nodes;
using Vosk;

namespace Bsp;

public sealed class VoiceTrigger : IDisposable
{
    Model model; VoskRecognizer rec; string phrase = ""; string modelPath = "";
    readonly object l = new();
    DateTime lastFire = DateTime.MinValue;
    public string LastHeard = ""; public string Error = "";
    public event Action<string> Fired;
    public bool Ready => rec != null;
    double decimPos; // 48k -> 16k
    readonly List<short> pcm = new(4096);

    static string Normalize(string s) => string.Join(' ', (s ?? "").ToLowerInvariant().Split(new[] { ' ', ',', '.', '!', '?', '-' }, StringSplitOptions.RemoveEmptyEntries));

    public void Configure(string modelDir, string newPhrase)
    {
        newPhrase = Normalize(newPhrase);
        lock (l)
        {
            if (modelDir == modelPath && newPhrase == phrase && rec != null) return;
            try
            {
                Vosk.Vosk.SetLogLevel(-1);
                if (modelDir != modelPath || model == null)
                {
                    rec?.Dispose(); rec = null; model?.Dispose(); model = null;
                    if (!Directory.Exists(modelDir)) { Error = "voice model not found: " + modelDir; modelPath = modelDir; phrase = newPhrase; return; }
                    model = new Model(modelDir); modelPath = modelDir;
                }
                rec?.Dispose();
                phrase = newPhrase;
                // Grammar: the phrase, its words, and [unk] so other speech does not get forced into the phrase.
                var words = new JsonArray { phrase, "[unk]" };
                // Near-miss words so phrases like "clip of it" or "flip it" don't get forced into the trigger.
                foreach (var w in new[] { "of", "that", "this", "the", "a", "is", "it", "clip", "clips", "click", "flip", "keep", "quit", "lip", "slip", "skip", "kit", "in", "and", "i", "like", "with", "get" })
                    if (!phrase.Split(' ').Contains(w) || w == "it" || w == "clip") words.Add(w);
                rec = new VoskRecognizer(model, 16000f, words.ToJsonString());
                rec.SetMaxAlternatives(0); rec.SetWords(false);
                Error = "";
            }
            catch (Exception e) { Error = e.Message; rec = null; }
        }
    }

    // mono float at 48 kHz
    public void Feed(float[] mono, int n)
    {
        if (rec == null) return;
        // 3:1 decimation with a small boxcar low-pass (good enough for speech recognition)
        for (int i = 0; i + 2 < n; i += 3)
        {
            float v = (mono[i] + mono[i + 1] + mono[i + 2]) / 3f;
            pcm.Add((short)Math.Clamp(v * 32767f, -32768, 32767));
        }
        if (pcm.Count < 1600) return; // 100 ms chunks
        var bytes = new byte[pcm.Count * 2];
        Buffer.BlockCopy(pcm.ToArray(), 0, bytes, 0, bytes.Length);
        pcm.Clear();
        FeedPcm16(bytes, bytes.Length);
    }

    public void FeedPcm16(byte[] bytes, int len)
    {
        lock (l)
        {
            if (rec == null) return;
            bool final = rec.AcceptWaveform(bytes, len);
            var json = final ? rec.Result() : rec.PartialResult();
            var node = JsonNode.Parse(json);
            var text = Normalize((string)(final ? node?["text"] : node?["partial"]));
            if (!string.IsNullOrEmpty(text) && text != "[unk]") LastHeard = text;
            if (final && !string.IsNullOrEmpty(phrase) && (" " + text + " ").Contains(" " + phrase + " ") && (DateTime.UtcNow - lastFire).TotalSeconds > 3)
            {
                lastFire = DateTime.UtcNow;
                rec.Reset();
                Fired?.Invoke(text);
            }
        }
    }

    public void Dispose() { lock (l) { rec?.Dispose(); model?.Dispose(); rec = null; model = null; } }
}
