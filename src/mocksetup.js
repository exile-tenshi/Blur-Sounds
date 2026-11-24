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
    onStream: false, processing: true, aec: noCable, ns: true, chatbox: { ip: '127.0.0.1', port: 9000, live: false }, vrchatRunning: true, discordRunning: true, hifi: { installed: !noCable }, engineErrors: [], heal: { fixed: [], missing: [] },
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
