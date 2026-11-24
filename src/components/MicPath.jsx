import React, { useState } from 'react';
import { Icon } from './Icons.jsx';
import { MiniMeter, Toggle } from './Controls.jsx';
import { useHifi } from './HifiCable.jsx';

const db = (v) => (v > 0.00003 ? Math.round(20 * Math.log10(v)) : null);
const short = (n) => String(n || '').replace(/\s*\(.*$/, '');

// v2.3.1: records what Discord / VRChat would actually get (the cable's recording side) for 3 s, then plays it back.
export async function micTest(recordName, onState) {
  onState({ phase: 'rec', left: 3 });
  const pre = await navigator.mediaDevices.getUserMedia({ audio: true }); pre.getTracks().forEach((t) => t.stop()); // unlocks device labels
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  const dev = recordName ? devs.find((d) => d.label === recordName) || devs.find((d) => d.label.toLowerCase().startsWith(short(recordName).toLowerCase())) : null;
  if (recordName && !dev) throw new Error(`Windows doesn't list “${recordName}” as a recording device.`);
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: dev ? { exact: dev.deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } });
  const ctx = new AudioContext(); const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
  const buf = new Float32Array(an.fftSize); let peak = 0;
  const rec = new MediaRecorder(stream); const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data);
  rec.start();
  const t0 = Date.now();
  await new Promise((res) => { const tick = () => { an.getFloatTimeDomainData(buf); for (const v of buf) { const a = Math.abs(v); if (a > peak) peak = a; } const left = 3 - (Date.now() - t0) / 1000; onState({ phase: 'rec', left: Math.max(0, Math.ceil(left)), live: peak }); if (left > 0) requestAnimationFrame(tick); else res(); }; tick(); });
  await new Promise((res) => { rec.onstop = res; rec.stop(); });
  stream.getTracks().forEach((t) => t.stop()); ctx.close();
  onState({ phase: 'play', peak, device: dev ? dev.label : 'your mic' });
  const a = new Audio(URL.createObjectURL(new Blob(chunks, { type: rec.mimeType })));
  await a.play().catch(() => {}); await new Promise((res) => { a.onended = res; setTimeout(res, 4000); });
  onState({ phase: 'done', peak, device: dev ? dev.label : 'your mic' });
}

export function MicPath({ st, eng, onOpenChain }) {
  const p = st.micPath; const h = useHifi(); const [t, setT] = useState(null); const [tgt, setTgt] = useState('');
  if (!p) return null;
  const outPk = p.out ? (p.out.via === 'stream' ? eng.streamPk : eng.micOutPk) : -1;
  const route = (id) => window.bsp.invoke('mic:route', id);
  const run = async () => { try { await micTest(p.out?.recordName || null, setT); } catch (e) { setT({ phase: 'err', error: e.message }); } };
  const hifiBusy = h && ['download', 'verify', 'extract', 'install', 'detect'].includes(h.phase);
  return (
    <section className="panel micpath">
      <div className="micpath-row">
        <div className="listen-label"><div className="eyebrow">Mic path</div><small className="muted-text">what Discord / VRChat hear</small></div>
        <div className="mp-node"><Icon.mic size={14} /><div><b title={p.input?.name}>{p.input ? short(p.input.name) : 'No microphone'}</b><small>{p.input?.fallback ? 'Windows default mic' : 'input'}</small></div><MiniMeter level={eng.micPre || 0} /></div>
        <span className="mp-arrow">›</span>
        <button className={`mp-node mp-fx${p.processing ? ' on' : ''}`} onClick={onOpenChain} title="Open the mic chain"><Icon.settings size={14} /><div><b>{p.processing ? 'Processed' : 'Raw (no processing)'}</b><small>gate · noise · comp</small></div><MiniMeter level={eng.micPost || 0} /></button>
        <span className="mp-arrow">›</span>
        <div className={`mp-node${p.out ? '' : ' bad'}`}><Icon.cable size={14} /><div><b title={p.out?.name}>{p.out ? short(p.out.name) : 'Nowhere'}</b><small>{p.out ? (p.out.via === 'stream' ? 'via your stream mix' : 'virtual mic cable') : 'not sent to any cable'}</small></div><MiniMeter level={outPk > 0 ? outPk : 0} /></div>
        {p.streamMode && <div className="mp-stream" title="Off: your mic is NOT mixed into the stream mix that Streamlabs / OBS capture. It still goes to your virtual mic for VRChat / Discord."><Toggle small on={!!p.onStream} onChange={(v) => window.bsp.invoke('mic:chain', { inStream: v })} label="Mic on stream" /></div>}
        <button className="ghost-btn" disabled={t && (t.phase === 'rec' || t.phase === 'play')} onClick={run}><Icon.play size={13} /> {t?.phase === 'rec' ? `Recording… ${t.left}` : t?.phase === 'play' ? 'Playing back…' : 'Mic test'}</button>
      </div>
      {p.shared && !p.onStream && (
        <div className="warn-box">Your stream mix also goes to <b>{short(p.stream?.name)}</b>, the same cable as your mic, so anything capturing “{p.stream?.recordName}” (Streamlabs / OBS) still hears your mic. Give the stream mix its own device:
          {' '}<select value={tgt} onChange={(e) => setTgt(e.target.value)}><option value="">Choose…</option>{(p.streamTargets || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          {' '}<button className="primary-btn" disabled={!tgt} onClick={() => window.bsp.invoke('stream:route', tgt)}>Move stream mix</button>
          <div className="hint">Then in Streamlabs / OBS capture that device (an “Audio Output Capture” for a speaker/digital output, or its “… Output” recording device for a cable). For a dedicated stream cable you can also install the free standard VB-CABLE from vb-audio.com.</div>
        </div>)}
      {p.streamMode && p.stream && !p.shared && <p className="hint">Stream mix → <b>{short(p.stream.name)}</b>{p.onStream ? ' (includes your mic)' : ' (no mic)'}. Capture “{p.stream.recordName || p.stream.name}” in Streamlabs / OBS.</p>}
      {p.out && <p className="hint">In Discord / VRChat choose <b>“{p.out.recordName}”</b> as your microphone.</p>}
      {p.note && <p className="hint ok-text">{p.note}</p>}
      {t?.phase === 'done' && (t.peak > 0.003 ? <p className="hint ok-text">Mic test: “{t.device}” got your voice (peak {db(t.peak)} dB). You just heard what others hear.</p>
        : <p className="warn-box">Mic test: “{t.device}” was silent for 3 s. Talk during the test; if it stays silent, check the meters above: no input = mic/privacy settings, input but no “Processed” = the voice gate is closed (lower its threshold), processed but no output = the cable isn't receiving.</p>)}
      {t?.phase === 'err' && <p className="warn-box">Mic test failed: {t.error}</p>}
      {p.warn === 'no-input' && <p className="warn-box">No microphone found. Plug one in or allow microphone access in Windows Settings → Privacy → Microphone.</p>}
      {p.warn === 'out-missing' && <div className="warn-box">Your mic was set to go to <b>{p.savedOutName}</b>, which isn't on this PC.{p.cable ? <> <button className="primary-btn" onClick={() => route(p.cable.id)}>Use {short(p.cable.name)}</button></> : ' Install Hi-Fi Cable below.'}</div>}
      {p.warn === 'not-routed' && <div className="warn-box">Your mic isn't sent to any virtual cable, so Discord / VRChat can't get the processed voice. <button className="primary-btn" onClick={() => route(p.cable.id)}>Send my mic to {short(p.cable.name)}</button></div>}
      {(p.warn === 'no-cable' || (p.warn === 'out-missing' && !p.cable)) && (
        <div className="warn-box"><b>Your processed mic needs a virtual cable.</b> Blur Sounds Pro sends your cleaned-up voice into “Hi-Fi Cable Input”; Discord / VRChat then use “Hi-Fi Cable Output” as their microphone.
          {' '}<button className="primary-btn" disabled={hifiBusy} onClick={() => window.bsp.invoke('hifi:install')}>{hifiBusy ? `Installing… (${h.phase})` : 'Install Hi-Fi Cable'}</button>
          {h?.phase === 'reboot' && <span> Restart Windows to finish.</span>}{h?.phase === 'failed' && <span className="bad-text"> {h.error}</span>}
        </div>)}
      {p.errors?.length > 0 && <p className="warn-box">Audio engine: {p.errors.join(' · ')}</p>}
    </section>
  );
}
