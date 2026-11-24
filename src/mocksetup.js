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
  return { engine, route: (ch, a) => { if (ch === 'vc:set') settings = { ...settings, ...a[0], dsp: a[0] && a[0].dsp ? { ...settings.dsp, ...a[0].dsp } : settings.dsp }; return st(); } };
}
