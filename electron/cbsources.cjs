// Live data sources for the chatbox: weather, Twitch, VRChat log, VRChat OSC input, PC stats.
const fs = require('fs');
const path = require('path');
const os = require('os');
const dgram = require('dgram');

async function getJson(url, ms = 8000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'BlurSoundsPro/2.1' } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}
async function getText(url, ms = 8000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'BlurSoundsPro/2.1' } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.text()).trim(); }
  finally { clearTimeout(t); }
}

// ---------------- weather (open-meteo, no key) ----------------
const WMO = {
  0: ['☀️', 'Clear', '🌙'], 1: ['🌤️', 'Mostly clear', '🌙'], 2: ['⛅', 'Partly cloudy', '☁️'], 3: ['☁️', 'Overcast'], 45: ['🌫️', 'Fog'], 48: ['🌫️', 'Icy fog'],
  51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Heavy drizzle'], 56: ['🌧️', 'Freezing drizzle'], 57: ['🌧️', 'Freezing drizzle'],
  61: ['🌦️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'], 66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'],
  71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow grains'], 80: ['🌦️', 'Showers'], 81: ['🌧️', 'Showers'], 82: ['⛈️', 'Heavy showers'],
  85: ['🌨️', 'Snow showers'], 86: ['❄️', 'Snow showers'], 95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm, hail'], 99: ['⛈️', 'Thunderstorm, hail'],
};
class Weather {
  constructor(onChange) { this.onChange = onChange; this.data = null; this.loc = null; this.error = null; this.at = 0; this.key = ''; this.busy = false; }
  async locate(o) {
    const city = String(o['weather.city'] || '').trim();
    if (city) {
      const [name, region] = city.split(',').map((x) => x.trim());
      const r = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json`);
      let hit = (r.results || [])[0];
      if (region && r.results) hit = r.results.find((x) => [x.admin1, x.country, x.country_code].some((v) => v && v.toLowerCase().startsWith(region.toLowerCase()))) || hit;
      if (!hit) throw new Error(`city "${city}" not found`);
      return { lat: hit.latitude, lon: hit.longitude, city: hit.name, region: hit.admin1 || hit.country, via: 'city' };
    }
    if (!o['weather.auto']) throw new Error('location: turn on IP detection or type a city');
    try {
      const r = await getJson('https://ipwho.is/');
      if (r.success === false) throw new Error(r.message || 'ipwho.is failed');
      return { lat: r.latitude, lon: r.longitude, city: r.city, region: r.region, via: 'ipwho.is' };
    } catch (e) {
      const r = await getJson('http://ip-api.com/json/');
      if (r.status !== 'success') throw new Error('IP location failed');
      return { lat: r.lat, lon: r.lon, city: r.city, region: r.regionName, via: 'ip-api.com' };
    }
  }
  async refresh(o, force = false) {
    if (this.busy) return;
    const key = [o['weather.city'], o['weather.auto'], o['weather.units'], o['weather.wind']].join('|');
    const every = Math.max(5, Number(o['weather.refreshMin']) || 10) * 60000;
    if (!force && key === this.key && Date.now() - this.at < every && (this.data || Date.now() - this.at < 60000)) return;
    this.busy = true;
    try {
      if (key.split('|').slice(0, 2).join('|') !== this.key.split('|').slice(0, 2).join('|') || !this.loc) this.loc = await this.locate(o);
      const u = o['weather.units'] === 'C' ? 'celsius' : 'fahrenheit';
      const w = { mph: 'mph', kmh: 'kmh', ms: 'ms', kn: 'kn' }[o['weather.wind']] || 'mph';
      const r = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${this.loc.lat}&longitude=${this.loc.lon}` +
        '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day' +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset' +
        `&timezone=auto&forecast_days=2&temperature_unit=${u}&wind_speed_unit=${w}`);
      const c = r.current; const d = r.daily;
      const code = WMO[c.weather_code] || ['🌡️', 'Weather'];
      this.data = {
        temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), hum: Math.round(c.relative_humidity_2m), wind: Math.round(c.wind_speed_10m),
        code: c.weather_code, icon: !c.is_day && code[2] ? code[2] : code[0], cond: code[1], isDay: !!c.is_day,
        hi: Math.round(d.temperature_2m_max[0]), lo: Math.round(d.temperature_2m_min[0]), rain: d.precipitation_probability_max?.[0] ?? null,
        hi2: Math.round(d.temperature_2m_max[1]), lo2: Math.round(d.temperature_2m_min[1]),
        sunrise: d.sunrise, sunset: d.sunset, utcOffset: r.utc_offset_seconds,
        unit: o['weather.units'] === 'C' ? '°C' : '°F', windUnit: { mph: 'mph', kmh: 'km/h', ms: 'm/s', kn: 'kn' }[w],
        city: this.loc.city, region: this.loc.region, via: this.loc.via, at: Date.now(),
      };
      this.error = null; this.key = key;
    } catch (e) { this.error = e.name === 'AbortError' ? 'weather request timed out' : e.message; this.key = key; }
    finally { this.at = Date.now(); this.busy = false; this.onChange(); }
  }
}

// ---------------- Twitch (decapi.me public endpoints, no auth) ----------------
class Twitch {
  constructor() { this.data = null; this.error = null; this.at = 0; this.chan = ''; this.busy = false; }
  async refresh(o) {
    const ch = String(o['twitch.channel'] || '').trim().replace(/^@/, '').toLowerCase();
    if (!ch || this.busy || (ch === this.chan && Date.now() - this.at < 60000)) return;
    this.busy = true;
    try {
      const base = `https://decapi.me/twitch`;
      const [up, viewers, game] = await Promise.all([getText(`${base}/uptime/${ch}`), getText(`${base}/viewercount/${ch}`).catch(() => ''), getText(`${base}/game/${ch}`).catch(() => '')]);
      const live = !/offline|not found|error/i.test(up);
      this.data = { channel: ch, live, uptime: live ? shortUptime(up) : '', viewers: live && /^\d+$/.test(viewers) ? Number(viewers) : null, game: game && !/error|not found/i.test(game) ? game : '' };
      this.error = /not found|error/i.test(up) && !/offline/i.test(up) ? up : null;
    } catch (e) { this.error = e.message; }
    finally { this.chan = ch; this.at = Date.now(); this.busy = false; }
  }
}
function shortUptime(s) {
  const h = /(\d+) hours?/.exec(s); const m = /(\d+) minutes?/.exec(s); const d = /(\d+) days?/.exec(s);
  const H = (d ? +d[1] * 24 : 0) + (h ? +h[1] : 0);
  return H ? `${H}h ${m ? m[1] : 0}m` : `${m ? m[1] : 0}m`;
}

// ---------------- VRChat output log ----------------
class VrcLog {
  constructor() { this.dir = path.join(os.homedir(), 'AppData', 'LocalLow', 'VRChat', 'VRChat'); this.file = null; this.pos = 0; this.world = null; this.players = new Map(); this.lastJoin = null; this.error = null; this.rest = ''; }
  instanceInfo(id) {
    let type = 'Public';
    if (/~private\(/.test(id)) type = /~canRequestInvite/.test(id) ? 'Invite+' : 'Invite';
    else if (/~friends\(/.test(id)) type = 'Friends';
    else if (/~hidden\(/.test(id)) type = 'Friends+';
    else if (/~group\(/.test(id)) { const a = /groupAccessType\((\w+)\)/.exec(id); type = a && a[1] === 'public' ? 'Group Public' : a && a[1] === 'plus' ? 'Group+' : 'Group'; }
    const reg = /~region\((\w+)\)/.exec(id); const R = { us: 'US West', use: 'US East', eu: 'Europe', jp: 'Japan' };
    return { type, region: reg ? R[reg[1]] || reg[1].toUpperCase() : 'US West', private: /Invite/.test(type) };
  }
  line(l) {
    let m;
    if ((m = /\[Behaviour\] Entering Room: (.+)$/.exec(l))) { this.world = { ...(this.world || {}), name: m[1].trim(), since: Date.now() }; this.players.clear(); }
    else if ((m = /\[Behaviour\] Joining (wrld_[^\s]+)/.exec(l))) { this.world = { ...(this.world || {}), id: m[1], ...this.instanceInfo(m[1]), since: this.world?.since || Date.now() }; this.players.clear(); }
    else if ((m = /\[Behaviour\] OnPlayerJoined (.+?)(?: \((usr_[^)]+)\))?\s*$/.exec(l))) { this.players.set(m[2] || m[1], m[1]); this.lastJoin = { name: m[1], at: Date.now(), initial: this._reading }; }
    else if ((m = /\[Behaviour\] OnPlayerLeft (.+?)(?: \((usr_[^)]+)\))?\s*$/.exec(l))) this.players.delete(m[2] || m[1]);
    else if (/\[Behaviour\] OnLeftRoom/.test(l)) { this.players.clear(); }
    if ((m = /^(\d{4})\.(\d\d)\.(\d\d) (\d\d):(\d\d):(\d\d)/.exec(l)) && this.world && /Entering Room|Joining wrld/.test(l)) this.world.since = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }
  poll() {
    try {
      const files = fs.readdirSync(this.dir).filter((f) => /^output_log_.*\.txt$/.test(f)).map((f) => ({ f: path.join(this.dir, f), t: fs.statSync(path.join(this.dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
      if (!files.length) { this.error = 'no VRChat log yet'; return; }
      if (files[0].f !== this.file) { this.file = files[0].f; this.pos = 0; this.world = null; this.players.clear(); this.rest = ''; }
      const size = fs.statSync(this.file).size; if (size < this.pos) this.pos = 0;
      if (size === this.pos) return;
      this._reading = this.pos === 0;
      const fd = fs.openSync(this.file, 'r');
      try {
        let start = this.pos; const len = Math.min(size - start, 32 * 1024 * 1024);
        const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, start); this.pos = start + len;
        const text = this.rest + buf.toString('utf8'); const lines = text.split(/\r?\n/); this.rest = lines.pop();
        for (const l of lines) if (l.includes('[Behaviour]')) this.line(l);
      } finally { fs.closeSync(fd); this._reading = false; }
      this.error = null;
    } catch (e) { this.error = e.code === 'ENOENT' ? 'VRChat log folder not found' : e.message; }
  }
}

// ---------------- VRChat OSC input (avatar parameters) ----------------
function oscStr(buf, i) { let e = i; while (e < buf.length && buf[e] !== 0) e++; return [buf.toString('utf8', i, e), (e + 4) & ~3]; }
function oscDecode(buf, out = []) {
  if (buf.length >= 8 && buf.toString('ascii', 0, 7) === '#bundle') {
    let i = 16; while (i + 4 <= buf.length) { const n = buf.readInt32BE(i); oscDecode(buf.subarray(i + 4, i + 4 + n), out); i += 4 + n; }
    return out;
  }
  let [addr, i] = oscStr(buf, 0); if (!addr.startsWith('/')) return out;
  let tags; [tags, i] = oscStr(buf, i); const args = [];
  for (const t of tags.slice(1)) {
    if (t === 'i') { args.push(buf.readInt32BE(i)); i += 4; } else if (t === 'f') { args.push(buf.readFloatBE(i)); i += 4; }
    else if (t === 'T') args.push(true); else if (t === 'F') args.push(false); else if (t === 's') { let s; [s, i] = oscStr(buf, i); args.push(s); }
  }
  out.push({ addr, args }); return out;
}
class OscIn {
  constructor() { this.sock = null; this.port = 0; this.params = {}; this.error = null; this.lastAt = 0; }
  ensure(port) {
    if (!port) { this.close(); return; }
    if (this.sock && this.port === port) return;
    this.close(); this.port = port;
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.on('message', (m) => { try { for (const { addr, args } of oscDecode(m)) if (addr.startsWith('/avatar/parameters/')) { this.params[addr.slice(19)] = args[0]; this.lastAt = Date.now(); } } catch {} });
    s.on('error', (e) => { this.error = e.code === 'EADDRINUSE' ? `port ${port} is used by another OSC app` : e.message; try { s.close(); } catch {} this.sock = null; });
    s.bind(port, '127.0.0.1', () => { this.error = null; });
    this.sock = s;
  }
  close() { if (this.sock) { try { this.sock.close(); } catch {} } this.sock = null; this.port = 0; }
  heartRate(name) {
    const p = this.params;
    if (name) { const v = p[name]; if (typeof v !== 'number') return null; return v <= 1 && v >= -1 && !Number.isInteger(v) ? Math.round((v + 1) * 127.5) : Math.round(v); }
    for (const k of ['HR', 'Heartrate3', 'HeartRateInt', 'HeartRate', 'Heartrate', 'BPM', 'HeartBeatInt', 'VRCOSC/Heartrate/Value']) {
      const v = p[k]; if (typeof v === 'number' && Number.isInteger(v) && v > 25 && v < 250) return v;
    }
    return null;
  }
}

// ---------------- CPU / RAM (Node) ----------------
let lastCpu = null;
function cpuPercent() {
  const t = os.cpus().reduce((a, c) => { const tot = Object.values(c.times).reduce((x, y) => x + y, 0); return { idle: a.idle + c.times.idle, total: a.total + tot }; }, { idle: 0, total: 0 });
  let pct = 0; if (lastCpu) { const di = t.idle - lastCpu.idle, dt = t.total - lastCpu.total; pct = dt > 0 ? Math.round(100 * (1 - di / dt)) : 0; }
  lastCpu = t; return pct;
}

module.exports = { Weather, Twitch, VrcLog, OscIn, cpuPercent, oscDecode, WMO, shortUptime };
