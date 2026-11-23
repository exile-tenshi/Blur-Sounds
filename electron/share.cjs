// Share / export: re-encode a clip for a platform so it fits that platform's size, length and shape limits.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MB = 1000 * 1000;
// sizeBytes: hard file-size limit (target-size math). maxSec: platform length cap. shape: default framing.
const { presets: PRESETS, shapes: SHAPES } = require('./sharepresets.json');

function run(bin, args, timeoutMs = 60000) {
  return new Promise((res) => execFile(bin, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * MB }, (e, so, se) => res({ code: e ? e.code ?? 1 : 0, stdout: String(so), stderr: String(se) })));
}
async function probe(ff, file) {
  const r = await run(ff, ['-hide_banner', '-i', file]);
  const d = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(r.stderr);
  const v = /Video: .*?(\d{2,5})x(\d{2,5})/.exec(r.stderr); const f = /(\d+(?:\.\d+)?) fps/.exec(r.stderr);
  const audio = [...r.stderr.matchAll(/Stream #0:(\d+)(?:\[[^\]]*\])?(?:\(([^)]*)\))?: Audio:.*/g)].map((m, i) => ({ index: i, stream: +m[1] }));
  const titles = [...r.stderr.matchAll(/Audio:[\s\S]*?\n(?:\s+Metadata:\s*\n(?:\s+\w+\s*:.*\n)*?\s+title\s*:\s*(.*)\n)?/g)].map((m) => (m[1] || '').trim());
  audio.forEach((a, i) => { a.title = titles[i] || ['Desktop + mic', 'Desktop audio', 'Microphone'][i] || `Track ${i + 1}`; });
  return { duration: d ? +d[1] * 3600 + +d[2] * 60 + parseFloat(d[3]) : 0, width: v ? +v[1] : 0, height: v ? +v[2] : 0, fps: f ? parseFloat(f[1]) : 60, audio };
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);
// Work out resolution, fps and bitrates for a preset + options. Pure, used for the estimate and the real export.
function plan(src, o) {
  const p = PRESETS.find((x) => x.id === o.preset) || PRESETS[0];
  const start = Math.max(0, o.start || 0); let end = o.end > start ? Math.min(o.end, src.duration || o.end) : src.duration;
  const warnings = [];
  if (p.maxSec && end - start > p.maxSec) { end = start + p.maxSec; warnings.push(`${p.label} allows ${Math.floor(p.maxSec / 60)}:${String(p.maxSec % 60).padStart(2, '0')} max — trimmed to that length.`); }
  const dur = Math.max(0.5, end - start);
  const shape = o.shape || p.shape; const vertical = shape.startsWith('v-');
  const custom = p.id === 'custom';
  const sizeBytes = custom ? (Number(o.targetMB) > 0 ? Number(o.targetMB) * MB : 0) : p.sizeBytes || 0;
  const hasAudio = o.audio !== 'none' && src.audio.length > 0;
  let aKbps = hasAudio ? 160 : 0;
  let vKbps; let fps = Math.min(custom ? Number(o.fps) || 60 : p.fps, Math.round(src.fps) || 60);
  let H = custom ? Number(o.height) || 1080 : vertical ? 1920 : p.maxH;
  if (sizeBytes) {
    const budget = sizeBytes * 8 * 0.94 / 1000 / dur; // kbps for the whole file, 6% headroom for container + rate-control overshoot
    if (hasAudio) aKbps = budget < 600 ? 64 : budget < 1500 ? 96 : 128;
    vKbps = Math.floor(budget - aKbps);
    const cap = p.vKbpsCap || (!custom && p.vKbps); if (cap) vKbps = Math.min(vKbps, cap);
    if (!custom) { // drop resolution/fps when the bitrate gets thin so it still looks clean
      if (vKbps < 2500 && fps > 30) fps = 30;
      if (!vertical) { const wide = shape === 'native' && (src.width || 2560) / (src.height || 1080) > 1.9 ? 1.4 : 1; if (vKbps < 3000 * wide) H = Math.min(H, 720); if (vKbps < 1100 * wide) H = Math.min(H, 540); if (vKbps < 550 * wide) H = Math.min(H, 360); }
      else if (vKbps < 2500) H = Math.min(H, 1280);
    }
    if (vKbps < 100) { warnings.push(`Too long for ${(sizeBytes / MB).toFixed(0)} MB — trim it shorter.`); vKbps = 100; }
  } else vKbps = custom ? Number(o.vKbps) || p.vKbps : p.vKbps;
  // output frame size
  const sw = src.width || 2560, sh = src.height || 1080; let W;
  if (vertical) { W = even(H * 9 / 16); }
  else if (shape === 'native') { H = Math.min(H, sh); W = even(sw * H / sh); }
  else { H = Math.min(H, Math.max(sh, 720)); W = even(H * 16 / 9); }
  H = even(H);
  const estBytes = sizeBytes ? Math.min(sizeBytes * 0.97, (vKbps + aKbps) * 1000 * dur / 8 * 1.01) : (vKbps + aKbps) * 1000 * dur / 8 * 1.01;
  return { preset: p, start, end, dur, shape, W, H, fps, vKbps, aKbps, sizeBytes, estBytes, hasAudio, warnings, codec: custom && o.codec === 'hevc' ? 'hevc' : 'h264' };
}

function filterFor(pl) {
  const { W, H, fps, shape } = pl; const f = `fps=${fps}`;
  switch (shape) {
    case 'v-blur': return `[0:v]${f},split[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=28:3,eq=brightness=-0.08[bg];[b]scale=${W}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`;
    case 'v-crop': return `[0:v]${f},crop=ih*9/16:ih,scale=${W}:${H},format=yuv420p[v]`;
    case 'v-fit': return `[0:v]${f},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,format=yuv420p[v]`;
    case 'w-crop': return `[0:v]${f},crop='min(iw,ih*16/9)':'min(ih,iw*9/16)',scale=${W}:${H},format=yuv420p[v]`;
    case 'w-pad': return `[0:v]${f},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,format=yuv420p[v]`;
    default: return `[0:v]${f},scale=${W}:${H},format=yuv420p[v]`;
  }
}

class Sharer {
  constructor({ getFfmpeg, outDir, emit }) { this.ff = getFfmpeg; this.outDir = outDir; this.emit = emit; this.job = null; this.hwOk = null; }
  async info(file) { const ff = this.ff(); if (!ff) throw new Error('ffmpeg not found'); return probe(ff, file); }
  async plan(file, o) { const src = await this.info(file); const pl = plan(src, o); return { src, ...pl, preset: pl.preset.id, url: pl.preset.url }; }
  cancel() { if (this.job) { this.job.canceled = true; try { this.job.proc.kill(); } catch {} } return { ok: true }; }

  pass(args, pl, from, to) {
    return new Promise((resolve) => {
      const proc = spawn(this.ff(), ['-hide_banner', '-nostats', '-progress', 'pipe:1', ...args], { windowsHide: true });
      this.job.proc = proc; let err = '';
      proc.stdout.on('data', (d) => {
        const m = /out_time_us=(\d+)/g; let x, last = null; while ((x = m.exec(String(d)))) last = +x[1];
        if (last != null) this.emit({ stage: this.job.stage, pct: Math.min(99, from + (to - from) * Math.min(1, last / 1e6 / pl.dur)) });
      });
      proc.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
      proc.on('exit', (code) => resolve({ code, err }));
      proc.on('error', (e) => resolve({ code: -1, err: e.message }));
    });
  }

  async export(file, o) {
    if (this.job) return { ok: false, error: 'Another export is running' };
    const ff = this.ff(); if (!ff) return { ok: false, error: 'ffmpeg not found' };
    const src = await probe(ff, file); const pl = plan(src, o);
    const dir = path.join(this.outDir(), 'Exports'); fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(file).replace(/\.[^.]+$/, '');
    let out = path.join(dir, `${base} - ${pl.preset.label}${pl.sizeBytes ? ` ${Math.round(pl.sizeBytes / MB)}MB` : ''}.mp4`);
    for (let i = 2; fs.existsSync(out); i++) out = out.replace(/( \(\d+\))?\.mp4$/, ` (${i}).mp4`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsp-share-'));
    this.job = { proc: null, canceled: false, stage: 'Encoding' };
    const t0 = Date.now();
    const input = ['-ss', pl.start.toFixed(3), '-t', pl.dur.toFixed(3), '-i', file];
    const aIdx = { mix: 0, desktop: 1, mic: 2 }[o.audio || 'mix'] ?? 0;
    const audioMap = pl.hasAudio ? ['-map', `0:a:${Math.min(aIdx, src.audio.length - 1)}`, '-c:a', 'aac', '-b:a', `${pl.aKbps}k`, '-ac', '2', '-ar', '48000'] : ['-an'];
    const vf = ['-filter_complex', filterFor(pl), '-map', '[v]'];
    const tail = ['-movflags', '+faststart', '-map_metadata', '-1', '-y'];
    const hevc = pl.codec === 'hevc';
    const tries = [];
    const want = o.encoder || 'auto';
    if (want !== 'software') tries.push('hw');
    if (want !== 'hardware') tries.push('sw');
    let used = null; let lastErr = '';
    try {
      for (const t of tries) {
        if (this.job.canceled) break;
        let r;
        if (t === 'hw') {
          this.job.stage = 'Encoding (AMD hardware)';
          const k = pl.sizeBytes ? Math.floor(pl.vKbps * 0.9) : pl.vKbps; // AMF CBR overshoots a few %
          const rc = pl.sizeBytes ? ['-rc', 'cbr', '-b:v', `${k}k`, '-maxrate', `${k}k`, '-bufsize', `${k}k`] : ['-rc', 'vbr_peak', '-b:v', `${k}k`, '-maxrate', `${Math.round(k * 1.5)}k`];
          r = await this.pass([...input, ...vf, ...audioMap, '-c:v', hevc ? 'hevc_amf' : 'h264_amf', '-usage', 'transcoding', '-quality', 'quality', ...rc, '-g', String(pl.fps * 2), ...(hevc ? ['-tag:v', 'hvc1'] : []), ...tail, out], pl, 0, 100);
        } else {
          // x264/x265 two-pass: the reliable way to land under a size limit
          const log = path.join(tmp, 'pass');
          const k = pl.sizeBytes && used === 'hw-over' ? Math.floor(pl.vKbps * 0.9) : pl.vKbps;
          const enc = hevc ? ['-c:v', 'libx265', '-tag:v', 'hvc1'] : ['-c:v', 'libx264', '-profile:v', 'high'];
          const common = [...input, ...vf, ...enc, '-preset', 'medium', '-b:v', `${k}k`, '-maxrate', `${Math.round(k * 1.6)}k`, '-bufsize', `${k * 2}k`, '-g', String(pl.fps * 2)];
          const pkey = hevc ? ['-x265-params', `pass=1:stats=${log.replace(/\\/g, '/')}.log`] : ['-pass', '1', '-passlogfile', log];
          this.job.stage = 'Analyzing (pass 1 of 2)';
          r = await this.pass([...common, ...pkey, '-an', '-f', 'null', os.platform() === 'win32' ? 'NUL' : '/dev/null', '-y'], pl, 0, 45);
          if (r.code === 0 && !this.job.canceled) {
            this.job.stage = 'Encoding (pass 2 of 2)';
            const pkey2 = hevc ? ['-x265-params', `pass=2:stats=${log.replace(/\\/g, '/')}.log`] : ['-pass', '2', '-passlogfile', log];
            r = await this.pass([...common, ...pkey2, ...audioMap, ...tail, out], pl, 45, 100);
          }
        }
        if (this.job.canceled) break;
        if (r.code !== 0) { lastErr = r.err.trim().split('\n').slice(-2).join(' '); used = null; continue; }
        const size = fs.statSync(out).size;
        if (pl.sizeBytes && size > pl.sizeBytes) { used = 'hw-over'; lastErr = `came out ${(size / MB).toFixed(1)} MB`; continue; }
        used = t; break;
      }
      if (this.job.canceled) { try { fs.unlinkSync(out); } catch {} return { ok: false, canceled: true }; }
      if (used !== 'hw' && used !== 'sw') { try { fs.unlinkSync(out); } catch {} return { ok: false, error: `Export failed: ${lastErr || 'unknown error'}` }; }
      const size = fs.statSync(out).size;
      const res = { ok: true, file: out, size, seconds: (Date.now() - t0) / 1000, encoder: used === 'hw' ? (hevc ? 'AMD AMF (HEVC)' : 'AMD AMF (H.264)') : hevc ? 'x265 two-pass' : 'x264 two-pass', plan: { W: pl.W, H: pl.H, fps: pl.fps, vKbps: pl.vKbps, aKbps: pl.aKbps, dur: pl.dur }, url: pl.preset.url, preset: pl.preset.id, warnings: pl.warnings };
      this.emit({ stage: 'Done', pct: 100, done: res });
      if (o.copy !== false) res.copied = await copyFile(out);
      return res;
    } finally { this.job = null; try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  }
}

// Put the file on the clipboard as a file (CF_HDROP) so Ctrl+V in Discord/Explorer attaches it.
function copyFile(file) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    const lit = file.replace(/'/g, "''");
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', `Set-Clipboard -LiteralPath '${lit}'`], { windowsHide: true, timeout: 15000 }, (e) => resolve(!e));
  });
}

module.exports = { Sharer, PRESETS, SHAPES, plan, probe, copyFile };
