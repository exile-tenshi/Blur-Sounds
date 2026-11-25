// v2.5.0 voice changer models: downloaded on demand (never bundled in the app zip), each file pinned by SHA-256.
//  - RMVPE pitch tracker: the official RVC project file (lj1995/VoiceConversionWebUI on Hugging Face, MIT).
//  - ContentVec + voices: converted to ONNX from MIT-licensed checkpoints and hosted on this project's GitHub release
//    "voice-models-v1". Every voice comes from a speaker who recorded openly licensed speech for a public corpus.
// User voices: an RVC v2 voice exported to ONNX with tools/rvc2onnx.py (a .pth needs that one-time conversion).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const REL = 'https://github.com/exile-tenshi/Blur-Sounds/releases/download/voice-models-v1/';
// voice-models-v2 (phase0/noise inputs) also exists; the engine loads either export. In A/B tests the v1 files sound the
// same with the 2.5.1 engine, so 2.5.1 keeps v1 and nobody has to re-download. A FILES entry can name `replaces` to upgrade.
const FILES = {
  rmvpe: { name: 'rmvpe.onnx', url: 'https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.onnx', sha: '5370e71ac80af8b4b7c793d27efd51fd8bf962de3a7ede0766dac0befa3660fd', size: 361688443, label: 'RMVPE pitch tracker' },
  contentvec: { name: 'bsp-contentvec-768-l12.onnx', url: REL + 'bsp-contentvec-768-l12.onnx', sha: '3c074a68b0c17818fa226275a7be6e2e993126f569fcae733ccd659197a4cea5', size: 377711777, label: 'ContentVec speech features' },
  lyra: { name: 'bsp-voice-lyra-32k.onnx', url: REL + 'bsp-voice-lyra-32k.onnx', sha: '6d1def6716718013d4becad7f4c76766cf852f1f1b1a7b61fb578fa48658f37d', size: 112559689, label: 'Lyra voice' },
  lyraSpk: { name: 'bsp-voice-lyra-32k.spk', url: REL + 'bsp-voice-lyra-32k.spk', sha: 'eac764691cc22c5038e14a097857adafe83f6463957544ae117362a52ebff8a1', size: 111616, label: 'Lyra voice (speaker table)' },
  vctk: { name: 'bsp-voices-vctk-32k.onnx', url: REL + 'bsp-voices-vctk-32k.onnx', sha: 'ae7ba752deb26e90edbdf823ff95bff3faab839fbb3277b82d708f1b4ec38f78', size: 112559689, label: 'Studio voice pack' },
  vctkSpk: { name: 'bsp-voices-vctk-32k.spk', url: REL + 'bsp-voices-vctk-32k.spk', sha: '91d0758cf1311a0ffffb7e462b49e173152cbd253cac3f3e7946e30734064e4f', size: 111616, label: 'Studio voice pack (speaker table)' },
};
const BASE = ['contentvec', 'rmvpe'];
// Built-in voices. gender = what the voice sounds like; targetHz = where auto-pitch puts your average pitch.
const VOICES = [
  { id: 'lyra', name: 'Lyra', gender: 'female', desc: 'Warm, clear, mature female voice. Most natural for male → female.', files: ['lyra', 'lyraSpk'], model: 'lyra', spk: 'lyraSpk', sid: 0, targetHz: 202, adult: [220, 185], tuned: { expressive: 0.4, envMix: 0.7 }, source: 'RVC v2 voice trained on LibriSpeech speaker 8312 (public-domain LibriVox reading, LibriSpeech CC BY 4.0); model by KoeAI (MIT).' },
  { id: 'ava', name: 'Ava', gender: 'female', desc: 'Bright, clear female voice.', files: ['vctk', 'vctkSpk'], model: 'vctk', spk: 'vctkSpk', sid: 9, targetHz: 191, adult: [215, 170], tuned: { expressive: 0.4, envMix: 0.7 }, source: 'RVC v2 base model speaker 9 (VCTK corpus, CC BY 4.0); RVC project (MIT).' },
  { id: 'nova', name: 'Nova', gender: 'female', desc: 'Soft, youthful female voice (sounds younger than the others).', files: ['vctk', 'vctkSpk'], model: 'vctk', spk: 'vctkSpk', sid: 75, targetHz: 172, adult: [190, 155], youthful: true, tuned: { expressive: 0.4, envMix: 0.7 }, source: 'RVC v2 base model speaker 75 (VCTK corpus, CC BY 4.0); RVC project (MIT).' },
  { id: 'mia', name: 'Mia', gender: 'female', desc: 'Lighter, airy female voice.', files: ['vctk', 'vctkSpk'], model: 'vctk', spk: 'vctkSpk', sid: 10, targetHz: 191, adult: [215, 170], tuned: { expressive: 0.4, envMix: 0.7 }, source: 'RVC v2 base model speaker 10 (VCTK corpus, CC BY 4.0); RVC project (MIT).' },
  { id: 'rowan', name: 'Rowan', gender: 'male', desc: 'Natural, full male voice. Most natural for female → male.', files: ['vctk', 'vctkSpk'], model: 'vctk', spk: 'vctkSpk', sid: 17, targetHz: 114, adult: [130, 100], tuned: { expressive: 0.8, envMix: 0.7 }, source: 'RVC v2 base model speaker 17 (VCTK corpus, CC BY 4.0); RVC project (MIT).' },
  { id: 'ezra', name: 'Ezra', gender: 'male', desc: 'Deeper, calm male voice.', files: ['vctk', 'vctkSpk'], model: 'vctk', spk: 'vctkSpk', sid: 37, targetHz: 109, adult: [125, 95], tuned: { expressive: 0.4, envMix: 0.7 }, source: 'RVC v2 base model speaker 37 (VCTK corpus, CC BY 4.0); RVC project (MIT).' },
  { id: 'silas', name: 'Silas', gender: 'male', desc: 'Lighter male voice.', files: ['vctk', 'vctkSpk'], model: 'vctk', spk: 'vctkSpk', sid: 74, targetHz: 123, adult: [140, 108], tuned: { expressive: 0.4, envMix: 0.7 }, source: 'RVC v2 base model speaker 74 (VCTK corpus, CC BY 4.0); RVC project (MIT).' },
];

class VoiceModels {
  constructor({ dir, log, send }) { this.dir = dir; this.log = log || (() => {}); this.send = send || (() => {}); this.jobs = {}; this.verified = {}; fs.mkdirSync(dir, { recursive: true }); }
  file(key) { return path.join(this.dir, FILES[key].name); }
  // the file the engine should load: the current one, or (while it upgrades) the older export it replaces
  use(key) { if (this.has(key)) return this.file(key); const r = FILES[key].replaces && path.join(this.dir, FILES[key].replaces); return r && fs.existsSync(r) ? r : this.file(key); }
  ok(key) { return this.has(key) || (!!FILES[key].replaces && fs.existsSync(path.join(this.dir, FILES[key].replaces))); }
  has(key) { try { return fs.statSync(this.file(key)).size === FILES[key].size; } catch { return false; } }
  customDir() { const d = path.join(this.dir, 'custom'); fs.mkdirSync(d, { recursive: true }); return d; }
  status(custom = []) {
    const files = {}; for (const k of Object.keys(FILES)) files[k] = { label: FILES[k].label, size: FILES[k].size, present: this.has(k), job: this.jobs[k] || null };
    const voices = VOICES.map((v) => ({ ...v, ready: v.files.every((k) => this.ok(k)) && BASE.every((k) => this.has(k)) }));
    const cust = (custom || []).map((c) => ({ ...c, custom: true, ready: fs.existsSync(c.modelPath) && BASE.every((k) => this.has(k)) }));
    return { dir: this.dir, files, voices: voices.concat(cust), baseReady: BASE.every((k) => this.has(k)) };
  }
  need(voiceId, custom) {
    const v = VOICES.find((x) => x.id === voiceId); const keys = [...BASE, ...(v ? v.files : [])];
    return keys.filter((k) => !this.ok(k));
  }
  resolve(voiceId, custom) {
    const v = VOICES.find((x) => x.id === voiceId);
    if (v) return { modelPath: this.use(v.model), spkPath: this.file(v.spk), sid: v.sid, targetHz: v.targetHz, gender: v.gender, tuned: v.tuned || null, adult: v.adult || null, youthful: !!v.youthful };
    const c = (custom || []).find((x) => x.id === voiceId);
    if (c) return { modelPath: c.modelPath, spkPath: c.spkPath || null, sid: c.sid || 0, targetHz: c.targetHz || (c.gender === 'male' ? 114 : 191), gender: c.gender, adult: null };
    return null;
  }
  // keys whose older version is on disk (v2.5.0 users): the app fetches the improved file in the background
  outdated() { return Object.keys(FILES).filter((k) => FILES[k].replaces && !this.has(k) && fs.existsSync(path.join(this.dir, FILES[k].replaces))); }
  paths() { return { cvPath: this.file('contentvec'), f0Path: this.has('rmvpe') ? this.file('rmvpe') : null }; }

  async download(keys) {
    for (const key of keys) {
      if (this.has(key) || this.jobs[key]?.state === 'downloading') continue;
      await this.fetchOne(key);
    }
  }
  async fetchOne(key) {
    const f = FILES[key]; const dst = this.file(key); const part = dst + '.part';
    const job = this.jobs[key] = { state: 'downloading', got: 0, total: f.size, error: null };
    const push = () => this.send({ key, ...job });
    const ctrl = new AbortController(); job.abort = () => ctrl.abort();
    try {
      const r = await fetch(f.url, { headers: { 'User-Agent': 'BlurSoundsPro' }, redirect: 'follow', signal: ctrl.signal });
      if (!r.ok) throw new Error(`download failed (HTTP ${r.status})`);
      const hash = crypto.createHash('sha256'); const out = fs.createWriteStream(part); let last = 0;
      for await (const chunk of Readable.fromWeb(r.body)) {
        hash.update(chunk); job.got += chunk.length;
        if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
        if (Date.now() - last > 250) { last = Date.now(); push(); }
      }
      await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
      const sha = hash.digest('hex');
      if (sha !== f.sha) { fs.rmSync(part, { force: true }); throw new Error(`${f.label}: checksum mismatch, the download was damaged or changed. Nothing was installed.`); }
      fs.renameSync(part, dst); job.state = 'done';
      if (f.replaces) try { fs.rmSync(path.join(this.dir, f.replaces), { force: true }); } catch {} this.log(`voice model ${f.name} ok (${sha.slice(0, 12)})`);
    } catch (e) {
      try { fs.rmSync(part, { force: true }); } catch {}
      job.state = ctrl.signal.aborted ? 'cancelled' : 'error'; job.error = ctrl.signal.aborted ? null : (e.name === 'TypeError' ? "Couldn't reach the download server. Check your internet connection." : e.message);
      this.log(`voice model ${f.name}: ${job.error || job.state}`);
    }
    delete job.abort; push(); return job;
  }
  cancel() { for (const j of Object.values(this.jobs)) if (j.abort) j.abort(); }
  remove(keys) { for (const k of keys) try { fs.rmSync(this.file(k), { force: true }); } catch {} }

  // Import an ONNX voice exported with tools/rvc2onnx.py (inputs phone/pitch/nsff0/spk/rnd/skip_head), plus its .spk table.
  importVoice(onnxPath, { name, gender } = {}) {
    if (!/\.onnx$/i.test(onnxPath)) {
      if (/\.pth$/i.test(onnxPath)) return { ok: false, error: 'This is a PyTorch .pth voice. Convert it once with tools/rvc2onnx.py (see the Voice page help), then import the .onnx it makes.' };
      return { ok: false, error: 'Pick an .onnx voice file.' };
    }
    const buf = fs.readFileSync(onnxPath);
    const txt = buf.subarray(0, Math.min(buf.length, 4 << 20)).toString('latin1');
    if (!['phone', 'nsff0', 'skip_head', 'spk'].every((n) => txt.includes(n))) return { ok: false, error: 'That ONNX file isn\'t an RVC v2 voice exported for Blur Sounds Pro (tools/rvc2onnx.py). Exports from other apps use different inputs.' };
    const id = 'custom-' + crypto.createHash('sha1').update(buf.subarray(0, 1 << 20)).digest('hex').slice(0, 10);
    const d = this.customDir(); const mp = path.join(d, id + '.onnx'); fs.copyFileSync(onnxPath, mp);
    let sp = null; const spkSrc = onnxPath.replace(/\.onnx$/i, '.spk');
    if (fs.existsSync(spkSrc)) { sp = path.join(d, id + '.spk'); fs.copyFileSync(spkSrc, sp); }
    return { ok: true, voice: { id, name: (name || path.basename(onnxPath, '.onnx')).slice(0, 40), gender: gender === 'male' ? 'male' : 'female', desc: 'Your imported voice', modelPath: mp, spkPath: sp, sid: 0, targetHz: gender === 'male' ? 115 : 210, source: 'Imported by you' } };
  }
}

module.exports = { VoiceModels, VOICES, FILES, BASE };
