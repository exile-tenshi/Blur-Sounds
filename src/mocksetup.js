// Browser-only preview of the v2.4.0 setup wizard (screenshots). Generic devices, no real PC data.
// ?setup=1 opens it, &step=N jumps to a step, &cable=none simulates a PC without a virtual cable.
export function mockSetup() {
  const qp = new URLSearchParams(location.search); const noCable = qp.get('cable') === 'none';
  if (qp.get('step')) window.__bspSetupStep = Number(qp.get('step'));
  const cable = { id: 'c1', name: 'Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)', record: { id: 'r1', name: 'Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)' } };
  const s = {
    ready: true, version: '2.4.0',
    setup: { done: false, auto: true, changes: noCable
      ? ['Listening on “Speakers (Realtek(R) Audio)”', 'Microphone “Microphone (USB Microphone)”', 'No virtual cable yet (install Hi-Fi Cable to use the processed mic in Discord / VRChat)', 'Stream mix off (no second cable)', 'Echo cancellation on (you listen on speakers)']
      : ['Listening on “Headphones (USB Gaming Headset)”', 'Microphone “Microphone (USB Microphone)”', 'Mic → “Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)” (pick “Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)” as the mic in Discord / VRChat)', 'Stream mix → “CABLE Input (VB-Audio Virtual Cable)” (no mic)', 'Echo cancellation off (headphones / no speakers)', 'Apps: Game.exe → game'] },
    speakers: noCable ? [{ id: 'o1', name: 'Speakers (Realtek(R) Audio)', isDefault: true, speakers: true }]
      : [{ id: 'o1', name: 'Headphones (USB Gaming Headset)', isDefault: true }, { id: 'o2', name: 'Speakers (Realtek(R) Audio)', speakers: true }, { id: 'o3', name: 'LG TV (NVIDIA High Definition Audio)' }],
    listen: 'o1',
    mics: [{ id: 'i1', name: 'Microphone (USB Microphone)', real: true, isDefault: true }, { id: 'i2', name: 'Headset Microphone (USB Gaming Headset)', real: true }, { id: 'r1', name: 'Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)', real: false }],
    mic: 'i1', micFallback: false,
    cables: noCable ? [] : [{ id: 'c1', name: cable.name, micCapable: true, record: cable.record }, { id: 'c2', name: 'CABLE Input (VB-Audio Virtual Cable)', micCapable: true, record: { id: 'r2', name: 'CABLE Output (VB-Audio Virtual Cable)' } }],
    cable: noCable ? null : cable, suggestedCable: noCable ? null : cable,
    streamMode: !noCable, stream: noCable ? null : { id: 'c2', name: 'CABLE Input (VB-Audio Virtual Cable)', record: { id: 'r2', name: 'CABLE Output (VB-Audio Virtual Cable)' }, cable: true },
    streamOptions: noCable ? [] : [{ id: 'c2', name: 'CABLE Input (VB-Audio Virtual Cable)', cable: true }, { id: 'o4', name: 'Realtek Digital Output (Realtek(R) Audio)', cable: false }],
    onStream: false, processing: true, aec: noCable, ns: true, chatbox: { ip: '127.0.0.1', port: 9000, live: false }, vrchatRunning: true, discordRunning: true, hifi: { installed: !noCable }, engineErrors: [], heal: { fixed: [], missing: [] }, streamInfo: mockStream(),
  };
  return async (ch, a) => {
    if (ch === 'setup:get' || ch === 'setup:redetect') return s;
    if (ch === 'setup:speakers') { s.listen = a; return { ok: true, state: s }; }
    if (ch === 'setup:mic') { s.mic = a; return s; }
    if (ch === 'setup:stream') { s.streamMode = !!a; return s; }
    if (ch === 'setup:chatbox') { if (a && typeof a.live === 'boolean') s.chatbox.live = a.live; return { ...s, sent: a && a.test ? { ok: true } : null }; }
    return true;
  };
}

// v2.4.1 stream destination preview: ?stream=desktop|unset|none|cable|output
export function mockStream() {
  const v = new URLSearchParams(location.search).get('stream') || 'desktop';
  const base = { streamMode: ['none', 'cable', 'output'].includes(v), onStream: false, broadcastOn: ['Game', 'Chat', 'Media', 'Aux'], desktop: 'Headphones (USB Gaming Headset)',
    micRecord: 'Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)', micCable: 'Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)', secondCable: v === 'cable' ? { id: 'c2', name: 'CABLE Input (VB-Audio Virtual Cable)', record: 'CABLE Output (VB-Audio Virtual Cable)' } : null,
    options: v === 'cable' ? [{ id: 'c2', name: 'CABLE Input (VB-Audio Virtual Cable)', cable: true, record: 'CABLE Output (VB-Audio Virtual Cable)' }] : [{ id: 'o4', name: 'Realtek Digital Output (Realtek(R) Audio)', cable: false }],
    vbc: { installed: v === 'cable', phase: 'idle' }, hifiInstalled: true, pending: null, warn: null, dest: null };
  base.micOption = { id: 'c1', name: 'Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)', record: 'Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)' }; base.appsVolume = 0.6; base.includeVoice = false; base.voiceApps = ['Discord', 'VRChat'];
  if (v === 'mic') return { ...base, via: 'mic', streamMode: true, dest: { id: 'c1', name: 'Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)', cable: true, record: 'Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)' }, broadcastOn: ['Game', 'Media'] };
  if (v === 'desktop') return { ...base, via: 'desktop' };
  if (v === 'unset') return { ...base, via: 'unset', warn: 'unset' };
  if (v === 'none') return { ...base, via: 'none', warn: 'no-destination', savedName: null };
  if (v === 'cable') return { ...base, via: 'cable', dest: { id: 'c2', name: 'CABLE Input (VB-Audio Virtual Cable)', cable: true, record: 'CABLE Output (VB-Audio Virtual Cable)' }, broadcastOn: ['Game', 'Media'] };
  return { ...base, via: 'output', dest: { id: 'o4', name: 'Realtek Digital Output (Realtek(R) Audio)', cable: false, record: null } };
}

// v2.4.1 Hi-Fi Cable rate preview: ?rate=mismatch
export function mockRate() {
  const bad = new URLSearchParams(location.search).get('rate') === 'mismatch';
  return { render: { id: 'c1', name: 'Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)', rate: 48000 }, capture: { id: 'c1o', name: 'Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)', rate: bad ? 44100 : 48000 }, ok: !bad, error: null };
}

// v2.4.2 updater mock: ?update=available|current|offline|ratelimit|downloading
export function mockUpdate() {
  const q = new URLSearchParams(location.search).get('update') || 'current';
  const notes = '## Blur Sounds Pro 2.4.2\n\n- **EQ you can hear**: channel EQ now changes what you hear, live.\n- EQ presets: Flat, Bass boost, Vocal clarity, Footsteps / FPS, Treble, plus Reset.\n- Streaming with only Hi-Fi Cable: mic + streamed apps on the mic cable.\n- In-app updates from GitHub (this button).';
  const base = { current: '2.4.1', latest: '2.4.2', notes, url: 'https://github.com/exile-tenshi/Blur-Sounds/releases/latest', checkedAt: Date.now() };
  const st = q === 'available' ? { ...base, status: 'available' } : q === 'downloading' ? { ...base, status: 'downloading', progress: 0.42 }
    : q === 'offline' ? { ...base, status: 'error', error: "Couldn't reach GitHub. Check your internet connection and try again." }
    : q === 'ratelimit' ? { ...base, status: 'error', error: "GitHub's update check limit was reached for now. Try again after 5:42 PM." } : { ...base, current: '2.4.2', status: 'current' };
  return (ch) => (ch === 'update:get' || ch === 'update:check' ? st : ch === 'update:run' ? { ...st, status: 'downloading', progress: 0.1 } : true);
}

// v2.5.0 voice changer mock: ?vc=running|download|off|dsp
export function mockVc() {
  const q = new URLSearchParams(location.search).get('vc') || 'running';
  const F = { contentvec: 377711777, rmvpe: 361688443, lyra: 112559689, lyraSpk: 111616, vctk: 112559689, vctkSpk: 111616 };
  const L = { contentvec: 'ContentVec speech features', rmvpe: 'RMVPE pitch tracker', lyra: 'Lyra voice', lyraSpk: 'Lyra voice (speaker table)', vctk: 'Studio voice pack', vctkSpk: 'Studio voice pack (speaker table)' };
  const have = q === 'download' ? [] : Object.keys(F);
  const files = Object.fromEntries(Object.keys(F).map((k) => [k, { label: L[k], size: F[k], present: have.includes(k) }]));
  const V = [['lyra', 'Lyra', 'female', 'Warm, clear female voice. Most natural for male → female.', ['lyra', 'lyraSpk'], 'lyra'], ['ava', 'Ava', 'female', 'Bright, young female voice.', ['vctk', 'vctkSpk'], 'vctk'], ['nova', 'Nova', 'female', 'Soft, smooth female voice.', ['vctk', 'vctkSpk'], 'vctk'], ['mia', 'Mia', 'female', 'Lighter, airy female voice.', ['vctk', 'vctkSpk'], 'vctk'], ['rowan', 'Rowan', 'male', 'Natural, full male voice. Most natural for female → male.', ['vctk', 'vctkSpk'], 'vctk'], ['ezra', 'Ezra', 'male', 'Deeper, calm male voice.', ['vctk', 'vctkSpk'], 'vctk'], ['silas', 'Silas', 'male', 'Lighter male voice.', ['vctk', 'vctkSpk'], 'vctk']];
  const voices = V.map(([id, name, gender, desc, fl, model]) => ({ id, name, gender, desc, files: fl, model, ready: fl.concat(['contentvec', 'rmvpe']).every((k) => have.includes(k)), source: id === 'lyra' ? 'RVC v2 voice trained on LibriSpeech speaker 8312 (public-domain LibriVox reading, LibriSpeech CC BY 4.0); model by KoeAI (MIT).' : 'RVC v2 base model speaker (VCTK corpus, CC BY 4.0); RVC project (MIT).' }));
  let settings = { enabled: q !== 'off', engine: q === 'dsp' ? 'dsp' : 'ai', voice: 'lyra', preset: 'm2f', bypass: false, hotkey: 'Ctrl+Alt+V', pitch: 0, autoPitch: true, targetHz: 205, quality: 'balanced', device: 'gpu', f0: 'auto', expressive: 1, envMix: 0.35, blendWith: null, blend: 0, dsp: { pitch: 11, formant: 17, targetHz: 210 }, custom: [] };
  const st = () => ({ settings, models: { files, voices, baseReady: have.length > 0 }, hotkeyError: null });
  const engine = q === 'running' ? { state: 'running', provider: 'DirectML GPU (AMD Radeon RX 9070 XT)', f0: 'RMVPE', inferMs: 21.4, inferP95: 26.0, latencyMs: 186, dropouts: 0, inHz: 118, outHz: 206, shift: 9.6 }
    : q === 'dsp' ? { state: 'running', provider: 'DSP (no model)', latencyMs: 47, inHz: 118, outHz: 221, shift: 11 } : { state: 'off' };
  // v2.5.3 calibration mock: ?cal=results|presets|rec|none
  const cq = new URLSearchParams(location.search).get('cal') || 'results';
  const measure = { ok: true, checks: [{ id: 'level', level: 'ok', text: 'Level is good (-24 dBFS).' }, { id: 'clip', level: 'ok', text: 'No clipping.' }, { id: 'noise', level: 'warn', text: 'Background noise is high (only 22 dB below your voice). Turn on noise suppression or reduce the noise.' }, { id: 'length', level: 'ok', text: '19 s of voice recorded.' }],
    speechDb: -24, noiseDb: -46, snrDb: 22, medianHz: 118, p10Hz: 97, p90Hz: 150, rangeSemis: 7.6, stdSemis: 3.3, f1: 440, f2: 1510, f3: 2760, gateDb: -40.1, likely: 'male' };
  const cand = (key, name, gender, t, sc) => ({ key, name, gender, score: sc, contentSim: 0.94, pitchAcc: 0.6, preview: '/x.wav', preset: { voice: key, userHz: 118, targetHz: t, shift: Math.round(1200 * Math.log2(t / 118)) / 100, rangeScale: gender === 'F' ? 0.85 : 0.85, natFormant: gender === 'F' ? 9.4 : -12 } });
  let cal = { running: cq === 'running' ? { stage: 'Trying Nova (3 of 7)', pct: 0.38 } : null, hasSample: cq !== 'none',
    result: cq === 'none' ? null : { at: '2026-11-24T22:00:00Z', measure, before: '/b.wav', recommend: { note: 'The AI voice runs comfortably here (24 ms per 100 ms block).' },
      candidates: [cand('ava', 'Ava', 'F', 215, 87.6), cand('lyra', 'Lyra', 'F', 205, 87.4), cand('nova', 'Nova', 'F', 210, 87.4), cand('mia', 'Mia', 'F', 220, 85.5), cand('rowan', 'Rowan', 'M', 115, 80.2), cand('ezra', 'Ezra', 'M', 105, 79.0), cand('silas', 'Silas', 'M', 125, 78.1)] },
    personal: cq === 'presets' ? { presetId: 'p1' } : null,
    presets: cq === 'presets' || cq === 'results' ? [{ id: 'p1', name: 'My Lyra', voice: 'lyra', voiceName: 'Lyra', userHz: 118, targetHz: 205, adapt: 0.5 }, { id: 'p2', name: 'Stream girl', voice: 'ava', voiceName: 'Ava', userHz: 118, targetHz: 215, adapt: 0.5 }] : [] };
  const calRoute = (ch) => (ch === 'vc:calRecState' ? { recording: true, seconds: 11.4, peak: 0.42 } : ch === 'vc:calRecStart' ? { ok: true } : cal);
  return { engine, route: (ch, a) => { if (ch.startsWith('vc:cal') || ch.startsWith('vc:preset') || ch === 'vc:personalOff') return calRoute(ch); if (ch === 'vc:set') settings = { ...settings, ...a[0], dsp: a[0] && a[0].dsp ? { ...settings.dsp, ...a[0].dsp } : settings.dsp }; return st(); } };
}

// v2.6.0 bus mixer mock
export function mockBus() {
  const r = (o) => ({ A1: false, A2: false, A3: false, B1: false, B2: false, ...o });
  const eqf = { enabled: false, preset: 'flat', preampDb: 0, bands: [{ type: 'lowcut', f: 30, g: 0, q: 0.7, on: false }, { type: 'lowshelf', f: 90, g: 0, q: 0.7, on: true }, { type: 'peak', f: 250, g: 0, q: 1, on: true }, { type: 'peak', f: 1000, g: 0, q: 1, on: true }, { type: 'peak', f: 3000, g: 0, q: 1, on: true }, { type: 'highshelf', f: 9000, g: 0, q: 0.7, on: true }, { type: 'highcut', f: 20000, g: 0, q: 0.7, on: false }] };
  const ch = (id, label, o) => ({ id: 'ch:' + id, ch: id, kind: 'channel', label, icon: id, volume: 0.8, muted: false, solo: false, pan: 0, gate: { enabled: false, thresholdDb: -50 }, comp: { enabled: false, thresholdDb: -18, ratio: 3, makeupDb: 0 }, eq: eqf, routes: r(o), streamMode: true, hear: false });
  let st = { strips: [ch('game', 'Game', { A1: true, B2: true }), { ...ch('chat', 'Chat', { A1: true }), volume: 0.92 }, { ...ch('media', 'Media', { A1: true, B2: true }), volume: 0.26, comp: { enabled: true, thresholdDb: -20, ratio: 3, makeupDb: 2 }, hear: true }, ch('aux', 'Aux', { A1: true })],
    mic: { id: 'mic', kind: 'mic', label: 'Mic', name: 'Microphone (USB Mic)', gainDb: 0, gate: { enabled: true, thresholdDb: -55 }, comp: { enabled: true, thresholdDb: -20, ratio: 3, makeupDb: 4 }, eq: eqf, routes: r({ B1: true, B2: true }) },
    inputs: [{ id: 'in:i1', raw: 'i1', kind: 'input', label: 'Line in', name: 'Line In (Realtek(R) Audio)', gainDb: -3, pan: 0, routes: r({ A1: true, B2: true }) }],
    buses: [{ id: 'A1', name: 'Headphones (USB Headset)' }, { id: 'A2', deviceId: null }, { id: 'A3', deviceId: null }, { id: 'B1', name: 'Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)' }, { id: 'B2', name: 'Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)', limiter: { enabled: true, ceilingDb: -1 } }],
    scenes: [{ id: 's1', name: 'Gaming' }, { id: 's2', name: 'Just chatting' }], solo: false, active: true,
    devices: { outputs: [{ id: 'o1', name: 'Headphones (USB Headset)' }, { id: 'o2', name: 'Speakers (VR Headset)' }, { id: 'o3', name: 'Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)' }], inputs: [{ id: 'i1', name: 'Microphone (USB Mic)' }, { id: 'i2', name: 'Line In (Realtek(R) Audio)' }] } };
  return (ch2, a) => {
    if (ch2 === 'bus:route') { const [id, b, on] = a; const all = [...st.strips, st.mic, ...st.inputs]; const s = all.find((x) => x.id === id); if (s) s.routes = { ...s.routes, [b]: on }; }
    if (ch2 === 'bus:strip') { const [id, p] = a; st.strips = st.strips.map((x) => (x.id === id ? { ...x, ...p, muted: 'mute' in p ? p.mute : x.muted } : x)); st.inputs = st.inputs.map((x) => (x.id === id ? { ...x, ...p } : x)); if (id === 'mic') st.mic = { ...st.mic, ...p }; }
    if (ch2 === 'bus:out') { const [id, p] = a; st.buses = st.buses.map((x) => (x.id === id ? { ...x, ...p } : x)); }
    return { ...st, strips: [...st.strips], buses: [...st.buses] };
  };
}
