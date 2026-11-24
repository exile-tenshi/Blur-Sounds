const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, Tray, Menu, nativeImage, session, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { Store, chDefault } = require('./settings.cjs');
const { MediaManager } = require('./media.cjs');
const { Helper } = require('./helper.cjs');
const hifi = require('./hificable.cjs');
const { Chatbox } = require('./chatbox.cjs');
const { importMagicChatbox } = require('./mcb.cjs');

const APP_NAME = 'Blur Sounds Pro';
app.setName(APP_NAME);
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));
if (process.platform === 'win32') app.setAppUserModelId('com.blursounds.pro');

if (!app.requestSingleInstanceLock()) { app.exit(0); } // hand off (e.g. --listen=...) to the running copy without starting Chromium

const store = new Store(app.getPath('userData'));
const S = () => store.get();
let win = null; let tray = null; let quitting = false;

const isDev = !app.isPackaged;
const helperExe = isDev
  ? path.join(__dirname, '..', 'helper-bin', 'BspAudioHelper.exe')
  : path.join(process.resourcesPath, 'helper', 'BspAudioHelper.exe');
const helperLog = path.join(app.getPath('userData'), 'logs', 'helper.log');
const helper = new Helper(helperExe, helperLog);

function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

// ---------------- mixer ----------------
let snapshot = null; let helperStatus = { status: 'stopped', detail: '' };
const seenPids = new Map(); // pid -> output applied
const iconCache = new Map();

const chIds = () => S().mixer.channelList.map((c) => c.id);
function channelFor(s) {
  const a = S().mixer.assignments; const p = (s.process || '').toLowerCase();
  if (a[p] && S().mixer.channels[a[p]]) return a[p];
  if (s.path && /steamapps\\common/i.test(s.path)) return 'game';
  return 'aux';
}
function appCfg(proc) { return S().mixer.apps[(proc || '').toLowerCase()]; }

async function iconFor(p) {
  if (!p) return null;
  if (iconCache.has(p)) return iconCache.get(p);
  iconCache.set(p, null);
  try { const img = await app.getFileIcon(p, { size: 'normal' }); iconCache.set(p, img.toDataURL()); } catch {}
  return iconCache.get(p);
}

// ChatMix: -1 = all game, +1 = all chat (like the Arctis ChatMix dial).
function chatMixFactor(id) {
  const x = Number(S().mixer.chatMix) || 0;
  if (id === 'game') return x > 0 ? 1 - x : 1;
  if (id === 'chat') return x < 0 ? 1 + x : 1;
  return 1;
}
function effective(s) {
  const id = channelFor(s);
  const ch = S().mixer.channels[id] || { volume: 1, muted: false };
  const a = appCfg(s.process) || { volume: 1, muted: false };
  // Cable channels: the engine applies channel volume/ChatMix/EQ, so the app session only carries the app's own level.
  if (ch.mode === 'cable' && ch.cableId) return { volume: Math.max(0, Math.min(1, a.volume)), muted: !!a.muted };
  return { volume: Math.max(0, Math.min(1, a.volume * ch.volume * chatMixFactor(id))), muted: !!(a.muted || ch.muted) };
}

async function applySession(s, force) {
  const e = effective(s);
  if (force || Math.abs(e.volume - s.volume) > 0.005) await helper.call('setSessionVolume', { pid: s.pid, volume: e.volume });
  if (force || e.muted !== s.muted) await helper.call('setSessionMute', { pid: s.pid, mute: e.muted });
}

// ---- v2.2 broadcast guard ----
// Devices that carry the broadcast (stream mix cable, virtual-mic cable). No app may ever play straight into
// one of these: it would be heard on stream / in VRChat / Discord whatever its broadcast toggle says.
function guardedIds() {
  const m = S().mixer; const mc = S().micChain; const g = new Set();
  if (m.guard === false) return g;
  if (m.streamOut) g.add(m.streamOut);
  if (mc.enabled && mc.outId) g.add(mc.outId);
  return g;
}
function isGuarded(id) { return !!id && guardedIds().has(id); }
// A real, non-broadcast output to fall back to: the last safe Windows default, then "You hear", then any non-cable output.
function safeOut() {
  const m = S().mixer; const outs = (snapshot && snapshot.outputs) || [];
  const ok = (id) => id && !isGuarded(id) && outs.some((o) => o.id === id);
  const notCable = (o) => !CABLE_RX.test(o.name) && !isGuarded(o.id);
  if (snapshot && ok(snapshot.defaultOutput)) return snapshot.defaultOutput;
  if (ok(m.lastSafeDefault)) return m.lastSafeDefault;
  if (ok(m.personalOut)) return m.personalOut;
  for (const c of m.channelList) { const o = m.channels[c.id].output; if (ok(o)) return o; }
  const f = outs.find(notCable); return f ? f.id : '';
}
const guardLog = [];
function guardNote(msg) {
  guardLog.unshift({ at: Date.now(), msg }); guardLog.length = Math.min(guardLog.length, 20);
  send('guard:event', guardLog[0]);
}
let lastDefaultSeen = null, lastDefaultFix = 0;
async function guardDefault() {
  if (!snapshot) return;
  const m = S().mixer; const def = snapshot.defaultOutput;
  if (def !== lastDefaultSeen) { lastDefaultSeen = def; seenPids.clear(); } // re-evaluate every app after a device change
  if (def && !isGuarded(def) && !CABLE_RX.test((snapshot.outputs.find((o) => o.id === def) || {}).name || '') && m.lastSafeDefault !== def) { m.lastSafeDefault = def; store.saveSoon(); }
  if (!isGuarded(def) || Date.now() - lastDefaultFix < 4000) return;
  const to = safeOut(); if (!to) return;
  lastDefaultFix = Date.now();
  try {
    await helper.call('setDefaultDevice', { deviceId: to, communications: true });
    const nm = (id) => (snapshot.outputs.find((o) => o.id === id) || {}).name || id;
    guardNote(`Windows switched its default speakers to “${nm(def)}” (your stream cable). Moved it back to “${nm(to)}” so desktop audio can't leak into the broadcast.`);
  } catch (e) { guardNote('Could not move the Windows default off the stream cable: ' + e.message); }
}

async function applyOutput(s) {
  if (s.system || !snapshot || !snapshot.routingSupported) return;
  const ch = S().mixer.channels[channelFor(s)];
  let want = ch ? ((ch.mode === 'cable' && ch.cableId) ? ch.cableId : (ch.output || '')) : '';
  if (isGuarded(want)) want = safeOut(); // never pin an app into the broadcast cable
  // App follows the Windows default but the default is the stream cable: pin it somewhere safe.
  if (!want && isGuarded(snapshot.defaultOutput)) want = safeOut();
  const key = want;
  if (seenPids.get(s.pid) === key) return;
  const prev = seenPids.get(s.pid);
  seenPids.set(s.pid, key);
  if (!want && !prev) {
    // Leave Windows' own per-app choice alone, unless it points into the broadcast (stale route from an
    // older setup / Windows remembering it per .exe) - then clear it.
    try { const r = await helper.call('getAppOutput', { pid: s.pid }); const cur = r && r.ok !== false ? String(r.result || '') : ''; if (cur && [...guardedIds()].some((g) => cur.includes(g))) { await helper.call('setAppOutput', { pid: s.pid, deviceId: '' }); guardNote(`${s.process} was pinned to the stream cable by Windows; cleared it.`); } } catch {}
    return;
  }
  await helper.call('setAppOutput', { pid: s.pid, deviceId: want });
}

function visibleSessions() {
  if (!snapshot) return [];
  const hidden = new Set([...(S().mixer.hidden || []), 'bspaudiohelper']);
  return snapshot.sessions.filter((s) => !hidden.has((s.process || '').toLowerCase()));
}

async function onSnapshot(snap) {
  snapshot = snap;
  const m = S().mixer; let dirty = false;
  await guardDefault().catch(() => {});
  checkListeningDevice();
  for (const s of visibleSessions()) {
    const key = (s.process || '').toLowerCase();
    if (!m.apps[key]) {
      // Remember the app's current level relative to its channel so nothing jumps.
      const ch = m.channels[channelFor(s)];
      m.apps[key] = { volume: ch.volume > 0 ? Math.min(1, s.volume / ch.volume) : s.volume, muted: false };
      dirty = true;
    } else if (!seenPids.has(s.pid)) {
      await applySession(s, false);
    }
    await applyOutput(s);
  }
  if (dirty) store.saveSoon();
  pushEngine();
  pushMixer();
}

async function pushMixer() {
  if (!snapshot) { send('mixer:state', { helper: helperStatus, ready: false }); return; }
  const sessions = [];
  for (const s of visibleSessions()) {
    const a = appCfg(s.process) || { volume: 1, muted: false };
    sessions.push({ pid: s.pid, process: s.process, name: s.name, active: s.active, system: s.system, channel: channelFor(s), appVolume: a.volume, appMuted: a.muted, icon: await iconFor(s.path) });
  }
  // merge duplicate processes (e.g. two Discord pids) for display
  const byProc = new Map();
  for (const s of sessions) {
    const k = s.process.toLowerCase();
    if (!byProc.has(k)) byProc.set(k, { ...s, pids: [s.pid] });
    else { const e = byProc.get(k); e.pids.push(s.pid); e.active = e.active || s.active; if (!e.icon) e.icon = s.icon; }
  }
  send('mixer:state', {
    helper: helperStatus, ready: true, cables: detectCables(), sonarRunning: sonarRunning(),
    outputs: snapshot.outputs, inputs: snapshot.inputs,
    defaultOutput: snapshot.defaultOutput, defaultInput: snapshot.defaultInput, defaultCommsInput: snapshot.defaultCommsInput,
    routingSupported: snapshot.routingSupported,
    guarded: [...guardedIds()], guardOn: S().mixer.guard !== false, guardLog: guardLog.slice(0, 5), defaultIsGuarded: isGuarded(snapshot.defaultOutput),
    sessions: [...byProc.values()],
    settings: S().mixer, micChain: S().micChain,
  });
}

async function applyProcess(proc) {
  if (!snapshot) return;
  for (const s of visibleSessions()) if ((s.process || '').toLowerCase() === proc) await applySession(s, true);
}
async function applyChannel(ch) {
  if (!snapshot) return;
  for (const s of visibleSessions()) if (channelFor(s) === ch) await applySession(s, true);
}
async function rerouteChannel(ch) {
  if (!snapshot) return;
  for (const s of visibleSessions()) if (channelFor(s) === ch) { await applySession(s, true); await applyOutput(s); }
}

// ---------------- cables + engine ----------------
const CABLE_RX = /(cable|vb-audio|voicemeeter|steelseries sonar|blur ?sounds)/i;
function sonarRunning() { return !!(snapshot && snapshot.sessions.some((x) => /^steelseriessonar$/i.test(x.process || ''))); }
function detectCables() {
  if (!snapshot) return [];
  const sonar = sonarRunning();
  const used = {};
  const m = S().mixer;
  for (const c of m.channelList) { const ch = m.channels[c.id]; if (ch.mode === 'cable' && ch.cableId) (used[ch.cableId] = used[ch.cableId] || []).push(c.label); }
  if (m.streamMode && m.streamOut) (used[m.streamOut] = used[m.streamOut] || []).push('Stream mix');
  if (S().micChain.enabled && S().micChain.outId) (used[S().micChain.outId] = used[S().micChain.outId] || []).push('Virtual mic');
  return snapshot.outputs.filter((o) => CABLE_RX.test(o.name)).map((o) => {
    const isSonar = /sonar/i.test(o.name);
    const base = o.name.replace(/\s*\(.*$/, '').replace(/input/i, '').trim();
    const pair = snapshot.inputs.find((i) => i.name !== o.name && i.name.replace(/\s*\(.*$/, '').replace(/output/i, '').trim() === base && /\(([^)]*)\)/.exec(i.name)?.[1] === /\(([^)]*)\)/.exec(o.name)?.[1]);
    return { id: o.id, name: o.name, recordName: pair ? pair.name : null, recordId: pair ? pair.id : null, sonar: isSonar, ownedBySonar: isSonar && sonar, usedBy: used[o.id] || [] };
  });
}
let engineTimer = null;
function pushEngine() { clearTimeout(engineTimer); engineTimer = setTimeout(() => helper.call('engineConfig', { config: engineConfig() }), 120); }
function engineConfig() {
  const m = S().mixer; const mc = S().micChain; const c = S().clips; const r = S().record;
  const sessions = visibleSessions();
  // A saved mic that isn't plugged in / doesn't exist on this PC falls back to the Windows default mic (the setting itself is kept).
  const micKnown = !m.mic.deviceId || !snapshot || !snapshot.inputs || snapshot.inputs.some((i) => i.id === m.mic.deviceId);
  const micId = (micKnown && m.mic.deviceId) || (snapshot && (snapshot.defaultCommsInput || snapshot.defaultInput)) || null;
  return {
    streamMode: !!m.streamMode, personalOut: (m.personalOut && snapshot && snapshot.outputs.some((o) => o.id === m.personalOut)) ? m.personalOut : null, /* unplugged -> Windows default */ streamOut: m.streamOut || null,
    channels: m.channelList.map(({ id }) => {
      const ch = m.channels[id];
      return {
        id, mode: ch.mode, cableId: ch.cableId, volume: ch.volume * chatMixFactor(id), muted: ch.muted,
        streamVolume: ch.streamVolume, streamMuted: ch.streamMuted, inClip: ch.inClip, inRec: ch.inRec, eq: ch.eq,
        pids: sessions.filter((s) => !s.system && channelFor(s) === id).map((s) => s.pid),
      };
    }),
    mic: {
      deviceId: micId, meter: m.mic.meter, chain: mc.enabled, outId: mc.outId, gate: mc.gate, ns: { ...mc.ns, modelPath: dfModelPath() }, clearcast: mc.clearcast, comp: mc.comp, eq: mc.eq,
      hpf: mc.hpf, aec: { ...mc.aec, refId: mc.aec && mc.aec.refId ? mc.aec.refId : aecRefDefault() }, bypass: !!mc.bypass, monitor: mc.monitor,
      gainDb: mc.gainDb, muted: false, inStream: mc.inStream, inClip: c.includeMic, inRec: r.includeMic,
    },
    voice: { enabled: !!(c.enabled && c.voice.enabled), phrase: c.voice.phrase || 'clip it', modelPath: voiceModelPath() },
    clip: { enabled: !!c.enabled, bufferSeconds: Math.max(30, (c.seconds || 30) + 5), source: c.audioSource || 'auto', systemDevice: c.systemDevice || null },
    record: { active: !!(media && media.rec) },
  };
}
function dfModelPath() {
  const cands = [path.join(process.resourcesPath || '', 'models', 'deepfilter', 'DeepFilterNet3_onnx.tar.gz'), path.join(__dirname, '..', 'models', 'deepfilter', 'DeepFilterNet3_onnx.tar.gz')];
  return cands.find((p) => fs.existsSync(p)) || cands[0];
}
// Echo reference = what you actually hear: the game channel's device (VR headset), else "You hear", else the Windows default.
function aecRefDefault() {
  const m = S().mixer; const outs = (snapshot && snapshot.outputs) || [];
  const ok = (id) => id && !isGuarded(id) && outs.some((o) => o.id === id);
  for (const id of ['game', 'chat', 'media']) { const o = m.channels[id] && m.channels[id].output; if (ok(o)) return o; }
  if (ok(m.personalOut)) return m.personalOut;
  return safeOut() || null;
}
function voiceModelPath() {
  const cands = [path.join(process.resourcesPath || '', 'models', 'vosk-model-small-en-us-0.15'), path.join(__dirname, '..', 'models', 'vosk-model-small-en-us-0.15'), path.join(app.getPath('userData'), 'models', 'vosk-model-small-en-us-0.15')];
  return cands.find((p) => fs.existsSync(p)) || cands[0];
}

ipcMain.handle('mixer:channel', async (_e, ch, patch) => {
  const c = S().mixer.channels[ch]; if (!c) return;
  if (patch.mode === 'cable' && patch.cableId === undefined && !c.cableId) return { ok: false, error: 'pick a cable first' };
  if (isGuarded(patch.cableId) || isGuarded(patch.output)) return { ok: false, error: 'That device carries your stream / virtual mic. Apps on it would always be broadcast, so Blur Sounds Pro blocks it.' };
  const routeChanged = ['output', 'mode', 'cableId'].some((k) => k in patch && patch[k] !== c[k]);
  Object.assign(c, patch); store.saveSoon();
  if (routeChanged) await rerouteChannel(ch); else await applyChannel(ch);
  pushEngine(); helper.call('refresh');
  return { ok: true };
});
ipcMain.handle('mixer:get', () => { pushMixer(); return true; });
ipcMain.handle('mixer:global', async (_e, patch) => {
  Object.assign(S().mixer, patch); store.saveSoon();
  if ('chatMix' in patch) { await applyChannel('game'); await applyChannel('chat'); }
  pushEngine(); pushMixer(); return S().mixer;
});
ipcMain.handle('mixer:addChannel', async (_e, { label, cableId }) => {
  const m = S().mixer; const id = 'c' + Date.now().toString(36);
  m.channelList.push({ id, label: String(label || 'Channel').slice(0, 24), icon: 'cable', builtin: false });
  m.channels[id] = { ...chDefault(), mode: cableId ? 'cable' : 'direct', cableId: cableId || null };
  store.saveSoon(); pushEngine(); pushMixer(); return id;
});
ipcMain.handle('mixer:removeChannel', async (_e, id) => {
  const m = S().mixer; const c = m.channelList.find((x) => x.id === id); if (!c || c.builtin) return;
  for (const [p, ch] of Object.entries(m.assignments)) if (ch === id) m.assignments[p] = 'aux';
  m.channelList = m.channelList.filter((x) => x.id !== id); delete m.channels[id];
  store.saveSoon(); await rerouteChannel('aux'); pushEngine(); pushMixer();
});
ipcMain.handle('mixer:renameChannel', (_e, id, label) => { const c = S().mixer.channelList.find((x) => x.id === id); if (c) c.label = String(label).slice(0, 24); store.saveSoon(); pushMixer(); });
ipcMain.handle('mic:chain', (_e, patch) => { Object.assign(S().micChain, patch); store.saveSoon(); pushEngine(); pushMixer(); return S().micChain; });
ipcMain.handle('mixer:app', async (_e, proc, patch) => {
  proc = proc.toLowerCase();
  S().mixer.apps[proc] = { ...(S().mixer.apps[proc] || { volume: 1, muted: false }), ...patch }; store.saveSoon();
  await applyProcess(proc); helper.call('refresh');
});
ipcMain.handle('mixer:assign', async (_e, proc, ch) => {
  proc = proc.toLowerCase();
  if (!S().mixer.channels[ch]) return;
  S().mixer.assignments[proc] = ch; store.saveSoon();
  if (snapshot) for (const s of visibleSessions()) if ((s.process || '').toLowerCase() === proc) { await applySession(s, true); await applyOutput(s); }
  pushEngine(); helper.call('refresh'); pushMixer();
});
ipcMain.handle('mixer:hide', async (_e, proc, hidden) => {
  const h = new Set(S().mixer.hidden || []); hidden ? h.add(proc.toLowerCase()) : h.delete(proc.toLowerCase());
  S().mixer.hidden = [...h]; store.saveSoon(); pushMixer();
});
ipcMain.handle('mixer:device', async (_e, kind, deviceId, patch) => {
  // kind: 'master' | 'mic'
  if ('select' in patch) { S().mixer[kind].deviceId = patch.select; store.saveSoon(); pushEngine(); }
  if ('meter' in patch) { S().mixer.mic.meter = patch.meter; store.saveSoon(); pushEngine(); }
  const r = [];
  if ('volume' in patch) r.push(await helper.call('setDeviceVolume', { deviceId, volume: patch.volume }));
  if ('mute' in patch) r.push(await helper.call('setDeviceMute', { deviceId, mute: patch.mute }));
  if (patch.makeDefault) r.push(await helper.call('setDefaultDevice', { deviceId, communications: true }));
  helper.call('refresh');
  return r;
});
// Reset routing: put every app back on Windows' own device choice and stop all engine routing.
ipcMain.handle('mixer:resetRouting', async () => {
  const m = S().mixer;
  for (const c of m.channelList) Object.assign(m.channels[c.id], { output: null, mode: 'direct' });
  m.streamMode = false; S().micChain.enabled = false;
  await helper.call('engineReset');
  await helper.call('clearAppOutputs'); seenPids.clear();
  store.saveSoon(); pushEngine(); helper.call('refresh'); pushMixer();
  return { ok: true };
});
ipcMain.handle('media:control', (_e, action) => helper.call('mediaControl', { action }));

helper.on('snapshot', (d) => onSnapshot(d).catch(() => {}));
helper.on('levels', (d) => send('mixer:levels', d));
let engineState = null;
helper.on('engine', (d) => { engineState = d; send('engine:state', { engine: d, media: media.status() }); });
helper.on('voice', async (d) => { const r = await media.saveClip('voice'); clipDone(r, `Heard “${d.text}”`); });
helper.on('status', (st) => { if (st === 'running') { seenPids.clear(); pushEngine(); } });
helper.on('media', (d) => { chatbox.setMedia(d); send('media:state', d); });
helper.on('status', (st, detail, info) => {
  helperStatus = { status: st, detail: detail || '', ...(info ? { message: info.message, hint: info.hint, code: info.code, fatal: !!info.fatal } : {}), log: helperLog };
  send('helper:status', helperStatus); if (!snapshot) pushMixer();
});
// ---------------- v2.3 listening device: one click moves everything you hear ----------------
function listenCfg() { const m = S().mixer; if (!m.listen) m.listen = { deviceId: null, presets: [], hotkey: '' }; if (!Array.isArray(m.listen.presets)) m.listen.presets = []; return m.listen; }
function listenable(o) { return o && !CABLE_RX.test(o.name) && !isGuarded(o.id); }
function listenOptions() { return ((snapshot && snapshot.outputs) || []).filter(listenable).map((o) => ({ id: o.id, name: o.name })); }
function currentListening() { return (snapshot && snapshot.defaultOutput) || listenCfg().deviceId || null; }
let listenBusy = false;
async function switchListening(to, why = 'manual') {
  if (!snapshot) return { ok: false, error: 'The audio engine is not running.' };
  const dev = snapshot.outputs.find((o) => o.id === to);
  if (!dev) return { ok: false, error: 'That device is not connected.' };
  if (!listenable(dev)) return { ok: false, error: `“${dev.name}” is a virtual cable / your stream output. Pick real headphones or speakers.` };
  if (listenBusy) return { ok: false, error: 'busy' };
  listenBusy = true;
  try {
    const m = S().mixer; const mc = S().micChain; const L = listenCfg();
    const from = new Set([snapshot.defaultOutput, L.deviceId, m.personalOut].filter((x) => x && x !== to && !isGuarded(x)));
    const changes = [];
    // 1) Windows default for console + multimedia + communications
    const r = await helper.call('setDefaultDevice', { deviceId: to, communications: true });
    if (r && r.ok === false) throw new Error(r.error || 'Windows refused the new default device');
    changes.push('Windows default (all roles)');
    // 2) BSP's own "You hear" mix + mic monitor
    if (m.personalOut !== to) { m.personalOut = to; changes.push('Blur Sounds “You hear” mix'); }
    if (mc.monitor && mc.monitor.deviceId && mc.monitor.deviceId !== to) { mc.monitor.deviceId = to; changes.push('mic monitor'); }
    if (mc.aec && mc.aec.refId && from.has(mc.aec.refId)) { mc.aec.refId = null; changes.push('echo-cancel reference (auto)'); }
    // 3) channels that were sending to the old listening device (direct mode only; cable/stream routes untouched)
    const moved = [];
    for (const c of m.channelList) { const ch = m.channels[c.id]; if (ch.output && from.has(ch.output)) { ch.output = to; moved.push(c.id); } }
    if (moved.length) changes.push('channels: ' + moved.map((id) => (m.channelList.find((c) => c.id === id) || {}).label || id).join(', '));
    L.deviceId = to; L.name = dev.name; L.at = Date.now();
    m.lastSafeDefault = to; store.saveSoon();
    // 4) per-app routes Windows remembered for the old device -> new device
    seenPids.clear(); let apps = 0;
    for (const s of visibleSessions()) {
      if (s.system) continue;
      try {
        const g = await helper.call('getAppOutput', { pid: s.pid }); const cur = g && g.ok !== false ? String(g.result || '') : '';
        if (cur && [...from].some((f) => cur.includes(f.replace(/^\{[^}]*\}\./, '')))) { await helper.call('setAppOutput', { pid: s.pid, deviceId: to }); apps++; }
      } catch {}
      await applyOutput(s).catch(() => {});
    }
    if (apps) changes.push(`${apps} app route${apps > 1 ? 's' : ''}`);
    pushEngine(); helper.call('refresh'); pushMixer(); refreshTray();
    const res = { ok: true, deviceId: to, name: dev.name, changes, why };
    send('listen:switched', res); return res;
  } catch (e) { return { ok: false, error: e.message }; }
  finally { listenBusy = false; }
}
function cycleListening() {
  const L = listenCfg(); const opts = listenOptions(); const have = new Set(opts.map((o) => o.id));
  let ring = L.presets.map((p) => p.deviceId).filter((id) => have.has(id));
  if (ring.length < 2) ring = opts.map((o) => o.id);
  if (!ring.length) return;
  const now = ring.includes(currentListening()) ? currentListening() : L.deviceId; // default may briefly be a cable while the guard fixes it
  const i = ring.indexOf(now);
  return switchListening(ring[(i + 1) % ring.length], 'hotkey').then((r) => { if (r && r.ok) notify('Listening on ' + r.name); return r; });
}
function notify(body) { try { if (Notification.isSupported()) new Notification({ title: APP_NAME, body, silent: true }).show(); } catch {} }
let lastListenMissing = null;
function checkListeningDevice() {
  // Chosen device unplugged: Windows already falls back on its own; keep BSP's mix audible (engine falls back to the default)
  // and remember the choice, so plugging it back in restores it.
  refreshTray();
  const L = listenCfg(); if (!L.deviceId || !snapshot) return;
  const present = snapshot.outputs.some((o) => o.id === L.deviceId);
  if (!present && lastListenMissing !== L.deviceId) { lastListenMissing = L.deviceId; send('listen:missing', { deviceId: L.deviceId, name: L.name }); refreshTray(); }
  else if (present && lastListenMissing === L.deviceId) { lastListenMissing = null; refreshTray(); if (snapshot.defaultOutput !== L.deviceId && L.autoReturn !== false) switchListening(L.deviceId, 'reconnected'); }
}
ipcMain.handle('listen:get', () => ({ current: currentListening(), options: listenOptions(), ...listenCfg(), missing: lastListenMissing }));
ipcMain.handle('listen:set', (_e, id) => switchListening(id));
ipcMain.handle('listen:cycle', () => cycleListening());
ipcMain.handle('listen:presets', (_e, presets, hotkey) => {
  const L = listenCfg();
  if (Array.isArray(presets)) L.presets = presets.filter((p) => p && p.deviceId && !isGuarded(p.deviceId)).slice(0, 8).map((p) => ({ name: String(p.name || 'Preset').slice(0, 24), deviceId: p.deviceId, deviceName: p.deviceName || ((snapshot && snapshot.outputs.find((o) => o.id === p.deviceId)) || {}).name || '' }));
  if (typeof hotkey === 'string') L.hotkey = hotkey.trim();
  store.saveSoon(); registerHotkeys(); refreshTray(); return listenCfg();
});

// ---------------- v2.3 Hi-Fi Cable installer ----------------
let hifiState = { phase: 'idle' };
function hifiStatus() { return { ...hifi.detect(snapshot), phase: hifiState.phase, step: hifiState.step, pct: hifiState.pct, error: hifiState.error, verified: hifiState.verified, configured: hifiState.configured, page: hifi.PKG.page, donate: hifi.PKG.donate, version: 'v1.0.0.7 (HiFiCableAsioBridgeSetup_v1007.zip)' }; }
function hifiPush(patch) { hifiState = { ...hifiState, ...patch }; send('hifi:state', hifiStatus()); }
function autoConfigureHifi() {
  const d = hifi.detect(snapshot); if (!d.installed) return null;
  const m = S().mixer; const outs = snapshot.outputs; const done = [];
  if (!m.streamOut || !outs.some((o) => o.id === m.streamOut)) { m.streamOut = d.inputId; done.push('Stream mix → Hi-Fi Cable Input'); }
  if (m.guard === undefined) m.guard = true;
  store.saveSoon(); pushEngine(); pushMixer();
  return { streamOut: m.streamOut, recordWith: d.outputName, changes: done };
}
async function waitForHifi(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { helper.call('refresh'); await new Promise((r) => setTimeout(r, 2000)); if (hifi.detect(snapshot).installed) return true; }
  return false;
}
ipcMain.handle('hifi:status', async () => ({ ...hifiStatus(), driver: await hifi.driverInfo() }));
ipcMain.handle('hifi:install', async (_e, opts = {}) => {
  if (['download', 'verify', 'extract', 'install', 'detect'].includes(hifiState.phase)) return hifiStatus();
  const work = path.join(app.getPath('userData'), 'downloads', 'hifi-cable');
  try {
    hifiPush({ phase: 'download', step: 'download', pct: 0, error: null, verified: null, configured: null });
    const prep = await hifi.prepare(work, (p) => hifiPush({ phase: p.step === 'verified' ? 'verify' : p.step, step: p.step, pct: p.pct ?? hifiState.pct, verified: p.verified || hifiState.verified }));
    if (opts.dryRun) { hifiPush({ phase: 'ready', step: 'verified', verified: prep.verified, exe: prep.exe }); return { ...hifiStatus(), exe: prep.exe }; }
    hifiPush({ phase: 'install', step: 'install' });
    const r = await hifi.runInstaller(prep.exe);
    if (!r.ok) { hifiPush({ phase: r.cancelled ? 'cancelled' : 'failed', error: r.error }); return hifiStatus(); }
    hifiPush({ phase: 'detect', step: 'detect' });
    if (await waitForHifi(45000)) { hifiPush({ phase: 'done', configured: autoConfigureHifi() }); }
    else { const drv = await hifi.driverInfo(); hifiPush({ phase: drv.registered || drv.device ? 'reboot' : 'failed', error: drv.registered || drv.device ? null : `The installer finished (exit ${r.exitCode}) but no Hi-Fi Cable devices appeared. Run it again and click “Install Driver”.` }); }
  } catch (e) { hifiPush({ phase: 'failed', error: e.message }); }
  return hifiStatus();
});
ipcMain.handle('hifi:configure', () => { const c = autoConfigureHifi(); hifiPush({ configured: c }); return hifiStatus(); });
ipcMain.handle('hifi:restart', () => { require('child_process').execFile('shutdown.exe', ['/r', '/t', '5', '/c', 'Restarting to finish installing VB-Audio Hi-Fi Cable'], { windowsHide: true }); return true; });
ipcMain.handle('app:openUrl', (_e, url) => { if (/^https:\/\/(vb-audio\.com|www\.vb-audio\.com|github\.com)\//.test(url)) shell.openExternal(url); });

ipcMain.handle('helper:retry', () => { helper.retry(); return true; });
ipcMain.handle('helper:openLogs', () => { try { fs.mkdirSync(path.dirname(helperLog), { recursive: true }); if (!fs.existsSync(helperLog)) fs.writeFileSync(helperLog, ''); } catch {} shell.showItemInFolder(helperLog); return helperLog; });
helper.on('log', (d) => { if (isDev) console.log('[helper]', d.message); });

// ---------------- chatbox ----------------
const chatbox = new Chatbox(() => S(), (st) => send('chatbox:state', st), helper);
ipcMain.handle('chatbox:live', (_e, on) => { chatbox.setLive(on); S().chatbox.live = !!on; store.saveSoon(); return on; });
ipcMain.handle('chatbox:send', (_e, text) => {
  const r = chatbox.sendMessage(text);
  if (r.ok) { const h = S().chatbox.history; h.unshift({ text: String(text).trim(), at: Date.now() }); S().chatbox.history = h.slice(0, Number((S().chatbox.opt || {})['history.size']) || 25); store.saveSoon(); }
  return r;
});
ipcMain.handle('chatbox:typing', (_e, on) => chatbox.setTyping(!!on));
ipcMain.handle('chatbox:clearMessage', () => chatbox.clearMessage());
ipcMain.handle('chatbox:stopwatch', (_e, action) => { const r = chatbox.stopwatch(action); store.saveSoon(); return r; });
ipcMain.handle('chatbox:weatherRefresh', async () => { await chatbox.refreshWeather(); return { data: chatbox.weather.data, error: chatbox.weather.error }; });
const PROFILE_SKIP = ['live', 'history', 'profiles', 'stopwatch'];
const cbSnapshot = () => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(S().chatbox).filter(([k]) => !PROFILE_SKIP.includes(k)))));
function cbApply(data) { if (!data || typeof data !== 'object') throw new Error('not a chatbox profile'); for (const [k, v] of Object.entries(data)) if (!PROFILE_SKIP.includes(k)) S().chatbox[k] = v; store.saveSoon(); registerHotkeys(); }
ipcMain.handle('chatbox:profile', async (_e, action, name) => {
  const cb = S().chatbox; cb.profiles = cb.profiles || {};
  try {
    if (action === 'save') { if (!name) throw new Error('name the profile'); cb.profiles[name] = cbSnapshot(); store.saveSoon(); }
    else if (action === 'load') { if (!cb.profiles[name]) throw new Error('no such profile'); cbApply(cb.profiles[name]); cb.activeProfile = name; }
    else if (action === 'delete') { delete cb.profiles[name]; store.saveSoon(); }
    else if (action === 'export') {
      const r = await dialog.showSaveDialog(win, { title: 'Export chatbox profile', defaultPath: path.join(app.getPath('documents'), `${name || 'chatbox-profile'}.bspchat.json`), filters: [{ name: 'Blur Sounds Pro chatbox profile', extensions: ['json'] }] });
      if (r.canceled) return { ok: false, canceled: true, settings: S() };
      fs.writeFileSync(r.filePath, JSON.stringify({ type: 'blur-sounds-pro-chatbox', version: 1, name: name || 'profile', data: cbSnapshot() }, null, 2)); return { ok: true, file: r.filePath, settings: S() };
    } else if (action === 'import') {
      const r = await dialog.showOpenDialog(win, { title: 'Import chatbox profile', properties: ['openFile'], filters: [{ name: 'Chatbox profile', extensions: ['json'] }] });
      if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true, settings: S() };
      const j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
      if (j.type !== 'blur-sounds-pro-chatbox') throw new Error('That file is not a Blur Sounds Pro chatbox profile');
      cbApply(j.data); if (j.name) cb.profiles[j.name] = j.data; return { ok: true, file: r.filePaths[0], settings: S() };
    }
    return { ok: true, settings: S() };
  } catch (e) { return { ok: false, error: e.message, settings: S() }; }
});
ipcMain.handle('chatbox:import', () => { const r = importMagicChatbox(S()); store.saveSoon(); return { ...r, settings: S() }; });

// ---------------- clips + recording ----------------
const media = new MediaManager({ app, helper, getSettings: S, emit: (what) => { if (what === 'recConfig') pushEngine(); send('engine:state', { engine: engineState, media: media.status() }); } });
function clipDone(r, why) {
  send('clip:saved', { ...r, why });
  if (r.ok) {
    try { new Notification({ title: 'Clip saved', body: `${why} · ${path.basename(r.path)}`, silent: true, icon: path.join(__dirname, '..', 'assets', 'icon.png') }).show(); } catch {}
  }
}
ipcMain.handle('clip:save', async () => { const r = await media.saveClip('button'); clipDone(r, 'Saved from the app'); return r; });
ipcMain.handle('clip:library', (_e, kind) => media.library(kind));
const { Sharer, PRESETS: SHARE_PRESETS, SHAPES: SHARE_SHAPES, copyFile } = require('./share.cjs');
const sharer = new Sharer({ getFfmpeg: () => media.ffmpeg, outDir: () => media.clipsDir(), emit: (p) => send('share:progress', p) });
ipcMain.handle('share:presets', () => ({ presets: SHARE_PRESETS, shapes: SHARE_SHAPES, last: S().clips.share || null }));
ipcMain.handle('share:plan', async (_e, file, o) => { try { return { ok: true, ...(await sharer.plan(file, o)) }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('share:export', async (_e, file, o) => { S().clips.share = { ...o, start: undefined, end: undefined }; store.saveSoon(); try { return await sharer.export(file, o); } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('share:cancel', () => sharer.cancel());
ipcMain.handle('share:copy', (_e, file) => copyFile(file));
ipcMain.handle('share:open', (_e, url) => { if (/^(https:\/\/|discord:\/\/)/.test(String(url))) shell.openExternal(url); return true; });
ipcMain.handle('clip:rename', (_e, file, name) => media.rename(file, name));
ipcMain.handle('clip:delete', async (_e, file) => { await shell.trashItem(file); const th = path.join(path.dirname(file), '.thumbs', path.basename(file) + '.jpg'); try { fs.unlinkSync(th); } catch {} return { ok: true }; });
ipcMain.handle('clip:trim', (_e, file, a, b) => media.trim(file, a, b));
ipcMain.handle('clip:reveal', (_e, file) => { if (file) shell.showItemInFolder(file); else shell.openPath(media.clipsDir()); });
ipcMain.handle('clip:openDir', (_e, kind) => shell.openPath(kind === 'rec' ? media.recDir() : media.clipsDir()));
ipcMain.handle('rec:start', () => media.recStart());
ipcMain.handle('rec:stop', async () => { const r = await media.recStop(); send('rec:saved', r); return r; });
ipcMain.handle('engine:get', () => ({ engine: engineState, media: media.status() }));
function syncMedia() { media.syncRing(); pushEngine(); }

// ---------------- settings ----------------
ipcMain.handle('settings:get', () => S());
ipcMain.handle('settings:set', (_e, keyPath, value) => {
  let o = S(); for (let i = 0; i < keyPath.length - 1; i++) o = o[keyPath[i]];
  o[keyPath[keyPath.length - 1]] = value; store.saveSoon();
  if (keyPath[0] === 'soundboard' || keyPath[0] === 'clips' || (keyPath[0] === 'chatbox' && /^presets\./.test(String(keyPath[2] || '')))) registerHotkeys();
  if (['clips', 'record', 'micChain', 'mixer'].includes(keyPath[0])) syncMedia();
  if (keyPath[0] === 'app' && keyPath[1] === 'startWithWindows') app.setLoginItemSettings({ openAtLogin: !!value });
  return S();
});
ipcMain.handle('app:info', () => ({
  version: app.getVersion(), userData: app.getPath('userData'), helperExe, isDev,
  tools: toolPaths().map((t) => ({ ...t, exists: fs.existsSync(t.path) })),
}));
ipcMain.handle('app:openPath', (_e, p) => shell.openPath(p || app.getPath('userData')));
function toolPaths() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  return [
    { id: 'mcb', name: 'MagicChatbox (standalone)', path: path.join(pf, 'Blur Sounds', 'MagicChatbox', 'MagicChatbox.exe') },
    { id: 'rnnoise', name: 'RNNoise noise suppression', path: path.join(pf, 'Blur Sounds', 'RNNoise', 'RNNoise.exe') },
    { id: 'anytoenglish', name: 'AnyToEnglish translator', path: path.join(pf, 'Blur Sounds', 'AnyToEnglish', 'app', 'AnyToEnglish.exe') },
    { id: 'sonar', name: 'SteelSeries GG', path: path.join(pf, 'SteelSeries', 'GG', 'SteelSeriesGG.exe') },
  ];
}
ipcMain.handle('app:launchTool', (_e, id) => { const t = toolPaths().find((x) => x.id === id); if (t && fs.existsSync(t.path)) return shell.openPath(t.path); return 'not found'; });
ipcMain.handle('win:control', (_e, a) => {
  if (!win) return;
  if (a === 'min') win.minimize();
  else if (a === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (a === 'close') win.close();
});

// ---------------- soundboard ----------------
const soundsDir = () => path.join(app.getPath('userData'), 'sounds');
ipcMain.handle('sound:add', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Add sounds', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'webm'] }] });
  if (r.canceled) return S().soundboard.sounds;
  fs.mkdirSync(soundsDir(), { recursive: true });
  for (const f of r.filePaths) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const dest = path.join(soundsDir(), id + path.extname(f));
    fs.copyFileSync(f, dest);
    S().soundboard.sounds.push({ id, name: path.basename(f, path.extname(f)).slice(0, 40), file: dest, hotkey: '', volume: 1 });
  }
  store.saveSoon(); registerHotkeys();
  return S().soundboard.sounds;
});
ipcMain.handle('sound:remove', (_e, id) => {
  const sb = S().soundboard; const s = sb.sounds.find((x) => x.id === id);
  if (s && s.file.startsWith(soundsDir())) { try { fs.unlinkSync(s.file); } catch {} }
  sb.sounds = sb.sounds.filter((x) => x.id !== id); store.saveSoon(); registerHotkeys();
  return sb.sounds;
});
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const bad = [];
  for (const s of S().soundboard.sounds) {
    if (!s.hotkey) continue;
    try { if (!globalShortcut.register(s.hotkey, () => send('sound:trigger', s.id))) bad.push(s.hotkey); } catch { bad.push(s.hotkey); }
  }
  const ck = S().clips.hotkey;
  if (ck && S().clips.enabled) { try { if (!globalShortcut.register(ck, async () => { const r = await media.saveClip('hotkey'); clipDone(r, `${ck} pressed`); })) bad.push(ck); } catch { bad.push(ck); } }
  const co = S().chatbox.opt || {};
  if (co['presets.hotkeys']) {
    const items = String(co['presets.items'] ?? 'brb 🚶\ngg wp 🏆\nlagging, one sec 🐢\nmuted, typing instead ⌨️').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 9);
    items.forEach((t, i) => { const k = `Ctrl+Shift+${i + 1}`; try { if (!globalShortcut.register(k, () => { const r = chatbox.sendMessage(t); if (r.ok) { const h = S().chatbox.history; h.unshift({ text: t, at: Date.now() }); store.saveSoon(); } })) bad.push(k); } catch { bad.push(k); } });
  }
  const lk = listenCfg().hotkey;
  if (lk) { try { if (!globalShortcut.register(lk, () => cycleListening())) bad.push(lk); } catch { bad.push(lk); } }
  const stop = S().soundboard.stopHotkey;
  if (stop) { try { if (!globalShortcut.register(stop, () => send('sound:stopAll'))) bad.push(stop); } catch { bad.push(stop); } }
  send('sound:hotkeyErrors', bad);
}

// ---------------- window ----------------
function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1100, minHeight: 700, frame: false, backgroundColor: '#0a0b0d', show: false,
    title: APP_NAME, icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => { if (S().app.closeToTray && !quitting) { e.preventDefault(); win.hide(); } });
  if (process.env.VITE_DEV_URL) win.loadURL(process.env.VITE_DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => { send('helper:status', helperStatus); pushMixer(); registerHotkeys(); });
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).resize({ width: 16, height: 16 });
    tray = new Tray(img); tray.setToolTip(APP_NAME);
    refreshTray();
    tray.on('click', () => { win.show(); win.focus(); });
  } catch {}
}
let trayKey = '';
function refreshTray() {
  if (!tray) return;
  const L = listenCfg(); const cur = currentListening(); const opts = listenOptions();
  const presetItems = L.presets.map((p) => { const here = opts.some((o) => o.id === p.deviceId); return { label: `${p.name}${here ? '' : ' (not connected)'}`, type: 'radio', checked: cur === p.deviceId, enabled: here, click: () => switchListening(p.deviceId, 'tray') }; });
  const devItems = opts.map((o) => ({ label: o.name, type: 'radio', checked: cur === o.id, click: () => switchListening(o.id, 'tray') }));
  const key = JSON.stringify([cur, L.presets, opts, !!S().chatbox.live]); if (key === trayKey) return; trayKey = key;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open ' + APP_NAME, click: () => { win.show(); win.focus(); } },
    { label: 'Listen on', submenu: [...presetItems, ...(presetItems.length ? [{ type: 'separator' }] : []), ...devItems, { type: 'separator' }, { label: 'Next device' + (L.hotkey ? `  (${L.hotkey})` : ''), click: () => cycleListening() }] },
    { label: 'Chatbox live', type: 'checkbox', checked: !!S().chatbox.live, click: (mi) => { chatbox.setLive(mi.checked); S().chatbox.live = mi.checked; store.saveSoon(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

// v2.3: `BlurSoundsPro.exe --listen=next|<preset name>|<device id or name>` switches the listening device (Stream Deck, shortcuts).
function listenArg(argv) { const a = (argv || []).find((x) => /^--listen=/.test(x)); return a ? a.slice(9).replace(/^"|"$/g, '') : null; }
async function runListenArg(v, tries = 20) {
  if (!v) return;
  if (!snapshot) { if (tries > 0) setTimeout(() => runListenArg(v, tries - 1), 1000); return; }
  const L = listenCfg(); const opts = listenOptions(); const lv = v.toLowerCase();
  let r;
  if (lv === 'next') r = await cycleListening();
  else {
    const p = L.presets.find((x) => x.name.toLowerCase() === lv);
    const o = p ? { id: p.deviceId } : (opts.find((x) => x.id === v) || opts.find((x) => x.name.toLowerCase() === lv) || opts.find((x) => x.name.toLowerCase().includes(lv)));
    r = o ? await switchListening(o.id, 'command line') : { ok: false, error: 'no device matches ' + v };
  }
  try { fs.mkdirSync(path.join(app.getPath('userData'), 'logs'), { recursive: true }); fs.appendFileSync(path.join(app.getPath('userData'), 'logs', 'listen.log'), `[${new Date().toISOString()}] --listen=${v} -> ${JSON.stringify(r)}\n`); } catch {}
}
app.on('second-instance', (_e, argv) => { const l = listenArg(argv); if (l) return runListenArg(l); if (win) { win.show(); if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  // Allow device labels for the soundboard output picker.
  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(true));
  if (!S().app.importedMagicChatbox) { try { importMagicChatbox(S()); store.saveNow(); } catch {} }
  createWindow(); createTray(); helper.start(); media.syncRing();
  runListenArg(listenArg(process.argv));
});
app.on('before-quit', () => { quitting = true; try { if (S().chatbox.live) chatbox.setLive(false); } catch {} store.saveNow(); media.shutdown(); helper.stop(); globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => app.quit());
