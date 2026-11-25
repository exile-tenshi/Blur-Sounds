// Spawns the bundled .NET audio helper and speaks JSON lines to it.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { EventEmitter } = require('events');

// Known helper exit codes -> readable message + how to fix it. `fatal` = restarting won't help, so we stop and wait for Retry.
const hx = (n) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
function explainExit(code, signal) {
  if (code == null) return { message: `The audio engine was stopped${signal ? ` (${signal})` : ''}.`, hint: 'It restarts automatically. If it keeps stopping, press Retry and check the logs.', fatal: false };
  const u = code >>> 0;
  const known = {
    0x80008096: ['The audio engine could not find the .NET runtime it needs.', 'This build is missing its bundled runtime. Download the latest Blur Sounds Pro release (2.2.2 or newer includes it), or install the .NET 8 Desktop Runtime (x64) from Microsoft.'],
    0x80008083: ['The audio engine could not find the .NET runtime it needs.', 'Download the latest Blur Sounds Pro release (2.2.2 or newer includes the runtime), or install the .NET 8 Desktop Runtime (x64).'],
    0xC0000135: ['A file the audio engine needs (a DLL) is missing.', 'Extract the whole zip again into a new folder (don\'t run it from inside the zip) and check that your antivirus didn\'t quarantine anything in resources\\helper.'],
    0xC000007B: ['A DLL in the audio engine folder is damaged or the wrong type.', 'Extract the whole zip again into a new folder. Blur Sounds Pro needs 64-bit Windows 10 or 11.'],
    0xC0000005: ['The audio engine crashed.', 'Press Retry. If it keeps crashing, update your audio drivers and send the helper log.'],
    0xC0000409: ['The audio engine crashed.', 'Press Retry. If it keeps crashing, send the helper log.'],
    0xE0434352: ['The audio engine hit an unexpected error.', 'Press Retry. The details are in the helper log.'],
    3: ['Windows Audio isn\'t available.', 'Make sure the "Windows Audio" service is running (services.msc) and that at least one audio device is enabled, then press Retry.'],
  };
  const fatalCodes = new Set([0x80008096, 0x80008083, 0xC0000135, 0xC000007B, 3]);
  if (known[u]) return { message: known[u][0], hint: known[u][1], fatal: fatalCodes.has(u), code: `${u} (${hx(u)})` };
  if (u >= 0x80008080 && u <= 0x800080AF) return { message: 'The audio engine\'s .NET host failed to start.', hint: 'Extract the latest release into a new folder. If it still fails, send the helper log.', fatal: true, code: `${u} (${hx(u)})` };
  return { message: 'The audio engine stopped unexpectedly.', hint: 'It restarts automatically. If it keeps stopping, press Retry and check the logs.', fatal: false, code: `${u} (${hx(u)})` };
}
function explainSpawnError(e) {
  const c = e && e.code;
  if (c === 'ENOENT') return { message: 'The audio engine program is missing.', hint: 'Extract the whole zip again. Your antivirus may have removed resources\\helper\\BspAudioHelper.exe; restore it or add an exception.', fatal: true, code: c };
  if (c === 'EACCES' || c === 'EPERM' || c === 'UNKNOWN') return { message: 'Windows blocked the audio engine from starting.', hint: 'Your antivirus or Smart App Control may be blocking resources\\helper\\BspAudioHelper.exe. Allow it, then press Retry.', fatal: true, code: c };
  return { message: 'The audio engine could not start: ' + (e && e.message), hint: 'Press Retry and check the logs.', fatal: true, code: c || '' };
}

class Helper extends EventEmitter {
  constructor(exePath, logFile) {
    super();
    this.exePath = exePath; this.logFile = logFile; this.proc = null; this.seq = 0; this.pending = new Map(); this.status = 'stopped'; this.restarts = 0; this.fastFails = 0;
  }
  log(line) {
    if (!this.logFile) return;
    try {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      try { if (fs.statSync(this.logFile).size > 1024 * 1024) fs.renameSync(this.logFile, this.logFile + '.old'); } catch {}
      fs.appendFileSync(this.logFile, `[${new Date().toISOString()}] ${String(line).replace(/\s+$/, '')}\n`);
    } catch {}
  }
  setStatus(st, info) {
    this.status = st; this.info = info || null;
    this.emit('status', st, info ? info.message : '', info || null);
  }
  start() {
    clearTimeout(this.timer); this.stopping = false;
    if (!fs.existsSync(this.exePath)) {
      const info = { message: 'The audio engine program is missing.', hint: 'Extract the whole zip again. Your antivirus may have removed resources\\helper\\BspAudioHelper.exe; restore it or add an exception.', fatal: true, code: 'missing' };
      this.log('helper not found at ' + this.exePath); this.setStatus('missing', info); return;
    }
    this.setStatus('starting'); this.log('starting ' + this.exePath);
    const started = Date.now();
    let p;
    // v2.6.3: detached, so Windows doesn't kill the helper together with the app (Node puts children in a kill-on-close
    // job). If the app is force-closed or crashes, the helper sees its input close, puts any app it turned down back to
    // normal volume, and exits on its own. BSP_STATE_DIR: where it keeps the list of turned-down apps (ducked.json).
    const env = { ...process.env }; if (this.logFile) env.BSP_STATE_DIR = path.dirname(path.dirname(this.logFile));
    try { p = spawn(this.exePath, [], { windowsHide: true, detached: true, env, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { const info = explainSpawnError(e); this.log('spawn failed: ' + e.message); this.setStatus('error', info); return; }
    this.proc = p; let spawnErr = null;
    readline.createInterface({ input: p.stdout }).on('line', (line) => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      if (msg.event === 'ready') { this.fastFails = 0; this.spawnRetries = 0; this.setStatus('running'); this.log('ready'); }
      if (msg.event === 'fatal') this.log('fatal: ' + (msg.message || msg.code));
      if (msg.event === 'log') this.log(msg.message);
      if (msg.event) this.emit(msg.event, msg.data ?? msg);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve } = this.pending.get(msg.id); this.pending.delete(msg.id); resolve(msg);
      }
    });
    p.stderr.on('data', (d) => { this.log(String(d)); this.emit('log', { message: String(d) }); });
    p.on('error', (e) => {
      spawnErr = e; this.log('spawn error: ' + e.message);
      // Antivirus often holds a freshly extracted exe for a few seconds on first run: try twice more before giving up.
      if ((this.spawnRetries = (this.spawnRetries || 0) + 1) <= 2 && !this.stopping) { this.setStatus('starting'); this.timer = setTimeout(() => this.start(), 3000); return; }
      this.setStatus('error', explainSpawnError(e));
    });
    p.on('exit', (code, signal) => {
      if (this.proc === p) this.proc = null;
      for (const { resolve } of this.pending.values()) resolve({ ok: false, error: 'helper exited' });
      this.pending.clear();
      if (spawnErr) return; // already reported; don't loop
      const info = explainExit(code, signal);
      this.log(`exited code=${code}${code != null ? ' ' + hx(code) : ''} signal=${signal || ''} -> ${info.message}`);
      if (this.stopping) { this.setStatus('stopped', info); return; }
      if (Date.now() - started < 10000) this.fastFails++; else this.fastFails = 0;
      if (info.fatal || this.fastFails >= 5) {
        if (!info.fatal) info.hint = 'It failed to start 5 times in a row. ' + info.hint;
        info.fatal = true; this.setStatus('failed', info); return; // wait for Retry
      }
      this.setStatus('stopped', info);
      this.restarts++; this.timer = setTimeout(() => this.start(), Math.min(30000, 1500 * this.restarts));
    });
  }
  retry() { this.fastFails = 0; this.restarts = 0; this.spawnRetries = 0; if (this.proc) { this.stopping = false; try { this.proc.kill(); } catch {} return; } this.start(); }
  call(cmd, args = {}) {
    if (!this.proc || this.status !== 'running') return Promise.resolve({ ok: false, error: 'helper not running' });
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      this.proc.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n');
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); resolve({ ok: false, error: 'timeout' }); } }, 5000);
    });
  }
  // v2.6.3: close its input first so it can put turned-down apps back, then make sure it's gone
  stop() { this.stopping = true; clearTimeout(this.timer); const p = this.proc; if (!p) return; try { p.stdin.end(); } catch {} setTimeout(() => { try { if (p.exitCode == null) p.kill(); } catch {} }, 1500); }
}

module.exports = { Helper, explainExit, explainSpawnError };
