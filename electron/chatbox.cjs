// Magic Chatbox engine: composes modules and sends them to VRChat over OSC.
const dgram = require('dgram');
const { encode } = require('./osc.cjs');
const SCHEMA = require('./cbschema.json');
const T = require('./cbtext.cjs');
const { Weather, Twitch, VrcLog, OscIn, cpuPercent } = require('./cbsources.cjs');
const os = require('os');

const MAX = 144;            // VRChat chatbox limit (counted in UTF-16 units, like VRChat itself)
const MIN_GAP_MS = 1500;    // VRChat drops chatbox spam faster than ~1.5s
const DEFAULTS = Object.fromEntries(SCHEMA.groups.flatMap((g) => g.fields).filter((f) => !f.legacy && f.type !== 'widget' || ['style.prefix', 'style.suffix', 'pages.map'].includes(f.id)).map((f) => [f.id, f.default]));
const MODULE_IDS = SCHEMA.modules.map((m) => m.id);

function fmtTime(d, h24, sec, colon = ':') {
  let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0'); const s = String(d.getSeconds()).padStart(2, '0');
  if (h24) return `${String(h).padStart(2, '0')}${colon}${m}${sec ? colon + s : ''}`;
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${h}${colon}${m}${sec ? colon + s : ''} ${ap}`;
}
function fmtDur(s) { if (!isFinite(s) || s < 0) return '0:00'; s = Math.floor(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function fmtLong(sec) {
  sec = Math.max(0, Math.floor(sec)); const d = Math.floor(sec / 86400), h = Math.floor(sec / 3600) % 24, m = Math.floor(sec / 60) % 60, s = sec % 60;
  if (d) return `${d}d ${h}h`; if (h) return `${h}h ${m}m`; if (m) return `${m}m`; return `${s}s`;
}
function fmtClock(sec) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60; return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`; }
const ulen = (s) => String(s).length; // UTF-16 units
function truncate(text, max = MAX) {
  if (ulen(text) <= max) return text;
  let out = ''; for (const c of Array.from(text)) { if (ulen(out + c) > max - 1) break; out += c; }
  return out + '…';
}
function prettyApp(id) {
  const s = String(id || '').toLowerCase();
  for (const [k, v] of [['spotify', 'Spotify'], ['nocturne', 'Nocturne'], ['chrome', 'Chrome'], ['opera', 'Opera'], ['firefox', 'Firefox'], ['msedge', 'Edge'], ['youtube', 'YouTube Music'], ['apple', 'Apple Music']]) if (s.includes(k)) return v;
  return String(id || '').split(/[!\\/]/).pop().replace(/\.exe$/i, '');
}
const BARS = { line: ['▬', '●', '─'], heavy: ['━', '╸', '─'], blocks: ['▰', '', '▱'], dots: ['●', '', '○'], shade: ['█', '', '░'] };
function bar(frac, len, style) {
  const [f, h, e] = BARS[style] || BARS.line; frac = Math.max(0, Math.min(1, frac || 0));
  if (h) { const pos = Math.min(len - 1, Math.floor(frac * len)); return f.repeat(pos) + h + e.repeat(len - pos - 1); }
  const n = Math.round(frac * len); return f.repeat(n) + e.repeat(len - n);
}
function parseSchedule(lines, now) {
  const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const mins = now.getHours() * 60 + now.getMinutes();
  for (const raw of String(lines || '').split('\n')) {
    const m = /^\s*(?:([A-Za-z ,\-]+?)\s+)?(\d{1,2}):(\d\d)\s*-\s*(\d{1,2}):(\d\d)\s*\|\s*(.+)$/.exec(raw); if (!m) continue;
    if (m[1]) {
      const days = new Set();
      for (const part of m[1].toLowerCase().split(',').map((x) => x.trim()).filter(Boolean)) {
        const [x, y] = part.split('-').map((d) => DAYS[d.slice(0, 3)]);
        if (x === undefined) continue; if (y === undefined) days.add(x); else for (let d = x; ; d = (d + 1) % 7) { days.add(d); if (d === y) break; }
      }
      if (days.size && !days.has(now.getDay())) continue;
    }
    const a = +m[2] * 60 + +m[3], b = +m[4] * 60 + +m[5];
    if (a <= b ? mins >= a && mins < b : mins >= a || mins < b) return m[6].trim();
  }
  return null;
}

class Chatbox {
  constructor(getSettings, onState, helper) {
    this.getSettings = getSettings; this.onState = onState; this.helper = helper;
    this.sock = dgram.createSocket('udp4');
    this.sock.on('error', (e) => this.log('socket: ' + e.message));
    this.media = null; this.focus = null;
    this.statusIndex = 0; this.statusSwitchedAt = Date.now();
    this.message = null; this.lastSentText = null; this.lastSentAt = 0; this.sendCount = 0; this.frame = 0;
    this.lastError = null; this.typing = false; this.lastTypingAt = 0;
    this.weather = new Weather(() => {}); this.twitch = new Twitch(); this.vrc = new VrcLog(); this.osc = new OscIn();
    this.sys = {}; this.sysAt = 0; this.cpu = 0; this.afkSince = null; this.page = 0; this.pageAt = Date.now(); this.split = 0;
    this.quoteIdx = -1; this.quoteAt = 0; this.factIdx = -1; this.factAt = 0; this.pending = null;
    const c = this.cfg(); if (!c.stopwatch) c.stopwatch = { running: false, startedAt: 0, acc: 0 };
    this.liveSince = c.live ? Date.now() : null;
    this.timer = setInterval(() => this.tick(), 250);
    this.slow = setInterval(() => this.poll().catch(() => {}), 2000);
    setTimeout(() => this.poll().catch(() => {}), 800);
  }
  log(m) { this.lastError = m; }
  cfg() { return this.getSettings().chatbox; }
  o() { return { ...DEFAULTS, ...(this.cfg().opt || {}) }; }
  setMedia(m) { this.media = m; if (m && m.focus) this.focus = m.focus; }

  // ---------- data sources ----------
  async poll() {
    const o = this.o(); const c = this.cfg(); const m = c.modules;
    const needSys = o['pc.enabled'] || o['net.enabled'] || o['uptime.enabled'] || o['battery.enabled'] || o['afk.enabled'] || o['clear.afk'] || o['clear.vrcClosed'] || o['vrc.world'] || o['vrc.players'] || o['vrc.instance'];
    if (needSys && this.helper && Date.now() - this.sysAt > 2500) {
      this.sysAt = Date.now();
      try { const r = await this.helper.call('sysStats', { pingHost: o['net.enabled'] ? o['net.host'] || '1.1.1.1' : '' }); if (r.ok) this.sys = r.result || {}; } catch {}
      this.cpu = cpuPercent();
    }
    if (o['weather.enabled']) this.weather.refresh(o).catch(() => {});
    if (o['twitch.enabled']) this.twitch.refresh(o).catch(() => {});
    if (o['vrc.world'] || o['vrc.players'] || o['vrc.instance'] || o['vrc.timeInWorld'] || o['vrc.joinNotice']) this.vrc.poll();
    const needOsc = o['vrc.mute'] || o['hr.enabled'] || o['afk.enabled'] || o['clear.afk'];
    this.osc.ensure(needOsc ? Number(o['osc.port']) || 9001 : 0);
  }
  refreshWeather() { return this.weather.refresh(this.o(), true); }

  osc_(address, args) {
    const c = this.cfg();
    this.sock.send(encode(address, args), Number(c.port) || 9000, c.ip || '127.0.0.1', (err) => { if (err) this.log(err.message); });
  }
  setTyping(on) {
    const c = this.cfg(); const o = this.o();
    if (!c.typingIndicator || o['typing.mode'] === 'off' || !c.live) return;
    const now = Date.now();
    if (on === this.typing && now - this.lastTypingAt < 1000) return;
    this.typing = on; this.lastTypingAt = now;
    this.osc_('/chatbox/typing', [!!on]);
  }
  sendMessage(text) {
    text = String(text || '').trim();
    if (!text) return { ok: false, error: 'empty' };
    const c = this.cfg(); const o = this.o();
    if (o['filter.enabled'] && o['filter.mode'] === 'block' && T.profanity(text, 'mask', o['filter.words']).hit) return { ok: false, error: 'Blocked by the profanity filter' };
    const tw = o['typewriter.enabled'] ? Math.max(2, Number(o['typewriter.step']) || 8) : 0;
    const gap = Math.max(MIN_GAP_MS, (Number(c.sendIntervalSec) || 2) * 1000);
    const extra = tw ? Math.ceil(Array.from(text).length / tw) * gap : 0;
    this.message = { text: truncate(text), until: Date.now() + (c.modules.message.durationSec || 12) * 1000 + extra, startFrame: this.frame, fresh: true };
    if (this.typing) { this.typing = false; if (c.live) this.osc_('/chatbox/typing', [false]); }
    this.lastSentText = null;
    return { ok: true };
  }
  clearMessage() { this.message = null; this.lastSentText = null; }
  stopwatch(action) {
    const c = this.cfg(); const sw = c.stopwatch || (c.stopwatch = { running: false, startedAt: 0, acc: 0 });
    if (action === 'start' && !sw.running) { sw.running = true; sw.startedAt = Date.now(); }
    else if (action === 'pause' && sw.running) { sw.acc += Date.now() - sw.startedAt; sw.running = false; }
    else if (action === 'reset') { sw.running = false; sw.acc = 0; sw.startedAt = 0; }
    return sw;
  }
  stopwatchSec() { const sw = this.cfg().stopwatch || {}; return ((sw.acc || 0) + (sw.running ? Date.now() - sw.startedAt : 0)) / 1000; }

  statusItems() { return (this.cfg().modules.status.items || []).filter((i) => i.enabled && i.text && i.text.trim()); }

  // ---------- modules ----------
  modules(now, o) {
    const c = this.cfg(); const m = c.modules; const P = {}; const pack = o['style.emojiPack']; const I = (k) => T.icon(pack, k);
    const sys = this.sys || {}; const vrcRunning = sys.vrchat !== false;
    // status (schedule overrides the rotator)
    const sched = o['sched.enabled'] ? parseSchedule(o['sched.items'], now) : null;
    const items = this.statusItems();
    if (sched) P.status = sched;
    else if (m.status.enabled && items.length) {
      const rot = Math.max(2, Number(m.status.rotateSec) || 5) * 1000;
      if (Date.now() - this.statusSwitchedAt >= rot) {
        this.statusSwitchedAt = Date.now();
        this.statusIndex = m.status.random && items.length > 1 ? (this.statusIndex + 1 + Math.floor(Math.random() * (items.length - 1))) % items.length : this.statusIndex + 1;
      }
      P.status = items[this.statusIndex % items.length].text.trim();
    }
    // message (+ typewriter)
    if (this.message && Date.now() < this.message.until) {
      let t = this.message.text;
      if (o['typewriter.enabled']) { const n = (this.frame - this.message.startFrame + 1) * Math.max(2, Number(o['typewriter.step']) || 8); const ch = Array.from(t); if (n < ch.length) t = ch.slice(0, n).join('') + '▌'; }
      P.message = t;
    } else if (this.message) this.message = null;
    // now playing
    const md = this.media;
    if (m.nowPlaying.enabled && md && md.title) {
      const playing = md.status === 'playing';
      if (playing || m.nowPlaying.showPaused) {
        const presets = { default: '{icon} {title} ᵇʸ {artist}', compact: '{icon} {title} - {artist}', artist: '{icon} {artist} — {title}', title: '{icon} {title}', fancy: '{icon} 「{title}」 ⁻ {artist}' };
        let tpl = playing ? (o['np.preset'] === 'custom' ? m.nowPlaying.template : presets[o['np.preset']] || m.nowPlaying.template) : (o['np.paused'] || '⏸ {title}');
        const maxT = Number(o['np.maxTitle']) || 40; const title = Array.from(md.title || '').length > maxT ? Array.from(md.title).slice(0, maxT - 1).join('') + '…' : md.title || '';
        let s = tpl.replace(/\{icon\}/g, o['np.icon'] || '').replace(/\{title\}/g, title).replace(/\{artist\}/g, md.artist || '').replace(/\{album\}/g, md.album || '').trim();
        if (o['np.album'] && md.album && !tpl.includes('{album}')) s += ` · ${md.album}`;
        if (o['np.source'] && md.app) s += ` on ${prettyApp(md.app)}`;
        if ((m.nowPlaying.progress || o['np.bar']) && md.duration > 0) {
          const el = Math.min(md.duration, playing ? (md.position || 0) + (Date.now() - (md.updated || Date.now())) / 1000 : (md.position || 0));
          if (o['np.bar']) s += ` ${bar(el / md.duration, Number(o['np.barLength']) || 10, o['np.barStyle'])}`;
          if (m.nowPlaying.progress) s += ` ${fmtDur(el)}/${fmtDur(md.duration)}`;
        }
        P.nowPlaying = s.replace(/\s+ᵇʸ\s*$/, '').replace(/\s+-\s*$/, '').trim();
      }
    }
    // focused app (+ playtime)
    const ign = String(o['focus.ignore'] || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
    if (m.focus.enabled && this.focus && this.focus.name && !ign.includes(String(this.focus.process || '').toLowerCase())) {
      let s = m.focus.template.replace(/\{app\}/g, this.focus.name);
      if (o['focus.playtime'] && this.focus.started > 0) s += ` · ${I('play')}${fmtLong((Date.now() - this.focus.started) / 1000)}`;
      P.focus = s;
    }
    // clock, date, second time zone
    if (m.time.enabled) {
      const colon = o['time.blink'] && this.frame % 2 ? ' ' : ':';
      P.time = (o['time.emojiClock'] ? T.clockEmoji(now) + ' ' : (m.time.prefix || '')) + fmtTime(now, m.time.h24, m.time.showSeconds, colon);
    }
    if (o['date.enabled']) {
      const f = o['date.format']; const Y = now.getFullYear(), M = String(now.getMonth() + 1).padStart(2, '0'), Dd = String(now.getDate()).padStart(2, '0');
      const txt = f === 'us' ? `${M}/${Dd}/${Y}` : f === 'eu' ? `${Dd}/${M}/${Y}` : f === 'iso' ? `${Y}-${M}-${Dd}`
        : f === 'long' ? now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : f === 'day' ? now.toLocaleDateString('en-US', { weekday: 'long' })
        : now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      P.date = I('date') + txt;
    }
    if (o['tz.enabled']) {
      try { P.tz = `${I('tz')}${o['tz.label'] ? o['tz.label'] + ' ' : ''}${now.toLocaleTimeString('en-US', { timeZone: o['tz.zone'], hour: 'numeric', minute: '2-digit', hour12: !m.time.h24 })}`; } catch { P.tz = `${I('tz')}bad time zone`; }
    }
    // weather
    if (o['weather.enabled']) {
      const w = this.weather.data;
      if (w) {
        const presets = { full: '{icon} {city}: {temp} {cond} · H{hi} L{lo} · feels {feels} · 💨 {wind} · 💧 {hum}', standard: '{icon} {temp} {cond} · H{hi} L{lo} · feels {feels} · 💨{wind} 💧{hum}', short: '{icon} {temp} {cond} · H{hi} L{lo}', compact: '{icon} {temp} · {hi}/{lo} · 💨{wind} 💧{hum}', minimal: '{icon} {temp}' };
        const auto = !o['weather.preset'] || o['weather.preset'] === 'auto';
        const build = (tpl) => {
        if (o['weather.showCity'] && !tpl.includes('{city}')) tpl = '{city}: ' + tpl;
        if (!o['weather.showCity'] && o['weather.preset'] !== 'full' && o['weather.preset'] !== 'custom') tpl = tpl.replace('{city}: ', '');
        let s = tpl.replace(/\{icon\}/g, w.icon).replace(/\{temp\}/g, `${w.temp}${w.unit}`).replace(/\{cond\}/g, w.cond).replace(/\{hi\}/g, `${w.hi}°`).replace(/\{lo\}/g, `${w.lo}°`)
          .replace(/\{feels\}/g, `${w.feels}°`).replace(/\{wind\}/g, `${w.wind} ${w.windUnit}`).replace(/\{hum\}/g, `${w.hum}%`).replace(/\{city\}/g, w.city || '').replace(/\{rain\}/g, w.rain != null ? `${w.rain}%` : '—');
        if (o['weather.tomorrow']) s += ` · tmrw ${w.hi2}°/${w.lo2}°`;
        if (o['weather.rain'] && w.rain != null) s += ` · ☔${w.rain}%`;
        if (o['weather.sun'] && w.sunrise) {
          const locNow = Date.now() + w.utcOffset * 1000; const ev = [];
          for (let i = 0; i < 2; i++) { ev.push(['🌅', Date.parse(w.sunrise[i] + 'Z')]); ev.push(['🌇', Date.parse(w.sunset[i] + 'Z')]); }
          const next = ev.filter(([, t]) => t > locNow).sort((x, y) => x[1] - y[1])[0];
          if (next) { const d = new Date(next[1]); let h = d.getUTCHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; s += ` · ${next[0]} ${h}:${String(d.getUTCMinutes()).padStart(2, '0')} ${ap}`; }
        }
        return s; };
        // Auto: start with the full detail line; compose() steps down to shorter variants if the box runs out of room
        this.weatherVariants = auto ? [presets.standard, presets.short, presets.compact, presets.minimal].map(build) : null;
        P.weather = auto ? this.weatherVariants[0] : build(o['weather.preset'] === 'custom' ? o['weather.template'] : presets[o['weather.preset']] || presets.standard);
      }
    }
    // PC stats
    if (o['pc.enabled']) {
      const bars = o['pc.style'] === 'bars'; const v = (p) => (bars ? bar(p / 100, 5, 'blocks') : `${Math.round(p)}%`); const out = [];
      if (o['pc.cpu']) out.push(`CPU ${v(this.cpu)}${o['pc.temps'] && sys.boardTemp ? ` ${sys.boardTemp}°C` : ''}`);
      if (o['pc.gpu'] && sys.gpu != null) out.push(`${(o['pc.gpuName'] || 'GPU').trim()} ${v(sys.gpu)}${o['pc.temps'] && sys.gpuTemp ? ` ${sys.gpuTemp}°C` : ''}`);
      if (o['pc.vram'] && sys.vramUsed != null) out.push(`VRAM ${sys.vramUsed}${sys.vramTotal ? '/' + sys.vramTotal : ''}GB`);
      if (o['pc.ram']) { const tot = os.totalmem(), used = tot - os.freemem(); out.push(o['pc.ramMode'] === 'gb' ? `RAM ${(used / 2 ** 30).toFixed(1)}/${Math.round(tot / 2 ** 30)}GB` : `RAM ${v(100 * used / tot)}`); }
      if (out.length) P.pc = I('pc') + out.join(' · ');
    }
    if (o['net.enabled']) P.net = sys.ping != null ? `${I('net')}${sys.ping} ms${o['net.quality'] ? ' ' + (sys.ping < 50 ? '🟢' : sys.ping < 100 ? '🟡' : '🔴') : ''}` : `${I('net')}ping —`;
    if (o['uptime.enabled'] && sys.uptimeSec) P.uptime = `${I('uptime')}up ${fmtLong(sys.uptimeSec)}`;
    if (o['battery.enabled'] && sys.battery != null) P.battery = `${I('battery')}${sys.battery}%${sys.charging ? '⚡' : ''}`;
    // timers
    if (o['countdown.enabled'] && o['countdown.target']) {
      const t = new Date(o['countdown.target']).getTime();
      if (isFinite(t)) { const left = (t - Date.now()) / 1000; P.countdown = (left > 0 ? o['countdown.format'] : o['countdown.done']).replace(/\{label\}/g, o['countdown.label'] || '').replace(/\{left\}/g, left > 0 ? (left < 3600 ? fmtClock(left) : fmtLong(left)) : ''); }
    }
    if (o['stopwatch.enabled']) P.stopwatch = String(o['stopwatch.format'] || '⏱ {time}').replace(/\{time\}/g, fmtClock(this.stopwatchSec()));
    if (o['session.enabled'] && this.liveSince) P.session = String(o['session.format'] || '⌛ {time}').replace(/\{time\}/g, fmtLong((Date.now() - this.liveSince) / 1000));
    // AFK
    const op = this.osc.params; const vrcAfkKnown = 'AFK' in op;
    const afk = vrcAfkKnown ? op.AFK === true : (sys.idleSec || 0) >= (Number(o['afk.minutes']) || 5) * 60;
    if (afk && !this.afkSince) this.afkSince = Date.now() - (vrcAfkKnown ? 0 : (sys.idleSec || 0) * 1000); if (!afk) this.afkSince = null;
    this.isAfk = afk;
    if (o['afk.enabled'] && afk) P.afk = String(o['afk.text'] || '💤 AFK {dur}').replace(/\{dur\}/g, fmtLong((Date.now() - this.afkSince) / 1000));
    // VRChat log + OSC
    const W = this.vrc.world;
    if (vrcRunning && W && (o['vrc.world'] || o['vrc.instance'] || o['vrc.timeInWorld'])) {
      const bits = [];
      if (o['vrc.world']) bits.push(o['vrc.privacy'] && W.private ? '🔒 private world' : W.name || 'unknown world');
      if (o['vrc.instance'] && W.type) bits.push(`${W.type}${W.region ? ' ' + W.region : ''}`);
      if (o['vrc.timeInWorld'] && W.since) bits.push(fmtLong((Date.now() - W.since) / 1000));
      if (bits.length) P.vrcWorld = I('world') + bits.join(' · ');
    }
    if (vrcRunning && (o['vrc.players'] || o['vrc.joinNotice'])) {
      const bits = [];
      if (o['vrc.players'] && this.vrc.players.size) bits.push(`${I('players')}${this.vrc.players.size}`);
      const j = this.vrc.lastJoin; if (o['vrc.joinNotice'] && j && !j.initial && Date.now() - j.at < 8000) bits.push(`${I('join')}${j.name}`);
      if (bits.length) P.vrcPlayers = bits.join(' · ');
    }
    if (o['vrc.mute'] && op.MuteSelf === true) P.vrcMute = o['vrc.muteText'] || '🔇 muted';
    if (o['hr.enabled']) { const bpm = this.osc.heartRate(String(o['hr.param'] || '').trim()); if (bpm && Date.now() - this.osc.lastAt < 15000) P.hr = String(o['hr.format'] || '❤️ {bpm} bpm').replace(/\{bpm\}/g, bpm); }
    // streaming
    if (o['twitch.enabled'] && this.twitch.data) {
      const t = this.twitch.data;
      if (t.live) { const b = [`${I('twitch')}LIVE twitch.tv/${t.channel}`]; if (o['twitch.viewers'] && t.viewers != null) b.push(`👁 ${t.viewers}`); if (o['twitch.uptime'] && t.uptime) b.push(`⏱ ${t.uptime}`); if (o['twitch.game'] && t.game) b.push(t.game); P.twitch = b.join(' · '); }
      else if (o['twitch.offline']) P.twitch = o['twitch.offline'];
    }
    if (o['tiktok.enabled'] && o['tiktok.handle']) P.tiktok = String(o['tiktok.format'] || '📱 @{handle}').replace(/\{handle\}/g, String(o['tiktok.handle']).replace(/^@/, ''));
    // quotes / facts / marquee
    if (o['quotes.enabled']) {
      const pool = o['quotes.pack'] === 'all' ? Object.values(T.QUOTES).flat() : T.QUOTES[o['quotes.pack']] || T.QUOTES.chill;
      if (this.quoteIdx < 0 || Date.now() - this.quoteAt > (Number(o['quotes.rotateSec']) || 60) * 1000 || this.quotePack !== o['quotes.pack']) { this.quoteIdx = Math.floor(Math.random() * pool.length); this.quoteAt = Date.now(); this.quotePack = o['quotes.pack']; }
      P.quote = `${I('quote')}“${pool[this.quoteIdx % pool.length]}”`;
    }
    if (o['facts.enabled']) {
      if (this.factIdx < 0 || Date.now() - this.factAt > (Number(o['facts.rotateSec']) || 90) * 1000) { this.factIdx = Math.floor(Math.random() * T.FACTS.length); this.factAt = Date.now(); }
      P.fact = `${I('fact')}${T.FACTS[this.factIdx]}`;
    }
    if (o['marquee.enabled'] && o['marquee.text']) {
      const src = Array.from(String(o['marquee.text']) + '   '); const w = Math.min(Number(o['marquee.width']) || 24, src.length);
      const off = (this.frame * (Number(o['marquee.step']) || 3)) % src.length; P.marquee = [...src, ...src].slice(off, off + w).join('');
    }
    return P;
  }

  compose(now = new Date()) {
    const c = this.cfg(); const o = this.o();
    const P = this.modules(now, o);
    this.parts = { ...P };
    // a typed message replaces the status line while it is showing (like MagicChatbox)
    if (P.message) delete P.status;
    // per-module prefix/suffix, font, case
    const pre = o['style.prefix'] || {}, suf = o['style.suffix'] || {};
    const scope = o['style.fontScope'];
    const sty = (k, raw) => {
      let s = `${pre[k] || ''}${raw}${suf[k] || ''}`;
      const styled = scope === 'all' || (scope === 'status' && (k === 'status' || k === 'message')) || (scope === 'labels' && k !== 'nowPlaying');
      if (styled) s = T.applyFont(T.applyCase(s, o['style.case']), o['style.font']);
      return s;
    };
    for (const k of Object.keys(P)) P[k] = sty(k, P[k]);
    let order = (c.order || []).filter((k) => P[k]);
    for (const k of MODULE_IDS) if (P[k] && !order.includes(k)) order.push(k);
    // pages
    if (o['pages.enabled']) {
      const map = o['pages.map'] || {}; const pages = [...new Set(order.map((k) => Number(map[k] || 0)).filter((p) => p > 0))].sort();
      if (pages.length) {
        if (Date.now() - this.pageAt > (Number(o['pages.seconds']) || 8) * 1000) { this.page++; this.pageAt = Date.now(); }
        const cur = pages[this.page % pages.length]; order = order.filter((k) => { const p = Number(map[k] || 0); return p === 0 || p === cur; });
      }
    }
    const sepRaw = c.separator === 'newline' ? '\n' : c.separator === 'custom' ? (o['style.customSep'] || ' ') : c.separator;
    const join = (keys) => {
      const parts = keys.map((k) => P[k]);
      if (o['style.layout'] === 'single') return parts.join(sepRaw === '\n' ? ' · ' : sepRaw);
      if (o['style.layout'] === 'pairs') { const lines = []; for (let i = 0; i < parts.length; i += 2) lines.push(parts.slice(i, i + 2).join(sepRaw === '\n' ? ' · ' : sepRaw)); return lines.join('\n'); }
      return parts.join(sepRaw);
    };
    const decorate = (t) => {
      if (!t) return t;
      const b = o['style.border'];
      if (b === 'arrows' || b === 'bullets') t = t.split('\n').map((l) => (b === 'arrows' ? '➤ ' : '• ') + l).join('\n');
      if (o['style.wrap']) t = `${o['style.wrap']} ${t} ${o['style.wrap']}`;
      if (o['style.randomEmoji']) t += ' ' + T.SPARKLES[this.frame % T.SPARKLES.length];
      if (T.BORDERS[b]) t = `${T.BORDERS[b][0]}\n${t}\n${T.BORDERS[b][1]}`;
      if (o['filter.enabled']) t = T.profanity(t, o['filter.mode'] === 'remove' ? 'remove' : 'mask', o['filter.words']).text;
      return t;
    };
    let text = decorate(join(order));
    if (ulen(text) > MAX && P.weather && this.weatherVariants && order.includes('weather')) {
      for (const v of this.weatherVariants.slice(1)) { P.weather = sty('weather', v); text = decorate(join(order)); if (ulen(text) <= MAX) break; }
    }
    if (ulen(text) > MAX) {
      if (o['overflow'] === 'drop') { let keys = [...order]; while (keys.length > 1 && ulen(text) > MAX) { keys.pop(); text = decorate(join(keys)); } }
      else if (o['overflow'] === 'split') {
        const chunks = []; let cur = [];
        for (const k of order) { if (cur.length && ulen(decorate(join([...cur, k]))) > MAX) { chunks.push(cur); cur = []; } cur.push(k); }
        if (cur.length) chunks.push(cur);
        if (Date.now() - (this.splitAt || 0) > (Number(o['pages.seconds']) || 8) * 1000) { this.split++; this.splitAt = Date.now(); }
        text = decorate(join(chunks[this.split % chunks.length]));
      }
    }
    return truncate(text);
  }

  tick() {
    const c = this.cfg(); const o = this.o();
    let text = '';
    try { text = this.compose(); } catch (e) { this.log('compose: ' + e.message); }
    const now = Date.now();
    const gap = Math.max(MIN_GAP_MS, (Number(c.sendIntervalSec) || 2) * 1000);
    const vrcClosed = o['clear.vrcClosed'] && this.sys.vrchat === false;
    const out = o['clear.afk'] && this.isAfk ? '' : text;
    let sent = false;
    if (c.live && !vrcClosed && !this.pending && now - this.lastSentAt >= gap) {
      const keep = Number(o['keepAlive']); const stale = keep > 0 && now - this.lastSentAt > keep * 1000;
      if (out !== this.lastSentText || stale) {
        const isNewMsg = !!(this.message && this.message.fresh);
        const notify = !!c.notify && (!o['notify.messagesOnly'] || isNewMsg);
        if (this.message) this.message.fresh = false;
        const doSend = () => { this.osc_('/chatbox/input', [out, true, notify]); this.pending = null; };
        if (o['typing.mode'] === 'pulse' && c.typingIndicator && out !== this.lastSentText && out) { this.osc_('/chatbox/typing', [true]); this.pending = setTimeout(doSend, 700); }
        else doSend();
        this.lastSentText = out; this.lastSentAt = now; this.sendCount++; this.frame++; sent = true;
      }
    }
    this.onState({
      preview: out, length: ulen(out), max: MAX, live: c.live, lastSentAt: this.lastSentAt, sendCount: this.sendCount,
      message: this.message, media: this.media, focus: this.focus, error: this.lastError, sent, paused: vrcClosed ? "VRChat isn't running" : null,
      nextInMs: Math.max(0, gap - (now - this.lastSentAt)), parts: this.parts || {},
      weather: { data: this.weather.data, error: this.weather.error, busy: this.weather.busy, at: this.weather.at },
      twitch: { data: this.twitch.data, error: this.twitch.error }, sys: { ...this.sys, cpu: this.cpu },
      vrc: { world: this.vrc.world, players: this.vrc.players.size, error: this.vrc.error }, osc: { port: this.osc.port, error: this.osc.error, lastAt: this.osc.lastAt, muted: this.osc.params.MuteSelf, afk: this.osc.params.AFK, hr: this.osc.heartRate(String(o['hr.param'] || '').trim()) },
      stopwatch: { ...(c.stopwatch || {}), sec: this.stopwatchSec() }, afk: !!this.isAfk,
    });
  }

  setLive(on) {
    if (!on && this.cfg().live) this.osc_('/chatbox/input', ['', true, false]);
    this.liveSince = on ? Date.now() : null;
    this.lastSentText = null;
  }
  clearNow() { this.osc_('/chatbox/input', ['', true, false]); }
}

module.exports = { Chatbox, MAX, MIN_GAP_MS, truncate, DEFAULTS, MODULE_IDS, parseSchedule };
