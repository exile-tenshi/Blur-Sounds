// v2.4.0 first-run setup + startup self-heal.
// Everything here works on device *names* and on what Windows reports on THIS PC; no device IDs are ever
// carried between PCs. Pure functions over (settings, snapshot) so they can be unit tested without Windows.
const ANY_VIRTUAL_OUT = /(cable|vb-audio|voicemeeter|steelseries sonar|blur ?sounds)/i;
// Render endpoints that make a good "virtual microphone": the mic goes in here, Discord / VRChat record the paired "… Output".
const MIC_CABLE_RX = [/hi-?fi cable input/i, /^cable input\b/i, /^cable-[a-d] input/i, /voicemeeter (aux |vaio3 )?input/i, /voicemeeter input/i];
// A second cable for the stream mix (Streamlabs / OBS capture its "… Output"). Sonar is never used: it belongs to SteelSeries GG.
const STREAM_CABLE_RX = [/^cable input\b/i, /^cable-[a-d] input/i, /voicemeeter (aux |vaio3 )?input/i, /voicemeeter input/i, /hi-?fi cable input/i];
// Recording endpoints that are NOT a real microphone (loopbacks / other side of a cable / Sonar's own processed mic).
const NOT_A_MIC = /(cable output|cable-[a-d] output|hi-?fi cable|vb-audio|voicemeeter|steelseries sonar|stereo mix|what u hear|wave out|loopback|blur ?sounds)/i;
const SPEAKERS_RX = /(speaker|lautsprecher|monitor|display audio|hdmi|tv\b|realtek.*\b(audio|speakers)\b)/i;
const HEADPHONES_RX = /(headphone|headset|earphone|earbud|airpods|buds|arctis|hyperx|g\d{3,4}\b|vive|index|quest|oculus|virtual audio device)/i;

const strip = (n) => String(n || '').replace(/\s*\(.*$/, '').trim().toLowerCase();
const inside = (n) => (/\(([^)]*)\)/.exec(String(n || '')) || [])[1] || '';
const sameName = (a, b) => !!a && !!b && (a === b || (strip(a) === strip(b) && inside(a).toLowerCase() === inside(b).toLowerCase()));

function isVirtualOut(o) { return !!o && ANY_VIRTUAL_OUT.test(o.name); }
function isRealMic(i) { return !!i && !NOT_A_MIC.test(i.name); }
function present(list, id) { return !!id && (list || []).some((x) => x.id === id); }

function pickSpeakers(snap) {
  const outs = snap.outputs || [];
  const def = outs.find((o) => o.id === snap.defaultOutput);
  if (def && !isVirtualOut(def)) return def;
  return outs.find((o) => !isVirtualOut(o) && HEADPHONES_RX.test(o.name)) || outs.find((o) => !isVirtualOut(o)) || null;
}
function rankMic(i) { let s = 0; if (/microphone|mic\b|mikrofon/i.test(i.name)) s += 2; if (/headset|usb|yeti|fifine|hyperx|blue|rode|shure|elgato/i.test(i.name)) s += 1; if (/line in|aux/i.test(i.name)) s -= 2; return s; }
function pickMic(snap) {
  const ins = snap.inputs || [];
  for (const id of [snap.defaultCommsInput, snap.defaultInput]) { const i = ins.find((x) => x.id === id); if (i && isRealMic(i)) return i; }
  return ins.filter(isRealMic).sort((a, b) => rankMic(b) - rankMic(a))[0] || null;
}
function findMicCable(snap) {
  const outs = snap.outputs || [];
  for (const rx of MIC_CABLE_RX) { const o = outs.find((x) => rx.test(x.name)); if (o) return o; }
  return null;
}
function findStreamCable(snap, notId) {
  const outs = (snap.outputs || []).filter((o) => o.id !== notId && !/sonar/i.test(o.name));
  for (const rx of STREAM_CABLE_RX) { const o = outs.find((x) => rx.test(x.name)); if (o) return o; }
  return null;
}
// "Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)" -> the recording device other apps pick: "Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)"
function recordSideOf(snap, out) {
  if (!out) return null;
  const base = strip(out.name).replace(/input/, '').trim(); const hw = inside(out.name);
  const i = (snap.inputs || []).find((x) => x.name !== out.name && strip(x.name).replace(/output/, '').trim() === base && inside(x.name) === hw);
  return i ? { id: i.id, name: i.name } : { id: null, name: out.name.replace(/input/i, 'Output') };
}
function detectAll(snap) {
  const outs = snap.outputs || [];
  return outs.filter(isVirtualOut).map((o) => ({ id: o.id, name: o.name, sonar: /sonar/i.test(o.name), micCapable: MIC_CABLE_RX.some((rx) => rx.test(o.name)), record: recordSideOf(snap, o) }));
}
function looksLikeSpeakers(o) { return !!o && SPEAKERS_RX.test(o.name) && !HEADPHONES_RX.test(o.name); }

const KNOWN = {
  game: /^(vrchat|vrserver|vrmonitor|vrwebhelper|steam|cs2|csgo|valorant|valorant-win64-shipping|fortniteclient-win64-shipping|r5apex|cod|overwatch|rocketleague|gta5|minecraft|javaw|robloxplayerbeta|eldenring|leagueclient|league of legends|dota2|tslgame|destiny2|beatsaber|vrchatlauncher)$/i,
  chat: /^(discord|discordptb|discordcanary|teams|ms-teams|zoom|ts3client_win64|teamspeak|mumble|skype|slack|whatsapp|telegram|signal|guilded|element)$/i,
  media: /^(spotify|chrome|msedge|firefox|brave|opera|vivaldi|vlc|music\.ui|applemusic|itunes|foobar2000|youtubemusic|tidal|deezer|mpc-hc64|mpv|potplayermini64|plex|netflix|wmplayer|microsoft\.media\.player|nocturne)$/i,
};
function guessChannel(s) {
  const p = String(s.process || '').toLowerCase();
  if (/(wallpaper|webhelper|crashhandler|overlay|launcher|updater|helper)/i.test(p)) return null; // tools that live next to games, not games
  for (const [ch, rx] of Object.entries(KNOWN)) if (rx.test(p)) return ch;
  if (s.path && /(steamapps\\common|epic games|riot games|\\games\\|ubisoft|ea games|battle\.net|gog galaxy\\games)/i.test(s.path)) return 'game';
  return null; // unknown: stays in Aux (follows the Windows default device; nothing gets routed anywhere silent)
}

// First launch on a PC (or "Detect again" in the wizard). full=true also resets the mic chain + routing to safe defaults.
function autoSetup(st, snap, { full = true } = {}) {
  const m = st.mixer; const mc = st.micChain; const changes = []; const sum = {};
  const spk = pickSpeakers(snap);
  if (spk) { m.listen = { ...(m.listen || {}), deviceId: spk.id, name: spk.name, presets: (m.listen && m.listen.presets) || [] }; changes.push(`Listening on “${spk.name}”`); sum.speakers = spk.name; }
  if (full) { m.personalOut = null; m.personalOutName = ''; m.master = { deviceId: null }; } // “You hear” follows the Windows default
  const mic = pickMic(snap);
  m.mic = { ...(m.mic || {}), deviceId: mic ? mic.id : null, name: mic ? mic.name : '', meter: true };
  changes.push(mic ? `Microphone “${mic.name}”` : 'No microphone found (uses the Windows default when one appears)'); sum.mic = mic ? mic.name : null;
  const cable = findMicCable(snap);
  mc.outId = cable ? cable.id : null; mc.outName = cable ? cable.name : ''; mc.autoCable = true; mc.inStream = false;
  if (full || cable) mc.enabled = true;
  sum.cable = cable ? cable.name : null; sum.recordName = cable ? recordSideOf(snap, cable).name : null;
  changes.push(cable ? `Mic → “${cable.name}” (pick “${sum.recordName}” as the mic in Discord / VRChat)` : 'No virtual cable yet (install Hi-Fi Cable to use the processed mic in Discord / VRChat)');
  const sc = findStreamCable(snap, cable && cable.id);
  if (sc) { m.streamMode = true; m.streamOut = sc.id; m.streamOutName = sc.name; sum.stream = sc.name; sum.streamRecord = recordSideOf(snap, sc).name; changes.push(`Stream mix → “${sc.name}” (no mic)`); }
  else if (full || !present(snap.outputs, m.streamOut) || m.streamOut === mc.outId) { m.streamMode = false; m.streamOut = null; m.streamOutName = ''; sum.stream = null; changes.push('Stream mix off (no second cable)'); }
  if (full) {
    Object.assign(mc, {
      gainDb: 0, clearcast: false, bypass: false,
      gate: { enabled: true, thresholdDb: -55, holdMs: 200, releaseMs: 150, attackMs: 2, rangeDb: -40 },
      ns: { enabled: true, amount: 0.85, engine: 'rnnoise' },
      hpf: { enabled: true, freq: 80 },
      monitor: { enabled: false, volume: 0.8 },
      comp: { enabled: true, thresholdDb: -20, ratio: 3, makeupDb: 4, attackMs: 5, releaseMs: 120 },
    });
    // Echo cancellation only when there is something to cancel: you listen on speakers (headphones don't leak into the mic).
    const aecOn = looksLikeSpeakers(spk);
    mc.aec = { enabled: aecOn, refId: null, strength: 'strong' };
    changes.push(aecOn ? 'Echo cancellation on (you listen on speakers)' : 'Echo cancellation off (headphones / no speakers)');
    sum.aec = aecOn;
    for (const c of m.channelList || []) { const ch = m.channels[c.id]; if (ch) Object.assign(ch, { output: null, outputName: '', mode: 'direct', cableId: null, cableName: '' }); }
    if (st.chatbox) { st.chatbox.ip = '127.0.0.1'; st.chatbox.port = 9000; st.chatbox.live = false; }
    if (st.clips) { st.clips.systemDevice = null; st.clips.audioSource = 'auto'; }
    if (st.soundboard) st.soundboard.outputLabel = '';
  }
  // Running apps -> sensible channels (volume / stream mix only; every channel follows the Windows default device).
  const placed = [];
  for (const s of snap.sessions || []) {
    if (s.system) continue; const p = String(s.process || '').toLowerCase(); if (!p || m.assignments[p]) continue;
    const ch = guessChannel(s); if (ch && m.channels[ch]) { m.assignments[p] = ch; placed.push(`${s.process} → ${ch}`); }
  }
  if (placed.length) changes.push('Apps: ' + placed.join(', '));
  sum.apps = placed;
  return { changes, summary: sum };
}

// Every startup / device change: remember device names; if a saved device is gone, find it again by name (silent fix),
// otherwise report it (the engine and routing already fall back to the Windows default while it's missing).
function heal(st, snap) {
  const m = st.mixer; const mc = st.micChain; const outs = snap.outputs || []; const ins = snap.inputs || [];
  const fixed = []; const missing = []; let changed = false;
  const find = (list, name) => list.find((o) => o.name === name) || list.find((o) => sameName(o.name, name));
  const slot = (obj, idKey, nameKey, list, label, opts = {}) => {
    if (!obj) return; const id = obj[idKey]; if (!id) return;
    const here = list.find((o) => o.id === id);
    if (here) { if (obj[nameKey] !== here.name) { obj[nameKey] = here.name; changed = true; } return; }
    const name = obj[nameKey]; const o = name && find(list, name);
    if (o && !(opts.notVirtual && isVirtualOut(o))) { obj[idKey] = o.id; obj[nameKey] = o.name; changed = true; fixed.push(`${label}: found “${o.name}” again`); }
    else missing.push({ what: label, name: name || 'a device that is not on this PC', fallback: opts.fallback || 'Windows default' });
  };
  slot(m.mic, 'deviceId', 'name', ins, 'Microphone', { fallback: 'the Windows default mic' });
  slot(m.listen, 'deviceId', 'name', outs, 'Listening device', { notVirtual: true, fallback: 'the Windows default speakers' });
  slot(m, 'personalOut', 'personalOutName', outs, '“You hear” mix', { notVirtual: true });
  slot(mc, 'outId', 'outName', outs, 'Virtual mic cable', { fallback: 'nothing (install / pick a cable)' });
  slot(m, 'streamOut', 'streamOutName', outs, 'Stream mix', { fallback: 'nothing' });
  if (mc.aec) slot(mc.aec, 'refId', 'refName', outs, 'Echo-cancel reference', { fallback: 'automatic' });
  for (const c of m.channelList || []) {
    const ch = m.channels[c.id]; if (!ch) continue;
    slot(ch, 'output', 'outputName', outs, `${c.label} channel`, { fallback: 'the Windows default speakers' });
    if (ch.mode === 'cable') slot(ch, 'cableId', 'cableName', outs, `${c.label} cable`, { fallback: 'the Windows default speakers' });
  }
  return { changed, fixed, missing };
}

module.exports = { autoSetup, heal, pickSpeakers, pickMic, findMicCable, findStreamCable, recordSideOf, detectAll, isVirtualOut, isRealMic, guessChannel, looksLikeSpeakers, sameName, MIC_CABLE_RX };
