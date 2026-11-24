const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, Tray, Menu, nativeImage, session, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { Store, chDefault, defaults } = require('./settings.cjs');
const { MediaManager } = require('./media.cjs');
const { Helper } = require('./helper.cjs');
const hifi = require('./hificable.cjs');
const { Chatbox } = require('./chatbox.cjs');
const { importMagicChatbox } = require('./mcb.cjs');
const setup = require('./setup.cjs');
const { Updater } = require('./updater.cjs');

const APP_NAME = 'Blur Sounds Pro';
app.setName(APP_NAME);
// BSP_PROFILE_DIR: run with a separate settings folder (clean-profile testing) without touching the real one.
app.setPath('userData', process.env.BSP_PROFILE_DIR ? path.resolve(process.env.BSP_PROFILE_DIR) : path.join(app.getPath('appData'), APP_NAME));
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
// v2.4.2 "EQ what you hear": a Direct channel with its EQ on is played through the engine. Windows applies an app's
// session volume before process loopback (and a muted app can't be captured), so the app is turned down to 1% and the
// engine scales its capture back up x100 (float, no quality loss), EQs it and plays it on the same device.
// Only apps the engine is actually capturing are turned down, and they are put back on quit / crash.
const HEAR_DUCK = 0.01;
let engineCaptured = new Set();
function hearChannel(id) {
  const ch = S().mixer.channels[id]; if (!ch || S().mixer.eqHear === false) return false;
  return ch.mode !== 'cable' && !!(ch.eq && ch.eq.enabled) && helperStatus.status === 'running';
}
function hearSession(s) { return !s.system && hearChannel(channelFor(s)) && engineCaptured.has(s.pid); }
function normalVolume(s) {
  const id = channelFor(s); const ch = S().mixer.channels[id] || { volume: 1 }; const a = appCfg(s.process) || { volume: 1 };
  return Math.max(0, Math.min(1, a.volume * ch.volume * chatMixFactor(id)));
}
function effective(s) {
  const id = channelFor(s);
  const ch = S().mixer.channels[id] || { volume: 1, muted: false };
  const a = appCfg(s.process) || { volume: 1, muted: false };
  if (hearSession(s)) return { volume: Math.max(0, Math.min(1, a.volume)) * HEAR_DUCK, muted: !!(a.muted || ch.muted), restore: normalVolume(s), hear: true };
  // Cable channels: the engine applies channel volume/ChatMix/EQ, so the app session only carries the app's own level.
  if (ch.mode === 'cable' && ch.cableId) return { volume: Math.max(0, Math.min(1, a.volume)), muted: !!a.muted };
  return { volume: Math.max(0, Math.min(1, a.volume * ch.volume * chatMixFactor(id))), muted: !!(a.muted || ch.muted) };
}

async function applySession(s, force) {
  const e = effective(s);
  if (force || Math.abs(e.volume - s.volume) > (e.hear ? 0.0005 : 0.005)) await helper.call('setSessionVolume', e.hear ? { pid: s.pid, volume: e.volume, restore: e.restore } : { pid: s.pid, volume: e.volume });
  if (force || e.muted !== s.muted) await helper.call('setSessionMute', { pid: s.pid, mute: e.muted });
}

// ---- v2.2 broadcast guard ----
// Devices that carry the broadcast (stream mix cable, virtual-mic cable). No app may ever play straight into
// one of these: it would be heard on stream / in VRChat / Discord whatever its broadcast toggle says.
function guardedIds() {
  const m = S().mixer; const mc = S().micChain; const g = new Set();
  if (m.guard === false) return g;
  if (m.streamOut) g.add(m.streamOut);
  if (mc.outId) g.add(mc.outId); // virtual-mic cable (v2.3.1: used whenever chosen)
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
  if (want && !presentOut(want)) want = ''; // saved device not connected: follow the Windows default instead of routing into nothing
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
  if (!S().app.setup.auto) await firstRunSetup().catch((e) => helperLogLine('first-run setup failed: ' + e.message));
  selfHeal();
  cableSetup();
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
    settings: S().mixer, micChain: S().micChain, micPath: micPath(),
    setup: S().app.setup, heal: healState, stream: streamInfoFull(), cableRate: rateInfo(),
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
// ---------------- v2.3.1 virtual-mic / stream cable setup ----------------
// Cable endpoints are matched by name pattern (device IDs differ on every PC), never by another PC's ID.
const MIC_CABLE_RX = [/hi-?fi cable input/i, /^cable input\b/i, /^cable-[a-d] input/i, /voicemeeter (aux |vaio3 )?input/i];
function presentOut(id) { return id && snapshot && snapshot.outputs.some((o) => o.id === id) ? id : null; }
function findMicCable() {
  const outs = (snapshot && snapshot.outputs) || [];
  for (const rx of MIC_CABLE_RX) { const o = outs.find((x) => rx.test(x.name)); if (o) return o; }
  return null;
}
function sameName(a, b) { return a && b && a.replace(/\s*\(.*$/, '').trim().toLowerCase() === b.replace(/\s*\(.*$/, '').trim().toLowerCase(); }
function cableSetup() {
  if (!snapshot) return;
  const m = S().mixer; const mc = S().micChain; const outs = snapshot.outputs; let dirty = false;
  const byName = (name) => (name ? outs.find((o) => o.name === name) || outs.find((o) => sameName(o.name, name)) : null);
  // Saved cable IDs that don't exist here (other PC / reinstalled driver): re-find the same cable by name.
  if (mc.outId && !presentOut(mc.outId)) { const o = byName(mc.outName); if (o) { mc.outId = o.id; dirty = true; } }
  if (m.streamOut && !presentOut(m.streamOut)) { const o = byName(m.streamOutName); if (o) { m.streamOut = o.id; dirty = true; } }
  if (mc.outId && presentOut(mc.outId)) { const n = outs.find((o) => o.id === mc.outId).name; if (mc.outName !== n) { mc.outName = n; dirty = true; } }
  if (m.streamOut && presentOut(m.streamOut)) { const n = outs.find((o) => o.id === m.streamOut).name; if (m.streamOutName !== n) { m.streamOutName = n; dirty = true; } }
  // Fresh setup with a virtual cable already installed: send the mic to it once (the user can change it later).
  if (!mc.autoCable) {
    const cable = findMicCable();
    if (cable) {
      if (!mc.outId && !m.streamOut) { mc.outId = cable.id; mc.outName = cable.name; mc.enabled = true; micPathNote = `Your mic now goes to “${cable.name}”. In Discord / VRChat pick “${recordNameFor(cable)}” as the microphone.`; }
      mc.autoCable = true; dirty = true;
    }
  }
  if (dirty) store.saveSoon();
}
let micPathNote = null;
function recordNameFor(out) {
  if (!out) return null;
  const c = detectCables().find((x) => x.id === out.id); if (c && c.recordName) return c.recordName;
  return out.name.replace(/input/i, 'Output');
}
// Mic reaches the cable through the stream mix already: don't also write it straight in (doubled voice).
function micOutEffective() {
  const m = S().mixer; const mc = S().micChain; const id = presentOut(mc.outId);
  if (micCableMode()) return id; // v2.4.2: mic + streamed apps share the cable; the mic still goes in on its own sink
  if (id && m.streamMode && mc.inStream && presentOut(m.streamOut) === id) return null;
  return id;
}
function micCableMode() { const m = S().mixer; const id = presentOut(S().micChain.outId); return !!(m.streamMode && m.streamVia === 'mic' && id && presentOut(m.streamOut) === id); }
function streamExcludePids() {
  if (!micCableMode() || S().mixer.micCableVoice) return [];
  return visibleSessions().filter((s) => setup.isVoiceApp(s.process)).map((s) => s.pid);
}
function micPath() {
  if (!snapshot) return null;
  const m = S().mixer; const mc = S().micChain; const outs = snapshot.outputs;
  const micKnown = !m.mic.deviceId || snapshot.inputs.some((i) => i.id === m.mic.deviceId);
  const inId = (micKnown && m.mic.deviceId) || snapshot.defaultCommsInput || snapshot.defaultInput || null;
  const inDev = snapshot.inputs.find((i) => i.id === inId);
  const viaStream = !!(m.streamMode && mc.inStream && presentOut(m.streamOut));
  const outId = presentOut(mc.outId) || (viaStream ? m.streamOut : null);
  const out = outs.find((o) => o.id === outId);
  const cable = findMicCable();
  const errs = ((engineState && engineState.errors) || []).concat((engineState && engineState.sourceErrors) || []).filter((e) => /mic out|stream|output|mic:/i.test(e));
  let warn = null;
  if (!inDev) warn = 'no-input';
  else if (mc.outId && !presentOut(mc.outId)) warn = 'out-missing';
  else if (!out) warn = cable ? 'not-routed' : 'no-cable';
  return { input: inDev ? { id: inDev.id, name: inDev.name, fallback: !micKnown || !m.mic.deviceId } : null, processing: !!mc.enabled && !mc.bypass,
    out: out ? { id: out.id, name: out.name, recordName: recordNameFor(out), via: presentOut(mc.outId) ? 'mic' : 'stream' } : null,
    savedOutName: mc.outId && !presentOut(mc.outId) ? (mc.outName || 'a cable that is not on this PC') : null,
    cable: cable ? { id: cable.id, name: cable.name, recordName: recordNameFor(cable) } : null, warn, errors: errs.slice(0, 3), note: micPathNote,
    onStream: !!mc.inStream, streamMode: !!m.streamMode,
    stream: presentOut(m.streamOut) ? { id: m.streamOut, name: (outs.find((o) => o.id === m.streamOut) || {}).name, recordName: recordNameFor(outs.find((o) => o.id === m.streamOut)) } : null,
    // mic cable == stream cable: whatever captures that cable (Streamlabs/OBS) also gets the mic
    shared: !!(m.streamMode && presentOut(mc.outId) && presentOut(mc.outId) === presentOut(m.streamOut)),
    // where the stream mix could go instead: another cable, or an unused output such as S/PDIF that Streamlabs/OBS can capture
    streamTargets: outs.filter((o) => o.id !== presentOut(mc.outId) && o.id !== snapshot.defaultOutput && o.id !== m.personalOut && (CABLE_RX.test(o.name) || /digital|spdif|s\/pdif|line out/i.test(o.name))).map((o) => ({ id: o.id, name: o.name })) };
}
ipcMain.handle('stream:route', (_e, id) => {
  const m = S().mixer; const o = snapshot && snapshot.outputs.find((x) => x.id === id); if (!o) return micPath();
  m.streamOut = o.id; m.streamOutName = o.name; store.saveSoon(); pushEngine(); pushMixer(); return micPath();
});
ipcMain.handle('mic:route', (_e, id) => {
  const mc = S().micChain; const o = snapshot && snapshot.outputs.find((x) => x.id === id);
  mc.outId = o ? o.id : null; mc.outName = o ? o.name : ''; mc.autoCable = true; if (o) mc.enabled = true; micPathNote = null;
  store.saveSoon(); pushEngine(); pushMixer(); return micPath();
});

// ---------------- v2.4.0 first-run setup + self-heal ----------------
function helperLogLine(msg) { try { fs.mkdirSync(path.dirname(helperLog), { recursive: true }); fs.appendFileSync(helperLog, `[${new Date().toISOString()}] ${msg}\n`); } catch {} }
let healState = { fixed: [], missing: [], at: 0 };
const bootAt = Date.now();
async function firstRunSetup(opts = {}) {
  if (!snapshot || !snapshot.outputs) return null;
  const r = setup.autoSetup(S(), snapshot, { full: opts.full !== false });
  const su = S().app.setup; su.auto = true; su.autoAt = Date.now(); su.changes = r.changes; su.summary = r.summary;
  micPathNote = null; seenPids.clear(); store.saveNow();
  helperLogLine('setup: ' + r.changes.join(' | '));
  // Windows' default speakers are a virtual cable (common after installing one): put them back on real speakers.
  const def = snapshot.outputs.find((o) => o.id === snapshot.defaultOutput);
  const spk = S().mixer.listen.deviceId;
  if (def && setup.isVirtualOut(def) && spk && spk !== def.id) await switchListening(spk, 'setup').catch(() => {});
  pushEngine(); send('setup:state', setupState());
  return r;
}
function selfHeal() {
  if (!snapshot) return;
  checkCableRates().catch(() => {});
  const r = setup.heal(S(), snapshot);
  if (r.changed) { store.saveSoon(); pushEngine(); }
  if (r.fixed.length) { helperLogLine('self-heal: ' + r.fixed.join(' | ')); healState.fixed = [...r.fixed, ...healState.fixed].slice(0, 6); healState.at = Date.now(); }
  // Devices still waking up right after startup (Bluetooth, USB) aren't reported as missing for the first 12 s.
  const miss = Date.now() - bootAt > 12000 ? r.missing : [];
  if (JSON.stringify(miss) !== JSON.stringify(healState.missing)) { healState.missing = miss; healState.at = Date.now(); }
}
// v2.4.1: Hi-Fi Cable has no sample-rate converter. If its two sides run at different Windows formats (e.g. Input 48 kHz,
// Output 44.1 kHz) everything through it plays at the wrong speed: 48 -> 44.1 drops the pitch ~8% (a deeper voice).
// Both sides are set to 48 kHz once per mismatch; if Windows refuses, the Mic path shows the manual fix.
const rateState = { pairs: [], error: null, fixedAt: 0 }; const rateTried = new Set();
function hifiPairs(snap) {
  return (snap.outputs || []).filter((o) => /hi-?fi cable input/i.test(o.name)).map((o) => {
    const r = setup.recordSideOf(snap, o); const i = r && r.id ? snap.inputs.find((x) => x.id === r.id) : null;
    const p = { render: { id: o.id, name: o.name, rate: o.rate || null }, capture: i ? { id: i.id, name: i.name, rate: i.rate || null } : null };
    p.ok = !p.capture || !p.render.rate || !p.capture.rate || p.render.rate === p.capture.rate; return p;
  });
}
async function checkCableRates() {
  if (!snapshot || helperStatus.status !== 'running') return;
  rateState.pairs = hifiPairs(snapshot);
  for (const p of rateState.pairs) {
    if (p.ok) continue;
    const key = `${p.render.id}|${p.render.rate}|${p.capture.rate}`; if (rateTried.has(key)) continue; rateTried.add(key);
    const res = [];
    for (const d of [p.render, p.capture]) {
      if (d.rate === 48000) continue;
      const r = await helper.call('setDeviceRate', { deviceId: d.id, rate: 48000 }).catch((e) => ({ ok: false, error: e.message }));
      res.push({ name: d.name, from: d.rate, ok: !!(r && r.ok !== false && r.result && r.result.ok), error: (r && (r.error || (r.result && r.result.hr))) || null });
    }
    helperLogLine('hi-fi cable rates: ' + JSON.stringify({ render: p.render.rate, capture: p.capture.rate, res }));
    if (res.every((x) => x.ok)) {
      rateState.error = null; rateState.fixedAt = Date.now();
      healState.fixed = [`Hi-Fi Cable's two sides were at different sample rates (${p.render.rate / 1000} vs ${p.capture.rate / 1000} kHz), which makes voices sound deeper or higher. Both are now 48 kHz`, ...healState.fixed].slice(0, 6); healState.at = Date.now();
      setTimeout(async () => { await helper.call('engineReset'); helper.call('engineConfig', { config: engineConfig() }); helper.call('refresh'); }, 700);
    } else rateState.error = `Windows didn't let Blur Sounds Pro change the format (${res.filter((x) => !x.ok).map((x) => `${x.name}: ${x.error || 'refused'}`).join('; ')}).`;
    pushMixer();
  }
}
function rateInfo() { const p = rateState.pairs.find((x) => S().micChain.outId && x.render.id === S().micChain.outId) || rateState.pairs[0]; return p ? { ...p, error: p.ok ? null : rateState.error, fixedAt: rateState.fixedAt } : null; }
ipcMain.handle('cable:fixRate', async () => { rateTried.clear(); rateState.error = null; await checkCableRates(); return rateInfo(); });
// v2.4.1: "Reset mic chain" = safe processing defaults. Device picks, the virtual-mic cable, on/off and Mic on stream are kept.
ipcMain.handle('micchain:reset', () => {
  const mc = S().micChain; const d = defaults().micChain;
  const keep = { enabled: mc.enabled, outId: mc.outId, outName: mc.outName, inStream: mc.inStream, aecRef: mc.aec && mc.aec.refId };
  for (const k of Object.keys(d)) mc[k] = JSON.parse(JSON.stringify(d[k]));
  Object.assign(mc, { enabled: keep.enabled, outId: keep.outId, outName: keep.outName, inStream: keep.inStream }); mc.aec.refId = keep.aecRef || null;
  store.saveSoon(); pushEngine(); pushMixer(); return mc;
});
function setupState() {
  const snap = snapshot; const m = S().mixer; const mc = S().micChain;
  if (!snap) return { ready: false, setup: S().app.setup, version: app.getVersion() };
  const outs = snap.outputs; const ins = snap.inputs;
  const cable = presentOut(mc.outId) ? outs.find((o) => o.id === mc.outId) : null;
  const stream = presentOut(m.streamOut) ? outs.find((o) => o.id === m.streamOut) : null;
  return {
    ready: true, version: app.getVersion(), setup: S().app.setup,
    speakers: outs.filter((o) => !setup.isVirtualOut(o)).map((o) => ({ id: o.id, name: o.name, isDefault: o.id === snap.defaultOutput, speakers: setup.looksLikeSpeakers(o) })),
    listen: presentOut(m.listen.deviceId) || (outs.find((o) => o.id === snap.defaultOutput && !setup.isVirtualOut(o)) || {}).id || null,
    mics: ins.map((i) => ({ id: i.id, name: i.name, real: setup.isRealMic(i), isDefault: i.id === snap.defaultInput || i.id === snap.defaultCommsInput })),
    mic: (m.mic.deviceId && ins.some((i) => i.id === m.mic.deviceId)) ? m.mic.deviceId : (snap.defaultCommsInput || snap.defaultInput || null),
    micFallback: !(m.mic.deviceId && ins.some((i) => i.id === m.mic.deviceId)),
    cables: setup.detectAll(snap),
    cable: cable ? { id: cable.id, name: cable.name, record: setup.recordSideOf(snap, cable) } : null,
    suggestedCable: (() => { const c = setup.findMicCable(snap); return c ? { id: c.id, name: c.name, record: setup.recordSideOf(snap, c) } : null; })(),
    streamMode: !!m.streamMode, stream: stream ? { id: stream.id, name: stream.name, record: setup.recordSideOf(snap, stream), cable: setup.isVirtualOut(stream) } : null,
    streamOptions: outs.filter((o) => o.id !== (cable && cable.id) && o.id !== snap.defaultOutput && (setup.isVirtualOut(o) || /digital|spdif|s\/pdif|line out/i.test(o.name)) && !/sonar/i.test(o.name)).map((o) => ({ id: o.id, name: o.name, cable: setup.isVirtualOut(o) })),
    onStream: !!mc.inStream, processing: !!mc.enabled && !mc.bypass, aec: !!(mc.aec && mc.aec.enabled), ns: !!(mc.ns && mc.ns.enabled),
    chatbox: { ip: S().chatbox.ip, port: S().chatbox.port, live: !!S().chatbox.live },
    vrchatRunning: snap.sessions.some((x) => /^vrchat$/i.test(x.process || '')),
    discordRunning: snap.sessions.some((x) => /^discord/i.test(x.process || '')),
    hifi: hifi.detect(snapshot), engineErrors: ((engineState && engineState.errors) || []).slice(0, 3),
    heal: healState, streamInfo: streamInfoFull(),
  };
}
ipcMain.handle('setup:get', () => setupState());
ipcMain.handle('setup:redetect', async () => { await firstRunSetup({ full: !S().app.setup.done }); pushMixer(); return setupState(); });
ipcMain.handle('setup:speakers', async (_e, id) => {
  const o = snapshot && snapshot.outputs.find((x) => x.id === id); if (!o) return { ok: false, error: 'That device is not connected.', state: setupState() };
  const r = await switchListening(id, 'setup'); const L = listenCfg(); L.deviceId = id; L.name = o.name; store.saveSoon();
  return { ...r, ok: r.ok !== false || r.error === 'busy', state: setupState() };
});
ipcMain.handle('setup:mic', (_e, id) => {
  const i = snapshot && snapshot.inputs.find((x) => x.id === id);
  S().mixer.mic.deviceId = i ? i.id : null; S().mixer.mic.name = i ? i.name : '';
  store.saveSoon(); pushEngine(); pushMixer(); return setupState();
});
ipcMain.handle('setup:cable', (_e, id) => {
  const mc = S().micChain; const o = snapshot && snapshot.outputs.find((x) => x.id === id);
  mc.outId = o ? o.id : null; mc.outName = o ? o.name : ''; mc.autoCable = true; if (o) mc.enabled = true;
  if (o && S().mixer.streamOut === o.id) { S().mixer.streamMode = false; S().mixer.streamOut = null; S().mixer.streamOutName = ''; } // never share the mic cable with the stream mix
  store.saveSoon(); pushEngine(); pushMixer(); return setupState();
});
ipcMain.handle('setup:stream', (_e, id) => {
  const m = S().mixer; const o = id && snapshot && snapshot.outputs.find((x) => x.id === id && x.id !== S().micChain.outId);
  m.streamMode = !!o; m.streamOut = o ? o.id : null; m.streamOutName = o ? o.name : '';
  store.saveSoon(); pushEngine(); pushMixer(); return setupState();
});
ipcMain.handle('setup:chatbox', (_e, { live, test }) => {
  if (typeof live === 'boolean') { chatbox.setLive(live); S().chatbox.live = live; store.saveSoon(); refreshTray(); }
  let sent = null;
  if (test) { try { chatbox.osc_('/chatbox/input', [String(test).slice(0, 144), true, false]); sent = { ok: true, at: Date.now() }; } catch (e) { sent = { ok: false, error: e.message }; } }
  return { ...setupState(), sent };
});
ipcMain.handle('setup:finish', (_e, { skipped } = {}) => {
  const su = S().app.setup; su.done = true; su.skipped = !!skipped; su.at = Date.now(); su.version = app.getVersion();
  S().app.hifiPromptDismissed = true; store.saveNow(); pushMixer(); return S();
});
ipcMain.handle('setup:open', (_e, what) => {
  const urls = { discord: 'discord://-/settings/voice', sound: 'ms-settings:sound', mic: 'ms-settings:privacy-microphone', vrcosc: 'https://docs.vrchat.com/docs/osc-overview', hifi: 'https://vb-audio.com/Cable/', obs: 'https://obsproject.com/kb/audio-sources' };
  if (urls[what]) shell.openExternal(urls[what]); return !!urls[what];
});
ipcMain.handle('setup:clipboard', (_e, text) => { require('electron').clipboard.writeText(String(text || '')); return true; });

// ---------------- v2.4.1 stream destination ----------------
function streamInfoFull() {
  if (!snapshot) return null;
  const voiceApps = [...new Set(visibleSessions().filter((s) => setup.isVoiceApp(s.process)).map((s) => s.name || s.process))];
  return { ...setup.streamInfo(S(), snapshot), voiceApps, vbc: vbcStatus(), hifiInstalled: hifi.detect(snapshot).installed, pending: S().mixer.streamPending || null };
}
// via: 'off' | 'desktop' | 'cable' | 'output' (with id)
function setStream({ via, id } = {}) {
  const m = S().mixer; const mc = S().micChain;
  if (via === 'cable' || via === 'output') {
    const o = snapshot && snapshot.outputs.find((x) => x.id === id);
    if (!o) return { ok: false, error: 'That device is not connected.', stream: streamInfoFull() };
    if (o.id === presentOut(mc.outId)) return { ok: false, error: `“${o.name}” is your virtual mic. The stream mix needs a different device, or Discord / VRChat would hear your apps.`, stream: streamInfoFull() };
    if (o.id === snapshot.defaultOutput) return { ok: false, error: `“${o.name}” is what you listen on. Use “Desktop audio” instead.`, stream: streamInfoFull() };
    m.streamMode = true; m.streamVia = setup.isVirtualOut(o) ? 'cable' : 'output'; m.streamOut = o.id; m.streamOutName = o.name;
  } else if (via === 'mic') {
    const id = presentOut(mc.outId); const o = id && snapshot.outputs.find((x) => x.id === id);
    if (!o) return { ok: false, error: 'Your mic isn\'t going to a virtual cable yet. Set up the virtual cable first.', stream: streamInfoFull() };
    m.streamMode = true; m.streamVia = 'mic'; m.streamOut = o.id; m.streamOutName = o.name;
  } else if (via === 'desktop' || via === 'off') { m.streamMode = false; m.streamVia = via; }
  else return { ok: false, error: 'unknown destination', stream: streamInfoFull() };
  store.saveSoon(); seenPids.clear(); pushEngine(); helper.call('refresh'); pushMixer();
  return { ok: true, stream: streamInfoFull() };
}
ipcMain.handle('stream:set', async (_e, o) => setStream(o));
ipcMain.handle('stream:micopts', (_e, o = {}) => { const m = S().mixer; if (typeof o.appsVolume === 'number') m.micCableAppsVolume = Math.max(0, Math.min(1.5, o.appsVolume)); if (typeof o.includeVoice === 'boolean') m.micCableVoice = o.includeVoice; store.saveSoon(); pushEngine(); pushMixer(); return streamInfoFull(); });
// ---- second cable (standard VB-CABLE) for the stream mix: official download at click time, verified, run elevated ----
let vbcState = { phase: 'idle' };
function vbcStatus() { return { ...hifi.detectVb(snapshot), phase: vbcState.phase, step: vbcState.step, pct: vbcState.pct, error: vbcState.error, verified: vbcState.verified, page: hifi.VBC.page, donate: hifi.VBC.donate, version: 'VBCABLE_Driver_Pack46.zip' }; }
function vbcPush(patch) { vbcState = { ...vbcState, ...patch }; send('vbcable:state', vbcStatus()); pushMixer(); }
ipcMain.handle('vbcable:status', () => vbcStatus());
ipcMain.handle('vbcable:install', async (_e, opts = {}) => {
  if (['download', 'verify', 'extract', 'install', 'detect'].includes(vbcState.phase)) return vbcStatus();
  const work = path.join(app.getPath('userData'), 'downloads', 'vb-cable');
  S().mixer.streamPending = 'cable'; store.saveSoon(); // route the stream mix to it as soon as it appears (also after a restart)
  try {
    vbcPush({ phase: 'download', step: 'download', pct: 0, error: null, verified: null });
    const prep = await hifi.prepare(work, (p) => vbcPush({ phase: p.step === 'verified' ? 'verify' : p.step, step: p.step, pct: p.pct ?? vbcState.pct, verified: p.verified || vbcState.verified }), hifi.VBC);
    if (opts.dryRun) { vbcPush({ phase: 'ready', step: 'verified', verified: prep.verified }); return { ...vbcStatus(), exe: prep.exe }; }
    vbcPush({ phase: 'install', step: 'install' });
    const r = await hifi.runInstaller(prep.exe);
    if (!r.ok) { vbcPush({ phase: r.cancelled ? 'cancelled' : 'failed', error: r.error }); return vbcStatus(); }
    vbcPush({ phase: 'detect', step: 'detect' });
    const end = Date.now() + 45000; let ok = false;
    while (Date.now() < end) { helper.call('refresh'); await new Promise((res) => setTimeout(res, 2000)); if (hifi.detectVb(snapshot).installed) { ok = true; break; } }
    if (ok) { selfHeal(); vbcPush({ phase: 'done' }); }
    else { const drv = await hifi.driverInfo(hifi.VBC.pnp); vbcPush({ phase: drv.registered || drv.device ? 'reboot' : 'failed', error: drv.registered || drv.device ? null : `The installer finished (exit ${r.exitCode}) but no VB-CABLE devices appeared. Run it again and click “Install Driver”.` }); }
  } catch (e) { vbcPush({ phase: 'failed', error: e.message }); }
  return vbcStatus();
});
ipcMain.handle('vbcable:restart', () => { require('child_process').execFile('shutdown.exe', ['/r', '/t', '5', '/c', 'Restarting to finish installing VB-Audio VB-CABLE'], { windowsHide: true }); return true; });

function engineConfig() {
  const m = S().mixer; const mc = S().micChain; const c = S().clips; const r = S().record;
  const sessions = visibleSessions();
  // A saved mic that isn't plugged in / doesn't exist on this PC falls back to the Windows default mic (the setting itself is kept).
  const micKnown = !m.mic.deviceId || !snapshot || !snapshot.inputs || snapshot.inputs.some((i) => i.id === m.mic.deviceId);
  const micId = (micKnown && m.mic.deviceId) || (snapshot && (snapshot.defaultCommsInput || snapshot.defaultInput)) || null;
  return {
    streamGain: micCableMode() ? Math.max(0, Math.min(1.5, m.micCableAppsVolume ?? 0.6)) : 1, streamExclude: streamExcludePids(),
    streamMode: !!m.streamMode, personalOut: (m.personalOut && snapshot && snapshot.outputs.some((o) => o.id === m.personalOut)) ? m.personalOut : null, /* unplugged -> Windows default */ streamOut: presentOut(m.streamOut),
    channels: m.channelList.map(({ id }) => {
      const ch = m.channels[id];
      return {
        id, mode: ch.mode === 'cable' && !presentOut(ch.cableId) ? 'direct' : ch.mode, cableId: presentOut(ch.cableId), volume: ch.volume * chatMixFactor(id), muted: ch.muted,
        streamVolume: ch.streamVolume, streamMuted: ch.streamMuted, inClip: ch.inClip, inRec: ch.inRec, eq: ch.eq,
        hear: hearChannel(id), comp: hearChannel(id) ? 1 / HEAR_DUCK : 1, hearOut: presentOut(ch.output) || null,
        pids: sessions.filter((s) => !s.system && channelFor(s) === id).map((s) => s.pid),
      };
    }),
    mic: {
      deviceId: micId, meter: m.mic.meter, chain: mc.enabled, outId: micOutEffective(), gate: mc.gate, ns: { ...mc.ns, modelPath: dfModelPath() }, clearcast: mc.clearcast, comp: mc.comp, eq: mc.eq,
      hpf: mc.hpf, aec: { ...mc.aec, refId: mc.aec && presentOut(mc.aec.refId) ? mc.aec.refId : aecRefDefault() }, bypass: !!mc.bypass, monitor: mc.monitor,
      gainDb: mc.gainDb, muted: false, inStream: micCableMode() ? false : mc.inStream, inClip: c.includeMic, inRec: r.includeMic,
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

ipcMain.handle('mixer:channel', async (_e, ch, patch) => patchChannel(ch, patch));
async function patchChannel(ch, patch) {
  const c = S().mixer.channels[ch]; if (!c) return;
  if (patch.mode === 'cable' && patch.cableId === undefined && !c.cableId) return { ok: false, error: 'pick a cable first' };
  if (isGuarded(patch.cableId) || isGuarded(patch.output)) return { ok: false, error: 'That device carries your stream / virtual mic. Apps on it would always be broadcast, so Blur Sounds Pro blocks it.' };
  const routeChanged = ['output', 'mode', 'cableId'].some((k) => k in patch && patch[k] !== c[k]);
  const wasHear = hearChannel(ch);
  Object.assign(c, patch); store.saveSoon();
  // EQ band / preset edits only need the new filter settings (debounced); no session changes
  if (!routeChanged && Object.keys(patch).every((k) => k === 'eq') && wasHear === hearChannel(ch)) { pushEngine(); return { ok: true }; }
  // EQ on/off changes the path: the engine switches first, then the app's own level follows (turned down only once its
  // capture is confirmed), so there is no gap and at most a moment of doubled audio.
  if (wasHear !== hearChannel(ch)) {
    clearTimeout(engineTimer); await helper.call('engineConfig', { config: engineConfig() });
    if (hearChannel(ch)) { for (const ms of [150, 400, 900]) setTimeout(() => helper.call('engineStatus').then((r) => r && r.ok !== false && onEngineState(r.result)).catch(() => {}), ms); }
  }
  if (routeChanged) await rerouteChannel(ch); else await applyChannel(ch);
  pushEngine(); helper.call('refresh');
  return { ok: true };
}
ipcMain.handle('mixer:get', () => { pushMixer(); return true; });
ipcMain.handle('mixer:global', async (_e, patch) => {
  Object.assign(S().mixer, patch);
  if (patch.streamMode === true && snapshot && !micCableMode()) { const m = S().mixer; const micId = presentOut(S().micChain.outId); if (!presentOut(m.streamOut) || m.streamOut === micId) { const sc = setup.findStreamCable(snapshot, micId); if (sc) { m.streamOut = sc.id; m.streamOutName = sc.name; m.streamVia = 'cable'; } else if (micId) { /* v2.4.2: only one cable -> mic + streamed apps on it */ m.streamOut = micId; m.streamOutName = (snapshot.outputs.find((o) => o.id === micId) || {}).name || ''; m.streamVia = 'mic'; } } }
  if (patch.streamMode === false && S().mixer.streamVia !== 'desktop') S().mixer.streamVia = 'off';
  store.saveSoon();
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
ipcMain.handle('mic:chain', (_e, patch) => { if (patch && 'outId' in patch) { const o = snapshot && snapshot.outputs.find((x) => x.id === patch.outId); patch = { ...patch, outName: o ? o.name : '', autoCable: true }; micPathNote = null; }
  // Turning "Mic on stream" off: if the mic only reached the cable through the stream mix, send it there directly so VRChat / Discord keep hearing it.
  if (patch && patch.inStream === false) { const mc0 = S().micChain; const m0 = S().mixer; const so = presentOut(m0.streamOut); if (!presentOut(mc0.outId) && m0.streamMode && so) { patch = { ...patch, outId: so, outName: (snapshot.outputs.find((o) => o.id === so) || {}).name || '', autoCable: true }; } }
  Object.assign(S().micChain, patch); store.saveSoon(); pushEngine(); pushMixer(); return S().micChain; });
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
helper.on('engine', (d) => onEngineState(d));
function onEngineState(d) {
  if (!d) return;
  engineState = d; send('engine:state', { engine: d, media: media.status() });
  // v2.4.2: (re)apply session levels when the set of captured apps changes, so "EQ what you hear" only ever turns down
  // an app whose audio the engine really has.
  const cap = new Set(Array.isArray(d && d.captured) ? d.captured : []);
  const changed = cap.size !== engineCaptured.size || [...cap].some((p) => !engineCaptured.has(p));
  if (changed) { const was = engineCaptured; engineCaptured = cap; for (const s of visibleSessions()) if (hearChannel(channelFor(s)) && (cap.has(s.pid) !== was.has(s.pid))) applySession(s, true).catch(() => {}); }
}
async function restoreHearSessions() {
  engineCaptured = new Set();
  for (const s of visibleSessions()) if (hearChannel(channelFor(s))) await helper.call('setSessionVolume', { pid: s.pid, volume: normalVolume(s) }).catch(() => {});
}
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
  const mc = S().micChain;
  // v2.4.1: Hi-Fi becomes the stream cable only when the mic already has its own cable; otherwise it is the mic.
  if ((!m.streamOut || !outs.some((o) => o.id === m.streamOut)) && presentOut(mc.outId) && mc.outId !== d.inputId) { m.streamOut = d.inputId; m.streamOutName = d.inputName; m.streamMode = true; m.streamVia = 'cable'; delete m.streamPending; done.push('Stream mix → Hi-Fi Cable Input'); }
  if (!presentOut(mc.outId)) { mc.outId = d.inputId; mc.outName = d.inputName; mc.enabled = true; mc.autoCable = true; done.push('Mic → Hi-Fi Cable Input (pick “' + d.outputName + '” as your mic in Discord / VRChat)'); }
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
// v2.4.2 in-app updater (public GitHub releases, SHA-256 verified; see updater.cjs)
const updater = new Updater({ app, log: (m) => helperLogLine(m), send: (st) => send('update:state', st) });
let updateResult = null;
// Update self-test (only with a separate BSP_PROFILE_DIR): no audio engine, checks the feed and runs the update once.
const UPDATE_SELFTEST = !!(process.env.BSP_PROFILE_DIR && process.env.BSP_SELFTEST_UPDATE);
async function updateSelfTest() {
  const dir = path.join(app.getPath('userData'), 'logs'); fs.mkdirSync(dir, { recursive: true });
  const flag = path.join(dir, 'update-selftest-ran'); const rep = { version: app.getVersion(), at: new Date().toISOString(), result: updateResult };
  if (fs.existsSync(flag)) { rep.note = 'already ran'; fs.writeFileSync(path.join(dir, 'update-selftest-' + app.getVersion() + '.json'), JSON.stringify(rep, null, 2)); return; }
  fs.writeFileSync(flag, '1');
  rep.check = await updater.check(); rep.check = { status: rep.check.status, latest: rep.check.latest, asset: rep.check.asset && rep.check.asset.name, error: rep.check.error };
  if (updater.state.status === 'available') { const d = await updater.download(); rep.download = { status: d.status, sha: d.sha, error: d.error }; if (d.status === 'ready') rep.install = updater.install(); }
  fs.writeFileSync(path.join(dir, 'update-selftest-' + app.getVersion() + '.json'), JSON.stringify(rep, null, 2));
  if (rep.install && rep.install.ok) setTimeout(() => { quitting = true; app.quit(); }, 400);
}
ipcMain.handle('update:get', () => ({ ...updater.state, result: updateResult }));
ipcMain.handle('update:check', () => updater.check());
ipcMain.handle('update:run', async () => {
  if (updater.state.status !== 'ready') { const st = await updater.download(); if (st.status !== 'ready') return st; }
  const r = updater.install(); if (!r.ok) return updater.set({ status: 'error', error: r.error });
  setTimeout(() => { quitting = true; app.quit(); }, 400);
  return updater.state;
});
ipcMain.handle('update:dismissResult', () => { updateResult = null; return true; });
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
  win.webContents.once('did-finish-load', () => {
    updateResult = updater.markHealthy(); // tells a waiting updater the new version started
    if (updateResult) send('update:state', { ...updater.state, result: updateResult });
    if (UPDATE_SELFTEST) setTimeout(() => updateSelfTest().catch((e) => helperLogLine('update selftest: ' + e.stack)), 3000);
    else if (S().app.autoUpdateCheck !== false) setTimeout(() => updater.check({ quiet: true }).catch(() => {}), 8000);
  });
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
// v2.4.0 self-test of the first-run setup (only with a separate BSP_PROFILE_DIR, never on real settings):
// waits for the auto-setup, optionally picks a mic by name (BSP_SELFTEST_MIC), measures the mic path for 8 s,
// sends a chatbox test, walks every wizard step (screenshot + check state) and writes logs/setup-selftest.json.
async function setupSelfTest() {
  const dir = path.join(app.getPath('userData'), 'logs'); fs.mkdirSync(dir, { recursive: true });
  const rep = { startedAt: new Date().toISOString(), version: app.getVersion(), steps: [] };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let k = 0; k < 60 && !(snapshot && S().app.setup.auto); k++) await wait(500);
  rep.autoSetup = S().app.setup;
  if (process.env.BSP_SELFTEST_MIC) { const i = snapshot.inputs.find((x) => x.name.toLowerCase().includes(process.env.BSP_SELFTEST_MIC.toLowerCase()) && setup.isRealMic(x)); if (i) { S().mixer.mic.deviceId = i.id; S().mixer.mic.name = i.name; pushEngine(); rep.pickedMic = i.name; } }
  await wait(4000);
  const pk = { micPre: 0, micPost: 0, micOutPk: 0, frames: 0 };
  const onLv = (d) => { const e = d.engine || {}; pk.frames++; for (const k of ['micPre', 'micPost', 'micOutPk']) pk[k] = Math.max(pk[k], e[k] > 0 ? e[k] : 0); };
  helper.on('levels', onLv); await wait(8000); helper.off ? helper.off('levels', onLv) : helper.removeListener('levels', onLv);
  rep.levels8s = Object.fromEntries(Object.entries(pk).map(([k, v]) => [k, k === 'frames' ? v : (v > 0 ? +(20 * Math.log10(v)).toFixed(1) : null)]));
  if (process.env.BSP_SELFTEST_CHAT) { try { chatbox.osc_('/chatbox/input', ['Blur Sounds Pro setup self-test', true, false]); rep.chatboxTest = 'sent to ' + S().chatbox.ip + ':' + S().chatbox.port; } catch (e) { rep.chatboxTest = 'error ' + e.message; } }
  rep.state = setupState(); rep.engineErrors = (engineState && engineState.errors) || [];
  for (let k = 0; k < 8; k++) {
    try {
      await win.webContents.executeJavaScript(`(() => { const b = document.querySelectorAll('.sw-step')[${k}]; if (b) b.click(); return !!b; })()`);
      await wait(k === 0 ? 1500 : 900);
      const info = await win.webContents.executeJavaScript(`({ title: document.querySelector('.sw-title')?.textContent, checks: [...document.querySelectorAll('.sw-check')].map((c) => c.className.replace('sw-check ', '') + ': ' + c.textContent.slice(0, 160)), summary: [...document.querySelectorAll('.sw-sum')].map((c) => c.className.replace('sw-sum ', '') + ': ' + c.textContent) })`);
      rep.steps.push(info);
      const img = await Promise.race([win.webContents.capturePage(), wait(6000).then(() => null)]); if (img) fs.writeFileSync(path.join(dir, `selftest-step${k}.png`), img.toPNG()); else info.screenshot = 'timed out';
    } catch (e) { rep.steps.push({ error: e.message }); }
    fs.writeFileSync(path.join(dir, 'setup-selftest.json'), JSON.stringify(rep, null, 2));
  }
  if (process.env.BSP_SELFTEST_FINISH) { await win.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('.sw-nav .primary-btn')].pop(); if (b) b.click(); return !!b; })()`); await wait(1500); rep.afterFinish = { setup: S().app.setup, wizardOpen: await win.webContents.executeJavaScript(`!!document.querySelector('.sw')`) }; }
  rep.streamAfterSetup = streamInfoFull(); rep.cableRate = rateInfo(); rep.healFixed = healState.fixed;
  // Optional stream-mix proof: BSP_SELFTEST_STREAM=<unused output name>. Peaks of the stream mix with the channels on stream, then all muted on stream, then restored.
  if (process.env.BSP_SELFTEST_STREAM) {
    const o = snapshot.outputs.find((x) => x.name.toLowerCase().includes(process.env.BSP_SELFTEST_STREAM.toLowerCase()));
    const measure = async (ms) => { const q = { streamPk: 0, master: 0, frames: 0 }; const f = (d) => { const e = d.engine || {}; q.frames++; q.streamPk = Math.max(q.streamPk, e.streamPk > 0 ? e.streamPk : 0); q.master = Math.max(q.master, d.master || 0); };
      helper.on('levels', f); await wait(ms); helper.off ? helper.off('levels', f) : helper.removeListener('levels', f); return Object.fromEntries(Object.entries(q).map(([k, v]) => [k, k === 'frames' ? v : (v > 0 ? +(20 * Math.log10(v)).toFixed(1) : null)])); };
    const t = rep.streamTest = { device: o && o.name, set: o ? setStream({ via: o.id === snapshot.defaultOutput ? 'desktop' : 'output', id: o.id }).ok : false };
    await wait(3000); t.info = streamInfoFull(); t.broadcastOn = await measure(6000);
    const ch = S().mixer.channels; const prev = Object.fromEntries(Object.entries(ch).map(([k, c]) => [k, c.streamMuted]));
    for (const c of Object.values(ch)) c.streamMuted = true; pushEngine(); await wait(1500); t.allMutedOnStream = await measure(6000);
    for (const [k, v] of Object.entries(prev)) ch[k].streamMuted = v; pushEngine(); await wait(1500); t.restored = await measure(5000);
    const img = await Promise.race([win.webContents.capturePage(), wait(6000).then(() => null)]); if (img) fs.writeFileSync(path.join(dir, 'selftest-stream.png'), img.toPNG());
  }
  store.saveNow(); fs.writeFileSync(path.join(dir, 'setup-selftest.json'), JSON.stringify(rep, null, 2));
}
// v2.4.2 EQ self-test (test profiles only): switches one channel's EQ through off / flat / +6 dB @ 1 kHz / flat / off,
// 6 s each, and logs when each phase started so an external meter can be lined up with it.
async function eqSelfTest(id) {
  const dir = path.join(app.getPath('userData'), 'logs'); fs.mkdirSync(dir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const rep = { channel: id, phases: [] };
  const base = () => JSON.parse(JSON.stringify(S().mixer.channels[id].eq));
  const flat = (on) => ({ ...base(), enabled: on, preset: 'flat', preampDb: 0, bands: base().bands.map((b) => ({ ...b, g: 0 })) });
  const boost = () => { const e = flat(true); e.preset = 'custom'; e.bands[3] = { ...e.bands[3], f: 1000, q: 1, g: 6, on: true }; return e; };
  await wait(4000);
  for (const [name, eq] of [['off', flat(false)], ['flat', flat(true)], ['peak 1 kHz +6 dB', boost()], ['flat again', flat(true)], ['off again', flat(false)]]) {
    await patchChannel(id, { eq }); rep.phases.push({ name, at: new Date().toISOString() }); fs.writeFileSync(path.join(dir, 'eq-selftest.json'), JSON.stringify(rep, null, 2));
    await wait(6000); rep.phases[rep.phases.length - 1].captured = [...engineCaptured]; rep.phases[rep.phases.length - 1].hearError = engineState && engineState.hearError;
  }
  rep.done = new Date().toISOString(); fs.writeFileSync(path.join(dir, 'eq-selftest.json'), JSON.stringify(rep, null, 2));
}
app.whenReady().then(() => {
  // Allow device labels for the soundboard output picker.
  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(true));
  if (!S().app.importedMagicChatbox) { try { importMagicChatbox(S()); store.saveNow(); } catch {} }
  createWindow(); createTray(); if (!UPDATE_SELFTEST) helper.start(); media.syncRing();
  runListenArg(listenArg(process.argv));
  if (process.env.BSP_SELFTEST_EQ && process.env.BSP_PROFILE_DIR) win.webContents.once('did-finish-load', () => setTimeout(() => eqSelfTest(process.env.BSP_SELFTEST_EQ).catch((e) => helperLogLine('eq selftest: ' + e.stack)), 2000));
  if (process.argv.includes('--setup-selftest') && process.env.BSP_PROFILE_DIR) win.webContents.once('did-finish-load', () => setTimeout(() => setupSelfTest().catch((e) => { try { fs.writeFileSync(path.join(app.getPath('userData'), 'logs', 'setup-selftest.json'), JSON.stringify({ error: e.stack })); } catch {} }), 1500));
});
let hearRestored = false;
app.on('before-quit', (ev) => {
  if (!hearRestored && helperStatus.status === 'running' && S().mixer.channelList.some(({ id }) => hearChannel(id))) {
    ev.preventDefault(); hearRestored = true;
    Promise.race([restoreHearSessions(), new Promise((r) => setTimeout(r, 1500))]).finally(() => app.quit()); return;
  }
  quitting = true; try { if (S().chatbox.live) chatbox.setLive(false); } catch {} store.saveNow(); media.shutdown(); helper.stop(); globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => app.quit());
