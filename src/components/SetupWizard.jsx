import React, { useEffect, useRef, useState } from 'react';
import { Icon, Logo } from './Icons.jsx';
import { MiniMeter, Toggle } from './Controls.jsx';
import { useHifi } from './HifiCable.jsx';
import { micTest } from './MicPath.jsx';
import { StreamPath } from './StreamPath.jsx';

// v2.4.0 first-run setup wizard. Everything was already auto-configured on first launch; each step shows what was
// picked, lets you change it, and verifies it actually works (green check) or offers the fix.
const STEPS = [
  { id: 'welcome', label: 'Welcome' }, { id: 'speakers', label: 'Speakers' }, { id: 'mic', label: 'Microphone' }, { id: 'cable', label: 'Virtual cable' },
  { id: 'use', label: 'Use it' }, { id: 'stream', label: 'Streaming' }, { id: 'chatbox', label: 'VRChat chatbox' }, { id: 'done', label: 'Done' },
];
const short = (n) => String(n || '').replace(/\s*\(.*$/, '');
const db = (v) => (v > 0.00003 ? Math.round(20 * Math.log10(v)) : '−∞');
const open = (what) => window.bsp.invoke('setup:open', what);

function useLevels() {
  const [lv, setLv] = useState({}); const peaks = useRef({ pre: 0, post: 0, out: 0, at: 0 });
  useEffect(() => window.bsp.onLevels((d) => { const e = d.engine || {}; const p = peaks.current; const now = Date.now();
    if (now - p.at > 6000) { p.pre = 0; p.post = 0; p.out = 0; p.at = now; } // rolling 6 s window
    p.pre = Math.max(p.pre, e.micPre || 0); p.post = Math.max(p.post, e.micPost || 0); p.out = Math.max(p.out, e.micOutPk > 0 ? e.micOutPk : 0);
    setLv({ pre: e.micPre || 0, post: e.micPost || 0, out: e.micOutPk > 0 ? e.micOutPk : 0, max: { ...p } }); }), []);
  return lv;
}

async function playTone(deviceName) {
  // 0.9 s two-note chime, played on exactly the chosen device.
  const sr = 48000; const n = Math.floor(sr * 0.9); const buf = new ArrayBuffer(44 + n * 2); const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const t = i / sr; const f = t < 0.42 ? 660 : 990; const env = Math.min(1, t * 40) * Math.min(1, (0.9 - t) * 8) * (t < 0.42 ? Math.min(1, (0.42 - t) * 30) + (t > 0.4 ? 0 : 0) : 1); v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * f * t) * 0.35 * env * 32767, true); }
  const a = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
  const d = devs.find((x) => x.label === deviceName) || devs.find((x) => x.label.toLowerCase().startsWith(short(deviceName).toLowerCase()));
  if (d && a.setSinkId) await a.setSinkId(d.deviceId);
  await a.play(); return !!d;
}

function Check({ ok, pending, children }) {
  return <div className={`sw-check ${ok ? 'ok' : pending ? 'pending' : 'bad'}`}><span className="sw-dot">{ok ? '✓' : pending ? '…' : '!'}</span><div>{children}</div></div>;
}

export function SetupWizard({ onClose, rerun }) {
  const [st, setSt] = useState(null); const [i, setI] = useState(0); const [busy, setBusy] = useState(false);
  const [heard, setHeard] = useState(null); const [tone, setTone] = useState(null); const [mt, setMt] = useState(null); const [sent, setSent] = useState(null); const [copied, setCopied] = useState(false);
  const lv = useLevels(); const h = useHifi();
  const load = () => window.bsp.invoke('setup:get').then(setSt);
  useEffect(() => { load(); const off = window.bsp.onMixer(() => load()); const t = setInterval(load, 3000); return () => { off(); clearInterval(t); }; }, []);
  useEffect(() => { if (window.__bspSetupStep) setI(window.__bspSetupStep); }, []);
  const step = STEPS[i]; const next = () => setI((x) => Math.min(STEPS.length - 1, x + 1)); const back = () => setI((x) => Math.max(0, x - 1));
  const finish = async (skipped) => { await window.bsp.invoke('setup:finish', { skipped }); onClose && onClose(); };
  const act = async (ch, ...a) => { setBusy(true); try { const r = await window.bsp.invoke(ch, ...a); if (r && r.state) setSt(r.state); else if (r && r.ready !== undefined) setSt(r); return r; } finally { setBusy(false); } };
  const ready = st && st.ready;
  const spk = ready && st.speakers.find((o) => o.id === st.listen);
  const mic = ready && st.mics.find((o) => o.id === st.mic);
  const rec = st?.cable?.record?.name;
  const hifiBusy = h && ['download', 'verify', 'extract', 'install', 'detect'].includes(h.phase);
  const micOk = (lv.max?.pre || 0) > 0.01;
  const cableOk = !!st?.cable && ((lv.max?.out || 0) > 0.003 || (mt?.phase === 'done' && mt.peak > 0.003));
  const si = st?.streamInfo; const streamOk = !!si && !si.warn && si.via !== 'none';
  const results = ready ? [
    ['Speakers', !!spk && heard !== false, spk ? spk.name : 'none'],
    ['Microphone', !!mic, mic ? mic.name + (st.micFallback ? ' (Windows default)' : '') : 'none found'],
    ['Virtual mic cable', !!st.cable, st.cable ? st.cable.name : 'not installed'],
    ['Discord / VRChat mic', !!st.cable?.record?.id, rec || '—'],
    ['Stream audio', streamOk, !si ? '—' : si.via === 'desktop' ? `desktop audio (${si.desktop})` : si.dest ? `${si.dest.name} (${si.onStream ? 'with' : 'no'} mic)` : si.via === 'off' ? 'off' : 'no destination'],
    ['VRChat chatbox', true, `OSC ${st.chatbox.ip}:${st.chatbox.port}${st.chatbox.live ? ', live' : ', off'}`],
  ] : [];

  return (
    <div className="modal-back sw-back"><div className="sw">
      <aside className="sw-rail">
        <div className="sw-brand"><Logo size={30} /><div><b>BLUR SOUNDS <span className="brand-pro">PRO</span></b><small>Setup</small></div></div>
        {STEPS.map((s, k) => <button key={s.id} className={`sw-step${k === i ? ' on' : ''}${k < i ? ' past' : ''}`} onClick={() => setI(k)}><span>{k < i ? '✓' : k + 1}</span>{s.label}</button>)}
        <button className="sw-skip" onClick={() => finish(true)}>{rerun ? 'Close' : 'Skip setup'}</button>
      </aside>
      <section className="sw-body">
        <div className="sw-eyebrow">Step {i + 1} of {STEPS.length}</div>
        {!ready && step.id !== 'welcome' && <div className="warn-box">Waiting for the audio engine… If this doesn't go away, use Retry on the Mixer page.</div>}

        {step.id === 'welcome' && <>
          <h1 className="sw-title">Welcome to Blur Sounds Pro</h1>
          <p className="sw-lead">Blur Sounds Pro already set itself up for <b>this PC</b>. It found your speakers, your microphone and any virtual cable. These steps show what it picked, let you change it, and check that each part works.</p>
          {ready && st.setup?.changes?.length > 0 && <ul className="sw-list">{st.setup.changes.map((c) => <li key={c}>{c}</li>)}</ul>}
          <p className="muted-text">About 2 minutes. You can skip and change everything later in the Mixer, or run this again from Settings.</p>
          <div className="row-gap"><button className="ghost-btn" disabled={busy || !ready} onClick={() => act('setup:redetect')}>Detect devices again</button></div>
        </>}

        {step.id === 'speakers' && ready && <>
          <h1 className="sw-title">Speakers / headphones</h1>
          <p className="sw-lead">What you hear. Choosing a device here makes it the Windows default and moves Blur Sounds Pro's own mix with it, all in one go.</p>
          <div className="sw-devs">{st.speakers.map((o) => <button key={o.id} className={`sw-dev${o.id === st.listen ? ' on' : ''}`} disabled={busy} onClick={() => { setHeard(null); act('setup:speakers', o.id); }}>
            <Icon.headset size={16} /><div><b>{short(o.name)}</b><small>{o.name.match(/\(([^)]*)\)/)?.[1] || ''}{o.isDefault ? ' · Windows default' : ''}</small></div></button>)}</div>
          <div className="row-gap"><button className="primary-btn" disabled={!spk} onClick={async () => { setHeard(null); try { const found = await playTone(spk.name); setTone(found ? 'played' : 'default'); } catch (e) { setTone('err:' + e.message); } }}><Icon.play size={13} /> Test sound</button>
            {tone && <><span className="muted-text">Did you hear the chime?</span><button className="ghost-btn" onClick={() => setHeard(true)}>Yes</button><button className="ghost-btn" onClick={() => setHeard(false)}>No</button></>}</div>
          {heard === true && <Check ok>You hear Blur Sounds Pro on <b>{short(spk.name)}</b>.</Check>}
          {heard === false && <Check>No sound? Turn the volume up, check that this device is plugged in or connected, or pick another device above. <button className="ghost-btn" onClick={() => open('sound')}>Windows sound settings</button></Check>}
          {heard === null && <Check pending>Press <b>Test sound</b> to check.</Check>}
        </>}

        {step.id === 'mic' && ready && <>
          <h1 className="sw-title">Microphone</h1>
          <p className="sw-lead">Your real mic. Blur Sounds Pro cleans it up (noise suppression, a gentle gate{st.aec ? ', echo cancellation' : ''}) before it goes anywhere.</p>
          <div className="sw-devs">{st.mics.filter((m) => m.real).map((o) => <button key={o.id} className={`sw-dev${o.id === st.mic ? ' on' : ''}`} disabled={busy} onClick={() => act('setup:mic', o.id)}>
            <Icon.mic size={16} /><div><b>{short(o.name)}</b><small>{o.name.match(/\(([^)]*)\)/)?.[1] || ''}{o.isDefault ? ' · Windows default' : ''}</small></div></button>)}</div>
          <div className="sw-meters"><span>Mic</span><MiniMeter level={lv.pre || 0} /><span>Processed</span><MiniMeter level={lv.post || 0} /><small className="muted-text">peak {db(lv.max?.pre || 0)} dB</small></div>
          {micOk ? <Check ok>Hearing you on <b>{mic?.name}</b> (peak {db(lv.max.pre)} dB).</Check>
            : <Check pending>Say something. The meter should move. If it doesn't, pick another mic, or allow mic access in Windows. <button className="ghost-btn" onClick={() => open('mic')}>Microphone privacy settings</button></Check>}
        </>}

        {step.id === 'cable' && ready && <>
          <h1 className="sw-title">Virtual cable</h1>
          <p className="sw-lead">Discord and VRChat can't use Blur Sounds Pro directly. Your processed voice goes into a virtual cable, and those apps use the cable's other end as their microphone.</p>
          {st.cables.length > 0 && <div className="sw-cables">{st.cables.map((c) => <div key={c.id} className={`sw-cable${st.cable?.id === c.id ? ' on' : ''}`}><Icon.cable size={14} /><span>{c.name}</span>
            {c.sonar ? <small>SteelSeries Sonar (managed by GG)</small> : st.cable?.id === c.id ? <small className="ok-text">your mic goes here</small> : c.micCapable ? <button className="ghost-btn" onClick={() => act('setup:cable', c.id)}>Use for my mic</button> : null}</div>)}</div>}
          {st.cable ? <>
            <div className="sw-meters"><span>Into the cable</span><MiniMeter level={lv.out || 0} /><button className="ghost-btn" disabled={mt && ['rec', 'play'].includes(mt.phase)} onClick={async () => { try { await micTest(rec, setMt); } catch (e) { setMt({ phase: 'err', error: e.message }); } }}><Icon.play size={13} /> {mt?.phase === 'rec' ? `Recording… ${mt.left}` : mt?.phase === 'play' ? 'Playing back…' : 'Mic test (3 s)'}</button></div>
            {cableOk ? <Check ok>Your voice reaches <b>{short(st.cable.name)}</b>{mt?.phase === 'done' ? `: the mic test recorded ${db(mt.peak)} dB from “${mt.device}”` : ''}.</Check>
              : mt?.phase === 'done' ? <Check>The mic test recorded silence from “{mt.device}”. Talk during the test. If the Mic step's meter moves but this stays silent, press <b>Detect devices again</b> on the first step, or restart Blur Sounds Pro.{st.engineErrors?.length ? ` Engine: ${st.engineErrors.join(' · ')}` : ''}</Check>
              : mt?.phase === 'err' ? <Check>Mic test failed: {mt.error}</Check>
              : <Check pending>Say something and watch the meter, or press <b>Mic test</b>: it records 3 s from the cable, exactly what Discord and VRChat get, and plays it back.</Check>}
          </> : st.suggestedCable ? <Check>Found <b>{short(st.suggestedCable.name)}</b>, but your mic isn't sent to it. <button className="primary-btn" onClick={() => act('setup:cable', st.suggestedCable.id)}>Send my mic there</button></Check>
            : <div className="sw-hifi"><Check>No virtual cable on this PC yet. Install VB-Audio's free <b>Hi-Fi Cable</b> (donationware). Blur Sounds Pro downloads the official installer, checks its signature and sets everything up.</Check>
              <div className="row-gap"><button className="primary-btn" disabled={hifiBusy} onClick={() => window.bsp.invoke('hifi:install')}>{hifiBusy ? `Installing… (${h.phase})` : 'Install Hi-Fi Cable'}</button><button className="ghost-btn" onClick={() => open('hifi')}>vb-audio.com</button></div>
              {h?.phase === 'reboot' && <p className="warn-box">Hi-Fi Cable is installed but Windows needs a restart before it shows up. Restart, open Blur Sounds Pro, and it connects your mic to the cable automatically. <button className="ghost-btn" onClick={() => window.bsp.invoke('hifi:restart')}>Restart now</button></p>}
              {h?.phase === 'failed' && <p className="warn-box">{h.error}</p>}
              {h?.phase === 'cancelled' && <p className="warn-box">The installer was cancelled (it needs admin approval).</p>}
              <p className="muted-text small">Windows sometimes needs a restart after installing a new audio driver. Until then you can use your real mic directly in Discord / VRChat.</p></div>}
        </>}

        {step.id === 'use' && ready && <>
          <h1 className="sw-title">Use it in Discord and VRChat</h1>
          {st.cable ? <>
            <p className="sw-lead">In each app, choose this as your <b>microphone / input device</b>:</p>
            <div className="sw-copy"><Icon.mic size={16} /><b>{rec}</b><button className="ghost-btn" onClick={async () => { await window.bsp.invoke('setup:clipboard', rec); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy'}</button></div>
            <ul className="sw-list">
              <li><b>Discord</b>: User Settings → Voice &amp; Video → Input Device. Turn off Discord's own noise suppression and echo cancellation; Blur Sounds Pro already does it. <button className="ghost-btn" onClick={() => open('discord')}>Open Discord voice settings</button></li>
              <li><b>VRChat</b>: Settings → Audio &amp; Voice → Microphone (or the Quick Menu mic selector).</li>
              <li><b>Anything else</b> (Zoom, Teams, games): the same device as the microphone.</li>
            </ul>
            {st.cable.record?.id ? <Check ok>Windows lists “{rec}” as a recording device.</Check> : <Check>Windows doesn't list “{rec}” as a recording device. It may be disabled in Sound settings → Recording. <button className="ghost-btn" onClick={() => open('sound')}>Sound settings</button></Check>}
          </> : <Check>Install a virtual cable first (previous step). Until then, use your real mic directly in Discord / VRChat.</Check>}
        </>}

        {step.id === 'stream' && ready && <>
          <h1 className="sw-title">Streaming (optional)</h1>
          <p className="sw-lead">How your <b>app audio</b> (game, music, Discord…) reaches Streamlabs / OBS. With one virtual cable (your mic), either put the apps you stream <b>on the mic cable</b>, so Streamlabs / OBS only capture “Hi-Fi Cable Output”, or let them capture your <b>desktop audio</b>. For a stream mix nobody in voice chat hears, add a second free cable.</p>
          {st.streamInfo && !st.streamInfo.secondCable && st.streamInfo.micOption && (
            <div className="sw-choices">
              <button className={`sw-choice${st.streamInfo.via === 'mic' ? ' on' : ''}`} onClick={() => window.bsp.invoke('stream:set', { via: 'mic', id: st.streamInfo.micOption.id })}><b>I stream: put my apps on the mic cable</b><small>Streamlabs / OBS: Mic/Aux = “{st.streamInfo.micOption.record}”, Desktop Audio = Disabled. Voice chat hears those apps too (Discord / VRChat are left out).</small></button>
              <button className={`sw-choice${st.streamInfo.via === 'desktop' ? ' on' : ''}`} onClick={() => window.bsp.invoke('stream:set', { via: 'desktop' })}><b>Desktop audio</b><small>Streamlabs / OBS capture everything you hear; voice chat hears only your voice.</small></button>
              <button className={`sw-choice${st.streamInfo.via === 'off' ? ' on' : ''}`} onClick={() => window.bsp.invoke('stream:set', { via: 'off' })}><b>I don't stream</b><small>You can change this any time in the Mixer.</small></button>
            </div>)}
          {st.streamInfo && <StreamPath si={st.streamInfo} />}
          {st.streamInfo && (st.streamInfo.via === 'off' ? <Check ok>Streaming off. You can turn it on any time in the Mixer (Stream audio row).</Check>
            : !st.streamInfo.warn && st.streamInfo.via !== 'none' ? <Check ok>Your app audio goes to <b>{st.streamInfo.via === 'desktop' ? `desktop audio (${st.streamInfo.desktop})` : st.streamInfo.via === 'mic' ? `${st.streamInfo.dest?.name} together with your mic` : st.streamInfo.dest?.name}</b>. Set up Streamlabs / OBS as shown above.</Check>
            : <Check>Pick where your app audio goes (above).</Check>)}
        </>}

        {step.id === 'chatbox' && ready && <>
          <h1 className="sw-title">VRChat chatbox</h1>
          <p className="sw-lead">Blur Sounds Pro shows now playing, time and more in your VRChat chatbox over OSC, at <b>{st.chatbox.ip}:{st.chatbox.port}</b> (VRChat's default). In VRChat turn OSC on: Action Menu → Options → OSC → Enabled.</p>
          <div className="row-gap"><Toggle on={st.chatbox.live} onChange={(v) => act('setup:chatbox', { live: v })} label="Chatbox live" />
            <button className="primary-btn" onClick={async () => { const r = await act('setup:chatbox', { test: 'Blur Sounds Pro is set up ✦' }); setSent(r.sent); }}><Icon.send size={13} /> Send test message</button>
            <button className="ghost-btn" onClick={() => open('vrcosc')}>VRChat OSC help</button></div>
          {sent?.ok ? <Check ok={st.vrchatRunning}>{st.vrchatRunning ? <>Test message sent to VRChat. It should be above your head now.</> : <>Test message sent, but VRChat isn't running. Start VRChat and send it again to see it.</>}</Check>
            : sent ? <Check>Couldn't send: {sent.error}</Check> : <Check pending>Send a test message to check. By default the chatbox shows a short status, the time and what's playing. Customise it on the Chatbox page.</Check>}
        </>}

        {step.id === 'done' && ready && <>
          <h1 className="sw-title">You're set up</h1>
          <div className="sw-summary">{results.map(([k, ok, v]) => <div key={k} className={`sw-sum ${ok ? 'ok' : 'bad'}`}><span className="sw-dot">{ok ? '✓' : '!'}</span><b>{k}</b><span>{v}</span></div>)}</div>
          <p className="muted-text">Blur Sounds Pro checks your devices every time it starts. If one is unplugged or renamed it finds it again by name, or tells you on the Mixer page. Run this setup again any time from <b>Settings → Setup wizard</b>.</p>
        </>}

        <div className="sw-nav">
          {i > 0 && <button className="ghost-btn" onClick={back}>Back</button>}
          <span className="spacer" />
          {step.id !== 'done' ? <button className="primary-btn big" onClick={next}>{i === 0 ? 'Start' : 'Next'}</button> : <button className="primary-btn big" onClick={() => finish(false)}>Finish</button>}
        </div>
      </section>
    </div></div>
  );
}

// Startup self-heal banner: devices that were found again by name, or are missing (Windows default used meanwhile).
export function HealBanner() {
  const [hs, setHs] = useState(null); const [hide, setHide] = useState(0); const [si, setSi] = useState(null); const [hideS, setHideS] = useState('');
  useEffect(() => window.bsp.onMixer((s) => { if (!s) return; if (s.heal) setHs(s.heal); if (s.stream) setSi(s.stream); }), []);
  const streamBad = si && (si.warn === 'unset' || si.warn === 'no-destination' || si.warn === 'shared') && hideS !== si.warn;
  const dev = hs && hs.at > hide && (hs.missing.length || hs.fixed.length);
  if (!dev && !streamBad) return null;
  return (<>
    {streamBad && <div className="heal-banner">
      <span><b>Your apps aren't reaching your stream.</b> {si.warn === 'unset' ? 'Streaming is off, but channels are set to broadcast.' : si.warn === 'shared' ? 'The stream mix is on your mic cable.' : 'Streamer mode is on, but the stream mix has no output.'} Quick fix: let Streamlabs / OBS capture your desktop audio (see Mixer → Stream audio for the exact steps).</span>
      <button className="primary-btn" onClick={() => window.bsp.invoke('stream:set', { via: 'desktop' })}>Use desktop audio</button>
      {si.warn === 'unset' && <button className="ghost-btn" onClick={() => window.bsp.invoke('stream:set', { via: 'off' })}>I don't stream</button>}
      <button className="ghost-btn" onClick={() => setHideS(si.warn)}>Later</button>
    </div>}
    {dev && <div className={`heal-banner${hs.missing.length ? '' : ' ok'}`}>
      {hs.missing.length > 0 ? <span><b>Not connected:</b> {hs.missing.map((m) => `${m.what} (“${m.name}”) → using ${m.fallback}`).join(' · ')}. It switches back when it's plugged in again.</span>
        : <span><b>Devices updated:</b> {hs.fixed.join(' · ')}.</span>}
      <button className="ghost-btn" onClick={() => setHide(hs.at)}>Dismiss</button>
    </div>}
  </>);
}
