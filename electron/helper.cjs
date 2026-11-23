// Spawns the bundled .NET audio helper and speaks JSON lines to it.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { EventEmitter } = require('events');

class Helper extends EventEmitter {
  constructor(exePath) {
    super();
    this.exePath = exePath; this.proc = null; this.seq = 0; this.pending = new Map(); this.status = 'stopped'; this.restarts = 0;
  }
  start() {
    if (!fs.existsSync(this.exePath)) { this.status = 'missing'; this.emit('status', this.status, 'helper not found at ' + this.exePath); return; }
    this.status = 'starting'; this.emit('status', this.status);
    const p = spawn(this.exePath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = p;
    readline.createInterface({ input: p.stdout }).on('line', (line) => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      if (msg.event === 'ready') { this.status = 'running'; this.emit('status', this.status); }
      if (msg.event) this.emit(msg.event, msg.data ?? msg);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve } = this.pending.get(msg.id); this.pending.delete(msg.id); resolve(msg);
      }
    });
    p.stderr.on('data', (d) => this.emit('log', { message: String(d) }));
    p.on('exit', (code) => {
      this.status = 'stopped'; this.emit('status', this.status, 'helper exited ' + code);
      for (const { resolve } of this.pending.values()) resolve({ ok: false, error: 'helper exited' });
      this.pending.clear();
      if (!this.stopping) { this.restarts++; setTimeout(() => this.start(), Math.min(30000, 1500 * this.restarts)); }
    });
    p.on('error', (e) => { this.status = 'error'; this.emit('status', this.status, e.message); });
  }
  call(cmd, args = {}) {
    if (!this.proc || this.status !== 'running') return Promise.resolve({ ok: false, error: 'helper not running' });
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      this.proc.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n');
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); resolve({ ok: false, error: 'timeout' }); } }, 5000);
    });
  }
  stop() { this.stopping = true; try { this.proc && this.proc.kill(); } catch {} }
}

module.exports = { Helper };
