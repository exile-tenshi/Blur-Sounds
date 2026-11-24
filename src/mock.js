import SHARE from '../electron/sharepresets.json';
import { mockSetup, mockStream, mockRate, mockUpdate } from './mocksetup.js';
// Browser-only preview data (used when not running inside Electron, e.g. for screenshots).
export function installMock() {
  const listeners = {};
  const emit = (ch, d) => (listeners[ch] || []).forEach((f) => f(d));
  const on = (ch) => (cb) => { (listeners[ch] = listeners[ch] || []).push(cb); return () => { listeners[ch] = listeners[ch].filter((f) => f !== cb); }; };
  const qp = new URLSearchParams(location.search); const page = qp.get('page') || 'mixer';
  if (qp.get('drawer')) window.__bspInitialDrawer = qp.get('drawer') === 'mic' ? { type: 'mic' } : { type: 'channel', id: qp.get('drawer') };
  if (qp.get('open')) window.__bspOpenFirst = true;
  const BANDS = [{ type: 'lowcut', f: 80, g: 0, q: 0.7, on: false }, { type: 'lowshelf', f: 90, g: 0, q: 0.7 }, { type: 'peak', f: 250, g: 0, q: 1 }, { type: 'peak', f: 1000, g: 0, q: 1 }, { type: 'peak', f: 3200, g: 0, q: 1 }, { type: 'highshelf', f: 9000, g: 0, q: 0.7 }, { type: 'highcut', f: 18000, g: 0, q: 0.7, on: false }];
  const PG = { footsteps: [0, -4, -2, 1, 5, 3, 0], broadcast: [1, -2, -3, 1, 3, 2, 0], flat: [0, 0, 0, 0, 0, 0, 0] };
  const eqp = (k) => ({ enabled: k !== 'flat', preset: k, preampDb: 0, bands: BANDS.map((b, i) => ({ ...b, g: PG[k][i], ...(i === 0 && k === 'broadcast' ? { on: true, f: 90 } : {}) })) });
  const ch = (volume, x = {}) => ({ volume, muted: false, output: null, mode: 'direct', cableId: null, streamVolume: 0.8, streamMuted: false, inClip: true, inRec: true, eq: eqp('flat'), ...x });
  const settings = {
    ui: { page: page === 'stream' ? 'mixer' : page }, app: { startWithWindows: false, closeToTray: true },
    mixer: { channels: { game: ch(0.82, { mode: 'cable', cableId: 'o3', eq: eqp('footsteps') }), chat: ch(0.9, { streamVolume: 0.6 }), media: ch(0.46, { streamVolume: 0.35 }), aux: ch(0.7, { streamMuted: true }) },
      channelList: [{ id: 'game', label: 'Game', icon: 'game', builtin: true }, { id: 'chat', label: 'Chat', icon: 'chat', builtin: true }, { id: 'media', label: 'Media', icon: 'media', builtin: true }, { id: 'aux', label: 'Aux', icon: 'aux', builtin: true }],
      chatMix: -0.18, streamMode: page === 'stream', personalOut: null, streamOut: 'o2', master: { deviceId: null }, mic: { deviceId: null, meter: true }, hidden: ['audiodg'], assignments: {} },
    micChain: { enabled: true, outId: null, gainDb: 0, clearcast: true, inStream: true, gate: { enabled: true, thresholdDb: -48, holdMs: 120, releaseMs: 180 }, ns: { enabled: true, amount: 0.9 }, comp: { enabled: true, thresholdDb: -20, ratio: 3, makeupDb: 4, attackMs: 8, releaseMs: 120 }, eq: eqp('broadcast') },
    clips: { enabled: true, seconds: 30, hotkey: 'F8', includeMic: true, folder: null, voice: { enabled: true, phrase: 'clip it' }, video: { enabled: true, display: 0, fps: 60, bitrateMbps: 16 }, sound: true },
    record: { video: true, includeMic: true, folder: null },
    chatbox: { live: true, ip: '127.0.0.1', port: 9000, sendIntervalSec: 2, separator: 'newline', typingIndicator: true, notify: false,
      modules: { status: { enabled: true, rotateSec: 5, random: false, items: [{ text: 'Blur Sounds Pro ✦', enabled: true }, { text: 'vibing', enabled: true }, { text: 'AFK', enabled: false }, { text: 'brb', enabled: false }] },
        time: { enabled: true, h24: false, prefix: '🕒 ', showSeconds: false }, nowPlaying: { enabled: true, template: '🎵 {title} - {artist}', showPaused: false, progress: true }, focus: { enabled: false, template: 'ⁱⁿ {app}' }, message: { durationSec: 12 } },
      order: ['status', 'message', 'nowPlaying', 'focus', 'time', 'weather'], opt: { 'pc.enabled': true, 'pc.gpuTemp': true }, profiles: { Streaming: {}, Chill: {} }, activeProfile: 'Streaming', history: [{ text: 'brb grabbing water', at: 0 }, { text: 'gg that was clean', at: 0 }] },
    soundboard: { outputLabel: 'CABLE Input (VB-Audio Virtual Cable)', monitor: true, volume: 0.8, stopHotkey: 'Ctrl+Alt+0', sounds: [
      { id: 'a', name: 'Air horn', hotkey: 'Ctrl+Alt+1', volume: 1 }, { id: 'b', name: 'Bruh', hotkey: 'Ctrl+Alt+2', volume: 0.8 }, { id: 'c', name: 'Vine boom', hotkey: 'Ctrl+Alt+3', volume: 1 },
      { id: 'd', name: 'Sad trombone', hotkey: 'Ctrl+Alt+4', volume: 0.7 }, { id: 'e', name: 'Applause', hotkey: '', volume: 1 }, { id: 'f', name: 'Rizz', hotkey: 'Ctrl+Alt+6', volume: 0.9 }] },
  };
  const outputs = ['Headphones (USB Headset)', 'Speakers (Realtek(R) Audio)', 'Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)', 'CABLE Input (VB-Audio Virtual Cable)', 'Realtek Digital Output (Realtek(R) Audio)'].map((n, i) => ({ id: 'o' + i, name: n, default: i === 1, volume: 0.74, muted: false }));
  const inputs = ['Microphone (USB Mic)', 'Headset (USB Headset)', 'Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)', 'Microphone (VR Headset)'].map((n, i) => ({ id: 'i' + i, name: n, default: i === 0, comms: i === 0, volume: 0.88, muted: false }));
  const ic = (c, t) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><rect width="18" height="18" rx="4" fill="${c}"/><text x="9" y="13" font-size="10" font-family="Segoe UI,Arial" font-weight="700" text-anchor="middle" fill="#fff">${t}</text></svg>`);
  const sessions = [
    { process: 'VRChat', name: 'VRChat', channel: 'game', appVolume: 1, appMuted: false, active: true, pids: [1], icon: ic('#1c6bd1', 'V') },
    { process: 'vrserver', name: 'SteamVR', channel: 'game', appVolume: 0.8, appMuted: false, active: false, pids: [2], icon: ic('#2b3440', 'S') },
    { process: 'Discord', name: 'Discord', channel: 'chat', appVolume: 0.92, appMuted: false, active: true, pids: [3, 4], icon: ic('#5865f2', 'D') },
    { process: 'spotify', name: 'Spotify', channel: 'media', appVolume: 0.7, appMuted: false, active: true, pids: [5], icon: ic('#1db954', 'N') },
    { process: 'chrome', name: 'Google Chrome', channel: 'media', appVolume: 0.55, appMuted: false, active: false, pids: [6], icon: ic('#fa1e4e', 'O') },
    { process: 'System', name: 'System sounds', channel: 'aux', appVolume: 0.6, appMuted: false, active: false, pids: [0], icon: null, system: true },
    { process: 'tracker_setup_lite', name: 'Tracker setup', channel: 'aux', appVolume: 1, appMuted: false, active: true, pids: [7], icon: ic('#6b7280', 'T') },
    { process: 'steamwebhelper', name: 'Steam Client WebHelper', channel: 'game', appVolume: 1, appMuted: true, active: false, pids: [8], icon: ic('#16202d', 'S') },
  ];
  const cables = [
    { id: 'o2', name: 'Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)', recordName: 'Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)', sonar: false, ownedBySonar: false, usedBy: ['Stream mix'] },
    { id: 'o3', name: 'CABLE Input (VB-Audio Virtual Cable)', recordName: 'CABLE Output (VB-Audio Virtual Cable)', sonar: false, ownedBySonar: false, usedBy: ['Game'] },
    { id: 'o5', name: 'SteelSeries Sonar - Gaming (SteelSeries Sonar Virtual Audio Device)', recordName: null, sonar: true, ownedBySonar: true, usedBy: [] },
    { id: 'o6', name: 'SteelSeries Sonar - Chat (SteelSeries Sonar Virtual Audio Device)', recordName: null, sonar: true, ownedBySonar: true, usedBy: [] }];
  const state = () => ({ helper: { status: 'running' }, ready: true, stream: mockStream(), cableRate: mockRate(), cables, sonarRunning: true, micChain: settings.micChain, micPath: new URLSearchParams(location.search).get('mic') === 'shared' ? { input: { id: 'i0', name: 'Microphone (USB Mic)' }, processing: true, out: { id: 'o2', name: 'Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)', recordName: 'Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)', via: 'mic' }, cable: { id: 'o2', name: 'Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)' }, warn: null, errors: [], streamMode: true, onStream: false, shared: true, stream: { id: 'o2', name: 'Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)', recordName: 'Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)' }, streamTargets: [{ id: 'o3', name: 'CABLE Input (VB-Audio Virtual Cable)' }, { id: 'o4', name: 'Realtek Digital Output (Realtek(R) Audio)' }] } : new URLSearchParams(location.search).get('mic') === 'nocable' ? { input: { id: 'i0', name: 'Microphone (USB Mic)', fallback: true }, processing: true, out: null, cable: null, warn: 'no-cable', errors: [] } : { input: { id: 'i0', name: 'Microphone (USB Mic)', fallback: false }, processing: true, out: { id: 'o2', name: 'Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)', recordName: 'Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)', via: 'mic' }, cable: { id: 'o2', name: 'Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)' }, warn: null, errors: [] }, outputs, inputs, defaultOutput: 'o1', defaultInput: 'i0', defaultCommsInput: 'i0', routingSupported: true, sessions, settings: settings.mixer });
  const media = { app: 'Spotify.exe', title: 'Song Title', artist: 'Artist', status: 'playing', position: 124, duration: 386, focus: { name: 'VRChat' } };
  const engine = { engine: { running: true, rnnoise: 'ok', voice: { enabled: true, ready: true, heard: 'okay clip it', phrase: 'clip it' }, clip: { enabled: true, buffered: 30, capacity: 34 }, record: { active: page === 'record' } },
    media: { ffmpeg: true, videoRing: true, ringSeconds: 34, recording: page === 'record' ? { startedAt: Date.now() - 754000, video: true } : null, clipsDir: 'C:\\Users\\you\\Videos\\Blur Sounds Pro\\Clips', recDir: 'C:\\Users\\you\\Videos\\Blur Sounds Pro\\Recordings' } };
  const th = (h1, h2, label) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${h1}"/><stop offset="1" stop-color="${h2}"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><circle cx="250" cy="40" r="60" fill="#ffffff10"/><rect x="0" y="120" width="320" height="60" fill="#00000040"/><text x="16" y="160" font-family="Segoe UI,Arial" font-size="18" font-weight="700" fill="#ffffffcc">${label}</text></svg>`);
  const now = Date.now();
  const clips = [
    { name: 'Clip 2026-11-22 22-41-07 (voice)', file: 'c1', ext: 'mp4', size: 61.2e6, mtime: now - 4 * 60e3, thumb: th('#2a1b3d', '#b8324f', 'Night Drive') },
    { name: 'Clip 2026-11-22 22-18-55 (hotkey)', file: 'c2', ext: 'mp4', size: 58.9e6, mtime: now - 27 * 60e3, thumb: th('#0f2a3a', '#2f7fa8', 'Movie Night') },
    { name: 'best moment', file: 'c3', ext: 'mp4', size: 63.4e6, mtime: now - 3 * 3600e3, thumb: th('#1d2a1b', '#6aa84f', 'Great Pug') },
    { name: 'Clip 2026-11-21 23-02-12 (voice)', file: 'c4', ext: 'mp4', size: 60.1e6, mtime: now - 24 * 3600e3, thumb: th('#3a2a10', '#d08a2c', 'Midnight Rooftop') },
    { name: 'Clip 2026-11-21 21-44-40 (audio only)', file: 'c5', ext: 'm4a', size: 0.9e6, mtime: now - 25 * 3600e3, thumb: null }];
  const recs = [{ name: 'Recording 2026-11-21 20-10-03', file: 'r1', ext: 'mp4', size: 1.42e9, mtime: now - 26 * 3600e3, thumb: th('#141820', '#4a5568', 'Recording') }];
  let t = 0;
  setInterval(() => {
    t += 1; const w = (p) => Math.max(0, 0.35 + 0.3 * Math.sin(t / 3 + p) + Math.random() * 0.25);
    emit('mixer:levels', { sessions: { 1: w(0), 3: w(1) * 0.8, 4: 0, 5: w(2), 7: w(3) * 0.3 }, mic: w(4) * 0.7, master: w(5), engine: { clipDesk: w(1) * 0.6, clipMic: w(4) * 0.5, clipUsing: 'apps', channels: { game: w(0) }, micPre: w(4) * 0.8, micPost: w(4) * 0.7, micOutPk: w(4) * 0.7, streamPk: w(1) * 0.5, gr: 3.5, gate: 1, vad: 0.93 } });
  }, 90);
  const compose = () => {
    const m = settings.chatbox.modules; const parts = [];
    if (m.status.enabled) parts.push(m.status.items.filter((i) => i.enabled)[0]?.text);
    if (m.nowPlaying.enabled) parts.push(`🎵 ${media.title} ᵇʸ ${media.artist}${m.nowPlaying.progress ? ' 2:04/6:26' : ''}`);
    if (m.time.enabled) parts.push(m.time.prefix + new Date(2026, 10, 22, 22, 41).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
    parts.push('🌧️ 46°F Light rain · H 51° L 39°'); parts.push('🖥️ GPU 55% 47°C');
    return parts.filter(Boolean).join('\n');
  };
  setInterval(() => { const p = compose(); emit('chatbox:state', { preview: p, live: settings.chatbox.live, lastSentAt: Date.now() - 1200, sendCount: 214, media, focus: media.focus, parts: { weather: '🌧️ 46°F Light rain · H 51° L 39°', pc: '🖥️ GPU 55% 47°C', time: '🕒 10:41 PM', nowPlaying: '🎵 Song Title ᵇʸ Artist' }, weather: { data: { temp: 46, feels: 41, hum: 88, wind: 9, icon: '🌧️', cond: 'Light rain', hi: 51, lo: 39, rain: 80, unit: '°F', windUnit: 'mph', city: 'Springfield', region: 'Somewhere', via: 'ipwho.is', at: Date.now() - 120000 } }, sys: { cpu: 18, gpu: 55, gpuTemp: 47, vramUsed: 6.3, vramTotal: 16, gpuName: 'AMD Radeon GPU', ping: 14, idleSec: 3 }, osc: { port: 9001, lastAt: Date.now(), muted: false, hr: 82 }, vrc: { world: { name: 'Night Drive' }, players: 23 }, twitch: { data: { channel: 'yourchannel', live: false } }, stopwatch: { running: false, sec: 0 } }); }, 250);
  const setupMock = mockSetup(); const updMock = mockUpdate();
  settings.app.setup = { done: !qp.get('setup') };
  window.bsp = {
    invoke: async (ch, ...a) => {
      if (String(ch).startsWith('setup:')) return setupMock(ch, a[0]);
      if (String(ch).startsWith('update:')) return updMock(ch);
      if (ch === 'settings:get') return settings;
      if (ch === 'settings:set') { let o = settings; const k = a[0]; for (let i = 0; i < k.length - 1; i++) o = o[k[i]]; o[k[k.length - 1]] = a[1]; return settings; }
      if (ch === 'app:info') return { version: '1.0.0', userData: 'C:\\Users\\you\\AppData\\Roaming\\Blur Sounds Pro', tools: [
        { id: 'mcb', name: 'MagicChatbox (standalone)', path: 'C:\\Program Files\\Blur Sounds\\MagicChatbox\\MagicChatbox.exe', exists: true },
        { id: 'rnnoise', name: 'RNNoise noise suppression', path: 'C:\\Program Files\\Blur Sounds\\RNNoise\\RNNoise.exe', exists: true },
        { id: 'anytoenglish', name: 'AnyToEnglish translator', path: 'C:\\Program Files\\Blur Sounds\\AnyToEnglish\\app\\AnyToEnglish.exe', exists: true }] };
      if (ch === 'engine:get') return engine;
      if (ch === 'share:presets') return { ...SHARE, last: null };
      if (ch === 'share:plan') { const p = SHARE.presets.find((x) => x.id === a[1].preset); const v = p.vertical; return { ok: true, src: { audio: [{ title: 'Desktop + mic' }, { title: 'Desktop audio' }, { title: 'Microphone' }] }, W: v ? 1080 : 1706, H: v ? 1920 : 720, fps: v ? 60 : 30, vKbps: v ? 12000 : 2378, aKbps: 128, dur: 30, estBytes: p.sizeBytes ? p.sizeBytes * 0.95 : 46e6, sizeBytes: p.sizeBytes || 0, hasAudio: true, warnings: [] }; }
      if (ch === 'clip:library') return a[0] === 'rec' ? { dir: 'C:\\Users\\you\\Videos\\Blur Sounds Pro\\Recordings', items: recs } : { dir: 'C:\\Users\\you\\Videos\\Blur Sounds Pro\\Clips', items: clips };
      if (ch === 'listen:get') return { current: 'o-vr', options: [{ id: 'o-vr', name: 'Speakers (VR Headset)' }, { id: 'o-hp', name: 'Headphones (USB Headset)' }, { id: 'o-mon', name: 'Monitor (HDMI Audio)' }], presets: [{ name: 'VR', deviceId: 'o-vr', deviceName: 'Speakers (VR Headset)' }, { name: 'Headphones', deviceId: 'o-hp', deviceName: 'Headphones (USB Headset)' }], hotkey: 'Ctrl+Alt+O' };
      if (ch === 'listen:set') return { ok: true, deviceId: a[0], name: 'Headphones (USB Headset)', changes: ['Windows default (all roles)', 'Blur Sounds “You hear” mix', 'channels: Game, Chat, Media, Aux', '2 app routes'] };
      if (ch === 'hifi:status') return new URLSearchParams(location.search).get('hifi') === 'missing'
        ? { installed: false, partial: false, phase: new URLSearchParams(location.search).get('phase') || 'idle', step: 'download', pct: 64, page: 'https://vb-audio.com/Cable/', donate: 'https://vb-audio.com/Voicemeeter/Donationware.htm', driver: { registered: false } }
        : { installed: true, inputName: 'Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)', outputName: 'Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)', phase: 'idle', page: 'https://vb-audio.com/Cable/', donate: 'https://vb-audio.com/Voicemeeter/Donationware.htm', driver: { registered: true, device: 'VB-Audio Hi-Fi Cable', deviceStatus: 'OK' } };
      return null;
    },
    onUpdate: on('update:state'), onListen: on('listen:switched'), onListenMissing: on('listen:missing'), onHifi: on('hifi:state'),
    onMixer: (cb) => { setTimeout(() => cb(state()), 30); return on('mixer:state')(cb); },
    onLevels: on('mixer:levels'), onMedia: (cb) => { setTimeout(() => cb(media), 30); return () => {}; }, onHelper: (cb) => { setTimeout(() => cb({ status: 'running' }), 10); return () => {}; },
    onChatbox: on('chatbox:state'), onEngine: (cb) => { setTimeout(() => cb(engine), 20); return () => {}; }, onClipSaved: on('clip:saved'), onRecSaved: on('rec:saved'), onSoundTrigger: on('x'), onSoundStop: on('y'), onHotkeyErrors: on('z'), fileUrl: (p) => p,
  };
}
