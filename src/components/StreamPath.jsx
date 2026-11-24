import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import { MiniMeter } from './Controls.jsx';

// v2.4.1: where your app audio goes for Streamlabs / OBS, with a meter proving it, and the fixes when it goes nowhere.
const short = (n) => String(n || '').replace(/\s*\(.*$/, '');
const BUSY = ['download', 'verify', 'extract', 'install', 'detect'];
const set = (via, id) => window.bsp.invoke('stream:set', { via, id }).then((r) => { if (r && r.ok === false && r.error) window.alert(r.error); return r; });

export function useStreamLevel(si) {
  const [lv, setLv] = useState(0); const max = useRef({ v: 0, at: 0 });
  useEffect(() => window.bsp.onLevels((d) => {
    const e = d.engine || {}; const v = si && (si.via === 'desktop') ? (d.master || 0) : (e.streamPk > 0 ? e.streamPk : 0);
    const now = Date.now(); if (now - max.current.at > 5000) max.current = { v: 0, at: now }; max.current.v = Math.max(max.current.v, v); setLv(v);
  }), [si && si.via]);
  return { lv, max: max.current.v };
}

// What Streamlabs / OBS should capture for the current destination.
export function CaptureHowTo({ si }) {
  if (!si) return null;
  const mic = si.micRecord;
  if (si.via === 'desktop') return (
    <ol className="sp-how">
      <li><b>Streamlabs</b>: Settings → Audio → <b>Desktop Audio Device 1</b> = <b>Default</b> (or “{si.desktop}”). <b>OBS</b>: Settings → Audio → <b>Desktop Audio</b> = Default.</li>
      {mic && <li>Your voice: <b>Mic/Auxiliary Device 1</b> = “<b>{mic}</b>” (your processed mic). Don't add it twice.</li>}
      <li>That records everything you hear on “{short(si.desktop)}”. The per-channel <b>stream</b> buttons don't apply in this mode. For a separate stream mix with its own volumes, install a second cable below.</li>
    </ol>);
  if (si.via === 'mic' && si.dest) return (
    <ol className="sp-how">
      <li><b>Streamlabs</b>: Settings → Audio → <b>Mic/Auxiliary Device 1</b> = “<b>{si.dest.record}</b>” and <b>Desktop Audio Device 1</b> = <b>Disabled</b>. <b>OBS</b>: Settings → Audio → Mic/Auxiliary = “{si.dest.record}”, Desktop Audio = Disabled.</li>
      <li>That one device carries your processed voice <b>and</b> the apps whose <Icon.stream size={12} /> stream button is on{si.broadcastOn.length ? ` (on now: ${si.broadcastOn.join(', ')})` : ' (none right now)'}. Your mic processing is applied to your voice only.</li>
      <li>{si.includeVoice ? 'Voice-chat apps are included (you turned that on): people in calls may hear themselves.' : `Voice-chat apps (Discord, VRChat, TeamSpeak…) are left out so nobody hears themselves back${si.voiceApps?.length ? ` (left out now: ${si.voiceApps.join(', ')})` : ''}.`}</li>
    </ol>);
  if ((si.via === 'cable' || si.via === 'output') && si.dest) return (
    <ol className="sp-how">
      {si.dest.cable
        ? <li><b>Streamlabs / OBS</b>: add a source <b>Audio Input Capture</b> → “<b>{si.dest.record}</b>”.</li>
        : <li><b>Streamlabs / OBS</b>: add a source <b>Audio Output Capture</b> → “<b>{si.dest.name}</b>”.</li>}
      <li>Set <b>Desktop Audio</b> to <b>Disabled</b> (Streamlabs: Settings → Audio → Desktop Audio Device 1), or you'll stream your apps twice.</li>
      {mic && <li>Your voice: Mic/Auxiliary = “<b>{mic}</b>”{si.onStream ? ' (or nothing: Mic on stream already mixes it in)' : ''}.</li>}
      <li>Each channel's <Icon.stream size={12} /> button and Stream fader decide what's on stream{si.broadcastOn.length ? ` (on now: ${si.broadcastOn.join(', ')})` : ' (all channels are muted on stream right now)'}.</li>
    </ol>);
  return null;
}

export function SecondCable({ si }) {
  const [v, setV] = useState(si?.vbc || null);
  useEffect(() => window.bsp.onVbc ? window.bsp.onVbc(setV) : undefined, []);
  const st = v || si?.vbc || {}; const busy = BUSY.includes(st.phase);
  if (!si) return null;
  if (si.secondCable && si.via !== 'cable') return <div className="row-gap"><button className="primary-btn" onClick={() => set('cable', si.secondCable.id)}>Send the stream mix to {short(si.secondCable.name)}</button></div>;
  if (si.secondCable || st.installed) return null;
  if (!si.hifiInstalled) return <p className="hint">Install Hi-Fi Cable first (for your mic). A second cable can carry the stream mix after that.</p>;
  return (
    <div className="sp-install">
      <div className="row-gap"><button className="primary-btn" disabled={busy} onClick={() => window.bsp.invoke('vbcable:install')}>{busy ? `Installing VB-CABLE… (${st.phase}${st.phase === 'download' && st.pct != null ? ` ${st.pct}%` : ''})` : 'Install VB-CABLE (free) for a separate stream mix'}</button>
        <button className="ghost-btn" onClick={() => window.bsp.invoke('app:openUrl', 'https://vb-audio.com/Cable/')}>vb-audio.com</button></div>
      <p className="muted-text small">VB-CABLE is VB-Audio's free donationware virtual cable. Blur Sounds Pro downloads the official package from vb-audio.com when you click, checks its signature and runs the official installer (admin prompt → “Install Driver”). Windows usually needs a <b>restart</b>; after it, the stream mix goes to “CABLE Input” automatically.</p>
      {st.phase === 'reboot' && <p className="warn-box">VB-CABLE is installed. <b>Restart Windows</b> to finish; the stream mix switches over on the next start. <button className="ghost-btn" onClick={() => window.bsp.invoke('vbcable:restart')}>Restart now</button></p>}
      {st.phase === 'failed' && <p className="warn-box">{st.error}</p>}
      {st.phase === 'cancelled' && <p className="warn-box">The installer was cancelled (it needs admin approval).</p>}
      {si.pending && st.phase === 'idle' && <p className="hint">Waiting for VB-CABLE to appear (restart Windows if you just installed it).</p>}
    </div>);
}

export function StreamPath({ si }) {
  const { lv, max } = useStreamLevel(si); const [pick, setPick] = useState('');
  if (!si) return null;
  const dest = si.via === 'mic' && si.dest ? `${short(si.dest.name)}: mic + apps` : si.via === 'desktop' ? `Desktop audio: ${short(si.desktop)}` : si.dest ? short(si.dest.name) : si.via === 'off' ? 'Off' : 'Nowhere';
  const sub = si.via === 'mic' ? `capture “${short(si.dest?.record)}” as Mic/Aux` : si.via === 'desktop' ? 'Streamlabs / OBS capture what you hear' : si.dest ? (si.dest.cable ? `stream mix · capture “${short(si.dest.record)}”` : 'stream mix · Audio Output Capture') : si.via === 'off' ? "you don't stream" : 'no stream destination';
  const bad = si.via === 'none' || si.warn === 'shared' || si.warn === 'unset';
  return (
    <section className="panel micpath streampath">
      <div className="micpath-row">
        <div className="listen-label"><div className="eyebrow">Stream audio</div><small className="muted-text">what Streamlabs / OBS get</small></div>
        <div className="mp-node"><Icon.mixer size={14} /><div><b>Your apps</b><small>{si.via === 'desktop' ? 'everything you hear' : si.broadcastOn.length ? `on stream: ${si.broadcastOn.join(', ')}` : 'no channel on stream'}</small></div></div>
        <span className="mp-arrow">›</span>
        <div className={`mp-node${bad ? ' bad' : ''}`}><Icon.stream size={14} /><div><b title={si.dest?.name || si.desktop}>{dest}</b><small>{sub}</small></div>{(si.dest || si.via === 'desktop') && <MiniMeter level={lv} />}</div>
        <div className="select sp-select"><select value="" onChange={(e) => { const [via, id] = e.target.value.split('|'); if (via) set(via, id); }}>
          <option value="">Change…</option>
          {si.micOption && <option value={`mic|${si.micOption.id}`}>Mic cable ({short(si.micOption.name)}): mic + streamed apps</option>}
          <option value="desktop|">Desktop audio (works now, no install)</option>
          {si.options.map((o) => <option key={o.id} value={`${o.cable ? 'cable' : 'output'}|${o.id}`}>{o.cable ? 'Stream mix → ' : 'Stream mix → unused output: '}{o.name}</option>)}
          <option value="off|">Off (I don't stream)</option>
        </select></div>
      </div>
      {si.via === 'none' && <div className="warn-box"><b>Streamer mode is on, but your stream mix has no destination{si.savedName ? ` (“${si.savedName}” isn't connected)` : ''}.</b> Nothing reaches Streamlabs / OBS. Pick where it goes:
        {' '}<button className="primary-btn" onClick={() => set('desktop')}>Use desktop audio</button>{si.secondCable && <> <button className="primary-btn" onClick={() => set('cable', si.secondCable.id)}>Use {short(si.secondCable.name)}</button></>}</div>}
      {si.warn === 'shared' && <div className="warn-box"><b>Your stream mix and your mic share “{short(si.dest?.name)}”.</b> Discord / VRChat would hear your apps. <button className="primary-btn" onClick={() => set('desktop')}>Use desktop audio instead</button></div>}
      {si.warn === 'unset' && <div className="warn-box"><b>Your apps aren't going to your stream.</b> Streaming is off, but {si.broadcastOn.join(', ')} {si.broadcastOn.length > 1 ? 'are' : 'is'} set to broadcast. Choose how Streamlabs / OBS get your app audio:
        {' '}{si.micOption && <button className="primary-btn" onClick={() => set('mic', si.micOption.id)}>Mic cable: mic + apps</button>} <button className="primary-btn" onClick={() => set('desktop')}>Desktop audio (works now)</button>{si.secondCable && <> <button className="primary-btn" onClick={() => set('cable', si.secondCable.id)}>Stream mix → {short(si.secondCable.name)}</button></>} <button className="ghost-btn" onClick={() => set('off')}>I don't stream</button></div>}
      {si.via === 'mic' && <>
        <div className="warn-box amber"><b>Voice chat hears these apps too.</b> Discord / VRChat use “{si.dest?.record}” as your mic, so everyone in a call hears the apps you stream. Turn a channel's <Icon.stream size={12} /> button off to keep it out. For apps on stream only, add a second cable (VB-CABLE, free) below.</div>
        <div className="field-row sp-apps"><span className="muted-text">Apps level on the cable</span>
          <input type="range" min={0} max={150} value={Math.round((si.appsVolume ?? 0.6) * 100)} onChange={(e) => window.bsp.invoke('stream:micopts', { appsVolume: Number(e.target.value) / 100 })} />
          <span className="muted-text small">{Math.round((si.appsVolume ?? 0.6) * 100)}%</span>
          <label className="muted-text small"><input type="checkbox" checked={!!si.includeVoice} onChange={(e) => window.bsp.invoke('stream:micopts', { includeVoice: e.target.checked })} /> include voice-chat apps (echo risk)</label></div>
      </>}
      {(si.via === 'desktop' || si.via === 'cable' || si.via === 'output' || si.via === 'mic') && <>
        <CaptureHowTo si={si} />
        {max > 0.003 ? <p className="hint ok-text">✓ Audio is flowing to {si.via === 'desktop' ? `“${short(si.desktop)}”` : `“${short(si.dest?.name)}”`} (peak {Math.round(20 * Math.log10(max))} dB).</p>
          : <p className="hint">Play something (music, a video) and the meter above should move{si.via !== 'desktop' && !si.broadcastOn.length ? '. Every channel is muted on stream right now; turn a channel\'s stream button on' : ''}.</p>}
      </>}
      {(si.via === 'desktop' || si.via === 'off' || si.via === 'unset' || si.via === 'mic') && <SecondCable si={si} />}
    </section>
  );
}
