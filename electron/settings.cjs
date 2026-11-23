const fs = require('fs');
const path = require('path');

const CHANNELS = ['game', 'chat', 'media', 'aux'];

const FLAT_BANDS = () => [
  { type: 'lowcut', f: 30, g: 0, q: 0.7, on: false },
  { type: 'lowshelf', f: 90, g: 0, q: 0.7, on: true },
  { type: 'peak', f: 250, g: 0, q: 1.0, on: true },
  { type: 'peak', f: 1000, g: 0, q: 1.0, on: true },
  { type: 'peak', f: 3000, g: 0, q: 1.0, on: true },
  { type: 'highshelf', f: 9000, g: 0, q: 0.7, on: true },
  { type: 'highcut', f: 20000, g: 0, q: 0.7, on: false },
];
const eqDefault = () => ({ enabled: false, preset: 'flat', preampDb: 0, bands: FLAT_BANDS() });
const chDefault = () => ({ volume: 1, muted: false, output: null, mode: 'direct', cableId: null, streamVolume: 1, streamMuted: false, inClip: true, inRec: true, eq: eqDefault() });

function defaults() {
  return {
    version: 1,
    ui: { page: 'mixer' },
    app: { startWithWindows: false, closeToTray: false, importedMagicChatbox: false },
    mixer: {
      channelList: [
        { id: 'game', label: 'Game', icon: 'game', builtin: true },
        { id: 'chat', label: 'Chat', icon: 'chat', builtin: true },
        { id: 'media', label: 'Media', icon: 'media', builtin: true },
        { id: 'aux', label: 'Aux', icon: 'aux', builtin: true },
      ],
      channels: { game: chDefault(), chat: chDefault(), media: chDefault(), aux: chDefault() },
      chatMix: 0,
      streamMode: false,
      personalOut: null,
      streamOut: null,
      master: { deviceId: null },
      mic: { deviceId: null, meter: true },
      assignments: {
        vrchat: 'game', vrserver: 'game', vrmonitor: 'game', vrwebhelper: 'game', steam: 'game',
        discord: 'chat', discordptb: 'chat', discordcanary: 'chat', teams: 'chat', 'ms-teams': 'chat', zoom: 'chat', ts3client_win64: 'chat', mumble: 'chat',
        spotify: 'media', nocturne: 'media', chrome: 'media', opera: 'media', msedge: 'media', firefox: 'media', brave: 'media', vlc: 'media', 'music.ui': 'media', applemusic: 'media', foobar2000: 'media', youtubemusic: 'media',
      },
      apps: {}, // process -> { volume, muted }
      hidden: ['audiodg'],
    },
    chatbox: {
      live: false,
      ip: '127.0.0.1',
      port: 9000,
      sendIntervalSec: 2,
      separator: 'newline',
      typingIndicator: true,
      notify: false,
      modules: {
        status: { enabled: true, rotateSec: 5, random: false, items: [{ text: 'Blur Sounds Pro ✦', enabled: true }] },
        time: { enabled: true, h24: false, prefix: '🕒 ', showSeconds: false },
        nowPlaying: { enabled: true, template: '🎵 {title} - {artist}', showPaused: false, pausedTemplate: '⏸ Paused', progress: false },
        focus: { enabled: false, template: 'ⁱⁿ {app}' },
        message: { durationSec: 12 },
      },
      order: ['status', 'message', 'nowPlaying', 'focus', 'time', 'weather'],
      history: [],
      opt: {},
      profiles: {},
      stopwatch: { running: false, startedAt: 0, acc: 0 },
    },
    soundboard: { outputLabel: '', monitor: true, volume: 0.8, stopHotkey: '', sounds: [] },
    micChain: {
      enabled: false, outId: null, gainDb: 0, clearcast: false, inStream: true,
      gate: { enabled: true, thresholdDb: -48, holdMs: 150, releaseMs: 120, attackMs: 2, rangeDb: -60 },
      ns: { enabled: true, amount: 0.9, engine: 'rnnoise' },
      hpf: { enabled: false, freq: 90 },
      aec: { enabled: false, refId: null, strength: 'strong' },
      bypass: false,
      monitor: { enabled: false, volume: 0.8 },
      comp: { enabled: true, thresholdDb: -20, ratio: 3, makeupDb: 4, attackMs: 5, releaseMs: 120 },
      eq: { ...eqDefault(), preset: 'flat' },
    },
    clips: {
      enabled: true, seconds: 30, hotkey: 'F8', includeMic: true, folder: null,
      voice: { enabled: true, phrase: 'clip it' },
      video: { enabled: true, display: 0, fps: 60, bitrateMbps: 16 },
      sound: true,
      audioSource: 'auto', systemDevice: null,
    },
    record: { video: true, includeMic: true, folder: null },
  };
}

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over === undefined ? base : over;
  if (base && typeof base === 'object' && over && typeof over === 'object') {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  return over === undefined ? base : over;
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'settings.json');
    fs.mkdirSync(dir, { recursive: true });
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    this.data = deepMerge(defaults(), saved);
    // v2 migration: every channel gets the new fields
    const m = this.data.mixer;
    for (const c of m.channelList) m.channels[c.id] = deepMerge(chDefault(), m.channels[c.id] || {});
    // v2.2 broadcast guard: an app channel may never be routed straight into the stream cable or the
    // virtual-mic cable; that would put the app into the broadcast no matter what its stream toggle says.
    if (m.guard === undefined) m.guard = true;
    for (const c of m.channelList) {
      const ch = m.channels[c.id];
      if (ch.mode === 'cable' && ch.cableId && (ch.cableId === m.streamOut || ch.cableId === this.data.micChain.outId)) { ch.mode = 'direct'; ch.cableId = null; m.guardFixed = (m.guardFixed || 0) + 1; }
      if (ch.output && (ch.output === m.streamOut || ch.output === this.data.micChain.outId)) { ch.output = null; m.guardFixed = (m.guardFixed || 0) + 1; }
    }
    if (!this.data.micChain.aec.strength) this.data.micChain.aec.strength = 'strong';
    if (!this.data.micChain.ns.engine) this.data.micChain.ns.engine = 'rnnoise'; // DeepFilterNet3 is opt-in in the Mic chain drawer
    // v2.1 chatbox migration: keep the user's order, add weather right after time, then any new modules
    const cb = this.data.chatbox; cb.order = Array.isArray(cb.order) ? cb.order : [];
    if (!cb.order.includes('weather')) { const i = cb.order.indexOf('time'); cb.order.splice(i >= 0 ? i + 1 : cb.order.length, 0, 'weather'); }
    try { for (const m of require('./cbschema.json').modules) if (!cb.order.includes(m.id)) cb.order.push(m.id); } catch {}
    this.timer = null;
  }
  get() { return this.data; }
  set(next) { this.data = next; this.saveSoon(); }
  patch(fn) { fn(this.data); this.saveSoon(); return this.data; }
  saveSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), 400);
  }
  saveNow() {
    clearTimeout(this.timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store, defaults, CHANNELS, chDefault, eqDefault, FLAT_BANDS };
