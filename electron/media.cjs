// Clips (rolling screen + audio buffer) and manual recording, built on ffmpeg + the audio helper.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function findFfmpeg(app) {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const c = [
    path.join(process.resourcesPath || '', 'ffmpeg', 'ffmpeg.exe'),
    path.join(app.getPath('userData'), 'bin', 'ffmpeg.exe'),
    path.join(pf, 'Blur Sounds', 'resources', 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
  ];
  return c.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

function run(bin, args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    execFile(bin, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
  });
}
function parseDuration(stderr) {
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(stderr);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
}
const safeName = (s) => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'clip';
const stamp = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}`;

class MediaManager {
  constructor({ app, helper, getSettings, emit }) {
    this.app = app; this.helper = helper; this.S = getSettings; this.emit = emit;
    this.ffmpeg = findFfmpeg(app);
    this.ringDir = path.join(os.tmpdir(), 'BlurSoundsPro-ring');
    this.ring = null; this.ringStartedAt = 0; this.ringError = '';
    this.saving = false; this.lastClip = null;
    this.rec = null; this.encoder = 'h264_amf';
  }
  clipsDir() { const d = this.S().clips.folder || path.join(this.app.getPath('videos'), 'Blur Sounds Pro', 'Clips'); fs.mkdirSync(d, { recursive: true }); return d; }
  recDir() { const d = this.S().record.folder || path.join(this.app.getPath('videos'), 'Blur Sounds Pro', 'Recordings'); fs.mkdirSync(d, { recursive: true }); return d; }
  thumbsDir(dir) { const d = path.join(dir, '.thumbs'); fs.mkdirSync(d, { recursive: true }); return d; }

  status() {
    return {
      ffmpeg: !!this.ffmpeg, ffmpegPath: this.ffmpeg, videoRing: !!this.ring, ringError: this.ringError,
      ringSeconds: this.ring ? Math.min(this.S().clips.seconds + 4, (Date.now() - this.ringStartedAt) / 1000) : 0,
      saving: this.saving, lastClip: this.lastClip,
      recording: this.rec ? { startedAt: this.rec.startedAt, video: !!this.rec.proc, path: this.rec.out } : null,
      clipsDir: this.clipsDir(), recDir: this.recDir(),
    };
  }

  videoArgs(fps, mbps, display) {
    return ['-f', 'lavfi', '-i', `ddagrab=output_idx=${display | 0}:framerate=${fps | 0},hwdownload,format=bgra`, '-pix_fmt', 'nv12',
      '-c:v', this.encoder, ...(this.encoder === 'h264_amf' ? ['-usage', 'transcoding', '-quality', 'speed', '-rc', 'cbr'] : ['-preset', 'veryfast', '-tune', 'zerolatency']),
      '-b:v', `${mbps | 0}M`, '-g', String(fps | 0)];
  }

  // ---------- rolling video buffer ----------
  syncRing() {
    const c = this.S().clips;
    const want = c.enabled && c.video.enabled && !!this.ffmpeg;
    const sig = JSON.stringify([c.video, c.seconds]);
    if (this.ring && (!want || this.ring.sig !== sig)) this.stopRing();
    if (want && !this.ring) this.startRing(sig);
  }
  startRing(sig) {
    const c = this.S().clips;
    try { fs.rmSync(this.ringDir, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(this.ringDir, { recursive: true });
    const wrap = Math.ceil((c.seconds + 6) / 2) + 2;
    const args = ['-hide_banner', '-loglevel', 'error', '-y', ...this.videoArgs(c.video.fps, c.video.bitrateMbps, c.video.display),
      '-f', 'segment', '-segment_time', '2', '-segment_wrap', String(wrap), '-reset_timestamps', '1', path.join(this.ringDir, 'seg%03d.ts')];
    const p = spawn(this.ffmpeg, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    p.on('exit', (code) => {
      if (this.ring && this.ring.proc === p) {
        this.ring = null; this.ringError = `screen capture stopped (${code}) ${err.trim().split('\n').pop() || ''}`;
        if (this.encoder === 'h264_amf' && /amf|encoder/i.test(err)) { this.encoder = 'libx264'; }
        if ((this.ringRestarts = (this.ringRestarts || 0) + 1) < 6) setTimeout(() => this.syncRing(), 3000);
        this.emit();
      }
    });
    this.ring = { proc: p, sig }; this.ringStartedAt = Date.now(); this.ringError = '';
  }
  stopRing() { const r = this.ring; this.ring = null; if (r) { try { r.proc.stdin.write('q'); } catch {} setTimeout(() => { try { r.proc.kill(); } catch {} }, 1500); } }

  // ---------- clips ----------
  async saveClip(reason = 'hotkey') {
    if (this.saving) return { ok: false, error: 'already saving' };
    const c = this.S().clips;
    if (!c.enabled) return { ok: false, error: 'Clip buffer is off' };
    this.saving = true; this.emit();
    const T = Date.now(); const N = c.seconds;
    const dir = this.clipsDir(); const base = `Clip ${stamp(new Date(T))}`;
    const tmp = path.join(os.tmpdir(), `bsp-clip-${T}`); fs.mkdirSync(tmp, { recursive: true });
    try {
      const wav = path.join(tmp, 'audio.wav');
      const a = await this.helper.call('saveClip', { path: wav, seconds: N + 3 });
      const A = a.ok ? a.result.seconds : 0;
      // audio tracks: 1 = desktop + mic (what players play), 2 = desktop only, 3 = mic only
      const tracks = A > 0 ? [[wav, 'Desktop + mic'], [a.result.desk, 'Desktop audio'], ...(a.result.mic ? [[a.result.mic, 'Microphone']] : [])].filter(([f]) => f && fs.existsSync(f)) : [];
      const audioIn = (ss) => tracks.flatMap(([f]) => ['-ss', ss, '-i', f]);
      const audioMap = (first) => tracks.flatMap(([, title], i) => ['-map', `${first + i}:a`, `-metadata:s:a:${i}`, `title=${title}`, ...(i === 0 ? ['-disposition:a:0', 'default'] : [`-disposition:a:${i}`, '0'])]);
      let out;
      if (this.ring && this.ffmpeg) {
        const segs = fs.readdirSync(this.ringDir).filter((f) => f.endsWith('.ts')).map((f) => ({ f: path.join(this.ringDir, f), t: fs.statSync(path.join(this.ringDir, f)).mtimeMs }))
          .filter((x) => x.t > T - (N + 8) * 1000).sort((x, y) => x.t - y.t).map((x) => x.f);
        if (!segs.length) throw new Error('video buffer is empty');
        // Segments restart their timestamps (-reset_timestamps), so join them with the concat demuxer,
        // which re-times each file. Copy first: the newest segment is still being written.
        const list = segs.map((s, i) => { const d = path.join(tmp, `s${String(i).padStart(3, '0')}.ts`); fs.copyFileSync(s, d); return `file '${d.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`; });
        fs.writeFileSync(path.join(tmp, 'list.txt'), list.join('\n'));
        const joined = path.join(tmp, 'joined.mp4');
        const jr = await run(this.ffmpeg, ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-map', '0:v', '-c', 'copy', joined]);
        if (jr.code !== 0) throw new Error('could not join video buffer: ' + jr.stderr.split('\n').slice(-2).join(' '));
        const Dj = parseDuration((await run(this.ffmpeg, ['-hide_banner', '-i', joined])).stderr);
        const vt = path.join(tmp, 'v.mp4');
        await run(this.ffmpeg, ['-hide_banner', '-y', ...(Dj > N ? ['-ss', (Dj - N).toFixed(3)] : []), '-i', joined, '-c', 'copy', '-avoid_negative_ts', 'make_zero', vt]);
        const probe = await run(this.ffmpeg, ['-hide_banner', '-i', vt]);
        const Dv = parseDuration(probe.stderr) || N;
        out = path.join(dir, `${base}.mp4`);
        const args = ['-hide_banner', '-y', '-i', vt];
        if (tracks.length) args.push(...audioIn(Math.max(0, A - Dv).toFixed(3)), '-map', '0:v', ...audioMap(1), '-c:a', 'aac', '-b:a', '192k', '-shortest');
        args.push('-c:v', 'copy', '-movflags', '+faststart', out);
        const r = await run(this.ffmpeg, args);
        if (r.code !== 0) throw new Error('mux failed: ' + r.stderr.split('\n').slice(-3).join(' '));
      } else {
        if (!A) throw new Error(a.error || 'audio buffer empty');
        out = path.join(dir, `${base}.m4a`);
        if (this.ffmpeg) {
          const r = await run(this.ffmpeg, ['-hide_banner', '-y', ...audioIn(Math.max(0, A - N).toFixed(3)), ...audioMap(0), '-c:a', 'aac', '-b:a', '192k', out]);
          if (r.code !== 0) throw new Error('encode failed');
        } else { out = path.join(dir, `${base}.wav`); fs.copyFileSync(wav, out); }
      }
      await this.thumb(out);
      const audio = a.ok ? { deskDb: a.result.deskDb, micDb: a.result.micDb, using: a.result.using } : null;
      this.lastClip = { path: out, at: T, reason, audio };
      const note = audio && audio.deskDb < -70 ? 'desktop audio was silent — check Clips → Audio source' : undefined;
      return { ok: true, path: out, reason, audio, note };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      this.saving = false; try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      this.emit();
    }
  }

  async thumb(file) {
    if (!this.ffmpeg || !/\.(mp4|mkv|mov)$/i.test(file)) return null;
    const t = path.join(this.thumbsDir(path.dirname(file)), path.basename(file) + '.jpg');
    await run(this.ffmpeg, ['-hide_banner', '-y', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', t], 20000);
    return fs.existsSync(t) ? t : null;
  }

  async library(kind = 'clips') {
    const dir = kind === 'clips' ? this.clipsDir() : this.recDir();
    const items = [];
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(mp4|m4a|wav|mkv)$/i.test(f)) continue;
      const p = path.join(dir, f); const st = fs.statSync(p);
      const th = path.join(dir, '.thumbs', f + '.jpg');
      items.push({ name: f.replace(/\.[^.]+$/, ''), file: p, ext: path.extname(f).slice(1).toLowerCase(), size: st.size, mtime: st.mtimeMs, thumb: fs.existsSync(th) ? th : null });
    }
    items.sort((a, b) => b.mtime - a.mtime);
    return { dir, items };
  }
  async duration(file) { if (!this.ffmpeg) return 0; return parseDuration((await run(this.ffmpeg, ['-hide_banner', '-i', file])).stderr); }

  async rename(file, name) {
    const dest = path.join(path.dirname(file), safeName(name) + path.extname(file));
    if (dest === file) return { ok: true, file };
    if (fs.existsSync(dest)) return { ok: false, error: 'A clip with that name already exists' };
    fs.renameSync(file, dest);
    const th = path.join(path.dirname(file), '.thumbs', path.basename(file) + '.jpg');
    if (fs.existsSync(th)) fs.renameSync(th, path.join(path.dirname(file), '.thumbs', path.basename(dest) + '.jpg'));
    return { ok: true, file: dest };
  }

  async trim(file, start, end) {
    if (!this.ffmpeg) return { ok: false, error: 'ffmpeg not found' };
    const ext = path.extname(file); const dest = path.join(path.dirname(file), `${path.basename(file, ext)} (trim ${stamp().slice(11)})${ext}`);
    const isVideo = /\.(mp4|mkv|mov)$/i.test(file);
    const v = isVideo ? (this.encoder === 'h264_amf' ? ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '20'] : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18']) : [];
    let r = await run(this.ffmpeg, ['-hide_banner', '-y', '-ss', start.toFixed(3), '-i', file, '-t', Math.max(0.1, end - start).toFixed(3), ...v, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', dest], 600000);
    if (r.code !== 0 && isVideo) r = await run(this.ffmpeg, ['-hide_banner', '-y', '-ss', start.toFixed(3), '-i', file, '-t', (end - start).toFixed(3), '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', dest], 600000);
    if (r.code !== 0) return { ok: false, error: r.stderr.split('\n').slice(-2).join(' ') };
    await this.thumb(dest);
    return { ok: true, file: dest };
  }

  // ---------- manual recording ----------
  async recStart() {
    if (this.rec) return { ok: false, error: 'already recording' };
    const r = this.S().record; const T = Date.now();
    const base = path.join(this.recDir(), `Recording ${stamp(new Date(T))}`);
    const tmp = path.join(os.tmpdir(), `bsp-rec-${T}`); fs.mkdirSync(tmp, { recursive: true });
    const wav = path.join(tmp, 'audio.wav');
    this.rec = { startedAt: T, wav, tmp, base, proc: null };
    this.emit('recConfig');
    const a = await this.helper.call('recStart', { path: wav });
    if (!a.ok) { this.rec = null; this.emit('recConfig'); return { ok: false, error: a.error }; }
    if (r.video && this.ffmpeg) {
      const c = this.S().clips.video; const vfile = path.join(tmp, 'video.mkv');
      const p = spawn(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...this.videoArgs(c.fps, Math.max(c.bitrateMbps, 20), c.display), vfile], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
      p.stderr.on('data', () => {});
      this.rec.proc = p; this.rec.vfile = vfile;
    }
    this.emit();
    return { ok: true };
  }
  async recStop() {
    const rec = this.rec; if (!rec) return { ok: false, error: 'not recording' };
    let vDone = Promise.resolve();
    if (rec.proc) { vDone = new Promise((res) => rec.proc.on('exit', res)); try { rec.proc.stdin.write('q'); } catch {} setTimeout(() => { try { rec.proc.kill(); } catch {} }, 8000); }
    const a = await this.helper.call('recStop');
    await vDone;
    this.rec = null; this.emit('recConfig');
    try {
      const A = a.ok ? a.result.seconds : 0; let out;
      if (rec.vfile && fs.existsSync(rec.vfile)) {
        const Dv = parseDuration((await run(this.ffmpeg, ['-hide_banner', '-i', rec.vfile])).stderr);
        out = rec.base + '.mp4';
        const args = ['-hide_banner', '-y', '-i', rec.vfile];
        if (A > 0) args.push('-ss', Math.max(0, A - Dv).toFixed(3), '-i', rec.wav, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '256k');
        args.push('-c:v', 'copy', '-movflags', '+faststart', out);
        const r = await run(this.ffmpeg, args, 900000);
        if (r.code !== 0) throw new Error('mux failed');
      } else if (this.ffmpeg) {
        out = rec.base + '.m4a';
        await run(this.ffmpeg, ['-hide_banner', '-y', '-i', rec.wav, '-c:a', 'aac', '-b:a', '256k', out], 600000);
      } else { out = rec.base + '.wav'; fs.copyFileSync(rec.wav, out); }
      await this.thumb(out);
      return { ok: true, path: out };
    } catch (e) { return { ok: false, error: e.message }; }
    finally { try { fs.rmSync(rec.tmp, { recursive: true, force: true }); } catch {} this.emit(); }
  }
  shutdown() { this.stopRing(); if (this.rec && this.rec.proc) { try { this.rec.proc.kill(); } catch {} } }
}

module.exports = { MediaManager, findFfmpeg };
