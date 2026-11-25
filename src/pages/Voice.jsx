// v2.5.0 Voice changer page.
import React, { useEffect, useState } from 'react';
import { Icon } from '../components/Icons.jsx';
import { Toggle, Select, MiniMeter } from '../components/Controls.jsx';
import { keyToAccel } from './Soundboard.jsx';

const MB = (b) => `${Math.round(b / 1048576)} MB`;
const QUAL = [
  { id: 'fast', label: 'Fast', sub: 'About 240 ms on a fast GPU. Good for quick back-and-forth; a little less smooth.' },
  { id: 'balanced', label: 'Natural', sub: 'Recommended. About 310 ms on a fast GPU. Looks ahead a little so words never sound robotic.' },
  { id: 'quality', label: 'Studio', sub: 'Smoothest, about 410 ms. For recordings and slower conversation.' },
];

export default function Voice() {
  const [vs, setVs] = useState(null);
  const [prog, setProg] = useState({});
  const [eng, setEng] = useState({});
  const [mc, setMc] = useState(null);
  const [binding, setBinding] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    window.bsp.invoke('vc:get').then(setVs);
    const offs = [window.bsp.onVc(setVs), window.bsp.onVcProgress((p) => setProg((o) => ({ ...o, [p.key]: p }))),
      window.bsp.onEngine((d) => setEng((d && d.engine) || {})), window.bsp.onMixer((s) => s && s.micChain && setMc(s.micChain))];
    return () => offs.forEach((f) => f && f());
  }, []);
  useEffect(() => {
    if (!binding) return;
    const h = (e) => { e.preventDefault(); const acc = keyToAccel(e); if (acc === null) return; set({ hotkey: acc }); setBinding(false); };
    window.addEventListener('keydown', h, true); return () => window.removeEventListener('keydown', h, true);
  }, [binding]);
  if (!vs) return <div className="page"><div className="empty-state panel"><Icon.vchange size={36} /><h2>Loading…</h2></div></div>;
  const v = vs.settings; const models = vs.models;
  const set = async (p) => { setVs({ ...vs, settings: { ...v, ...p, dsp: p.dsp ? { ...v.dsp, ...p.dsp } : v.dsp } }); setVs(await window.bsp.invoke('vc:set', p)); };
  const ch = eng.changer || {};
  const voice = models.voices.find((x) => x.id === v.voice) || models.voices[0];
  const downloading = Object.values(prog).some((p) => p.state === 'downloading');
  const need = Object.entries(models.files).filter(([k, f]) => !f.present && (['contentvec', 'rmvpe'].includes(k) || (voice && voice.files && voice.files.includes(k))));
  const needBytes = need.reduce((a, [, f]) => a + f.size, 0);
  const dlErr = Object.values(prog).find((p) => p.state === 'error');
  const download = async (id) => { setMsg(''); const r = await window.bsp.invoke('vc:download', id || v.voice); setVs(r); };
  const preset = (p) => {
    if (v.engine === 'dsp') return set({ preset: p, dsp: p === 'm2f' ? { pitch: 11, formant: 17, targetHz: 210 } : { pitch: -11, formant: -14, targetHz: 115 } });
    const pick = models.voices.find((x) => x.gender === (p === 'm2f' ? 'female' : 'male') && x.ready) || models.voices.find((x) => x.id === (p === 'm2f' ? 'lyra' : 'rowan'));
    set({ preset: p, voice: pick.id, pitch: 0, autoPitch: true });
  };
  const hearOn = !!(mc && mc.monitor && mc.monitor.enabled);
  const stateText = !v.enabled ? 'Off' : v.engine === 'dsp' ? 'Running · pitch & formant (no model)'
    : ch.state === 'running' ? `Running on ${ch.provider || '…'}` : ch.state === 'loading' ? 'Loading the voice…' : ch.state === 'error' ? 'Error' : (!voice || !voice.ready) ? 'Waiting for the voice download' : 'Starting…';
  const ready = v.engine === 'dsp' || (voice && voice.ready);
  return (
    <div className="page voice-page">
      <section className="panel vc-hero">
        <div className="row-between">
          <div><h3>Voice changer</h3><p className="muted-text small">Changes your mic voice live for Discord, VRChat, your stream and clips. It runs after noise suppression and before the virtual mic.</p></div>
          <div className="row-gap">
            <span className={`pill ${v.enabled && (ch.state === 'running' || v.engine === 'dsp') ? 'live' : v.enabled ? 'warn' : ''}`}><i />{stateText}</span>
            <Toggle on={v.enabled} onChange={(on) => set({ enabled: on, bypass: false })} label={v.enabled ? 'On' : 'Off'} />
          </div>
        </div>
        {v.enabled && <div className="ab-bar">
          <div className="seg ab">
            <button className={!v.bypass ? 'on' : ''} onClick={() => set({ bypass: false })}><b>Changed voice</b><span>Everyone hears the new voice</span></button>
            <button className={v.bypass ? 'on' : ''} onClick={() => set({ bypass: true })}><b>My real voice</b><span>Instant A/B, no reload</span></button>
          </div>
          <div className="ab-side">
            <Toggle small on={hearOn} onChange={(on) => window.bsp.invoke('mic:chain', { monitor: { ...(mc?.monitor || { volume: 0.8 }), enabled: on } }).then((r) => r && setMc(r))} label="Hear myself" />
            <div className="chain-meters"><span>in</span><MiniMeter level={eng.micPre || 0} /><span>out</span><MiniMeter level={eng.micPost || 0} /></div>
          </div>
        </div>}
        {v.enabled && ch.state === 'error' && <p className="warn-box">The voice couldn't start: {ch.error}. Your normal mic keeps working. Try “CPU” under Performance, or re-download the voice.</p>}
        {v.enabled && hearOn && <p className="hint">“Hear myself” plays your changed voice into your headphones (use headphones, not speakers).</p>}
        {v.enabled && <div className="vc-stats">
          <div><span>Delay</span><b>{v.engine === 'dsp' ? '≈ 47' : ch.latencyMs || '—'} ms</b></div>
          <div><span>Your pitch</span><b>{ch.inHz ? `${ch.inHz} Hz` : '—'}</b></div>
          <div><span>New pitch</span><b>{ch.outHz ? `${ch.outHz} Hz` : '—'}</b></div>
          <div><span>Shift</span><b>{ch.shift != null ? `${ch.shift > 0 ? '+' : ''}${ch.shift} st` : '—'}</b></div>
          {v.engine !== 'dsp' && <div><span>{(ch.provider || '').startsWith('DirectML') ? 'GPU time' : 'CPU time'}</span><b>{ch.inferMs ? `${ch.inferMs} ms` : '—'}</b></div>}
          {v.engine !== 'dsp' && <div><span>Dropouts</span><b className={ch.dropouts ? 'bad-text' : ''}>{ch.dropouts ?? 0}</b></div>}
        </div>}
      </section>

      <section className="panel">
        <div className="seg">
          <button className={v.engine !== 'dsp' ? 'on' : ''} onClick={() => set({ engine: 'ai' })}><b>AI voice</b><span>Replaces your voice with a real recorded voice (RVC). Most natural. One-time download, runs on your GPU.</span></button>
          <button className={v.engine === 'dsp' ? 'on' : ''} onClick={() => set({ engine: 'dsp' })}><b>Pitch & formant</b><span>Classic shifter, no download, ~47 ms. Keeps it your voice, just higher or lower.</span></button>
        </div>
        <div className="row-gap wrap vc-presets">
          <span className="muted-text small">Preset</span>
          <button className={`chip${v.preset === 'm2f' ? ' on' : ''}`} onClick={() => preset('m2f')}>Male → Female</button>
          <button className={`chip${v.preset === 'f2m' ? ' on' : ''}`} onClick={() => preset('f2m')}>Female → Male</button>
        </div>
      </section>

      {v.engine !== 'dsp' ? <>
        <section className="panel">
          <div className="row-between"><h4 className="drawer-sub">Voice</h4>
            <div className="row-gap"><button className="ghost-btn" onClick={async () => { const r = await window.bsp.invoke('vc:import', {}); if (r && !r.ok && !r.cancelled) setMsg(r.error); else if (r && r.ok) { setVs(r.state); setMsg(''); } }}><Icon.plus size={14} />Import voice…</button>
              <button className="ghost-btn" onClick={() => window.bsp.invoke('vc:openFolder')}><Icon.folder size={14} />Models folder</button></div></div>
          <div className="vc-voices">
            {models.voices.map((x) => (
              <button key={x.id} className={`vc-voice${v.voice === x.id ? ' on' : ''}${x.ready ? '' : ' dl'}`} onClick={() => set({ voice: x.id })} title={x.source}>
                <span className={`vc-g ${x.gender}`}>{x.gender === 'male' ? '♂' : '♀'}</span>
                <b>{x.name}</b><span>{x.desc}</span>
                {!x.ready && <em>Download needed</em>}
                {x.custom && <i className="vc-x" onClick={(e) => { e.stopPropagation(); window.bsp.invoke('vc:removeCustom', x.id).then(setVs); }}>remove</i>}
              </button>
            ))}
          </div>
          {msg && <p className="warn-box">{msg}</p>}
          {voice && !voice.ready && <div className="vc-dl">
            <div><b>{voice.name}</b> needs a one-time download of {MB(needBytes)} ({need.map(([, f]) => f.label).join(', ')}). Files come from the official RVC project and this app's GitHub release, and each one is checked against its SHA-256 before it's used.</div>
            {downloading ? <button className="ghost-btn" onClick={() => window.bsp.invoke('vc:cancel')}>Cancel</button> : <button className="primary-btn" onClick={() => download(voice.id)}>Download {MB(needBytes)}</button>}
          </div>}
          {Object.entries(prog).filter(([, p]) => p.state === 'downloading').map(([k, p]) => (
            <div key={k} className="vc-prog"><span>{models.files[k]?.label}</span><div className="upd-bar"><i style={{ width: `${Math.round((p.got / p.total) * 100)}%` }} /></div><span>{MB(p.got)} / {MB(p.total)}</span></div>))}
          {dlErr && !downloading && <p className="warn-box">{dlErr.error}</p>}
          {voice && <p className="hint">{voice.source}</p>}
        </section>

        <section className="panel vc-grid">
          <div className="fx">
            <div className="fx-head"><Toggle small on={v.autoPitch} onChange={(on) => set({ autoPitch: on })} /><b>Auto pitch</b><span className="fx-tag">recommended</span></div>
            <p className="hint">Learns your normal speaking pitch and moves it to where this voice naturally sits, keeping your intonation. No guessing semitones.</p>
            {v.autoPitch && <label>Target pitch <span>{v.targetHz} Hz</span><input type="range" min={80} max={300} value={v.targetHz} onChange={(e) => set({ targetHz: Number(e.target.value) })} /></label>}
            <label>{v.autoPitch ? 'Fine-tune' : 'Pitch'} <span>{v.pitch > 0 ? '+' : ''}{v.pitch} semitones</span><input type="range" min={-24} max={24} step={0.5} value={v.pitch} onChange={(e) => set({ pitch: Number(e.target.value) })} /></label>
          </div>
          <div className="fx">
            <div className="fx-head"><b>Character</b></div>
            <label>Blend with <span>{v.blendWith ? `${Math.round((v.blend || 0) * 100)}%` : 'off'}</span></label>
            <Select value={v.blendWith} onChange={(x) => set({ blendWith: x, blend: x ? (v.blend || 0.3) : 0 })} options={[{ value: null, label: 'No blend' }, ...models.voices.filter((x) => x.id !== v.voice && x.model && voice && x.model === voice.model).map((x) => ({ value: x.id, label: x.name }))]} />
            {v.blendWith && <label>Mix <span>{Math.round((v.blend || 0) * 100)}%</span><input type="range" min={0} max={100} value={Math.round((v.blend || 0) * 100)} onChange={(e) => set({ blend: Number(e.target.value) / 100 })} /></label>}
            <label>Expressiveness <span>{Math.round((v.expressive ?? 0.5) * 100)}%</span><input type="range" min={0} max={150} value={Math.round((v.expressive ?? 0.5) * 100)} onChange={(e) => set({ expressive: Number(e.target.value) / 100 })} /></label>
            <label>Follow my loudness <span>{Math.round((1 - (v.envMix ?? 0.7)) * 100)}%</span><input type="range" min={0} max={100} value={Math.round((1 - (v.envMix ?? 0.7)) * 100)} onChange={(e) => set({ envMix: 1 - Number(e.target.value) / 100 })} /></label>
            {voice && voice.tuned && (Math.abs((v.expressive ?? 0.5) - voice.tuned.expressive) > 0.01 || Math.abs((v.envMix ?? 0.7) - voice.tuned.envMix) > 0.01) &&
              <button className="chip" onClick={() => set({ expressive: voice.tuned.expressive, envMix: voice.tuned.envMix, targetHz: voice.targetHz })}>Use the tuned settings for {voice.name}</button>}
          </div>
          <div className="fx">
            <div className="fx-head"><Toggle small on={v.natural !== false} onChange={(on) => set({ natural: on })} /><b>Natural sounds</b><span className="fx-tag">laughs · sniffles · breaths</span></div>
            <p className="hint">AI voices turn laughs, sniffles, coughs and breaths into garbled half-words. With this on, those moments use your real sound, shifted to match the voice, and blend back into the AI voice for speech.</p>
            {v.natural !== false && <label>Real-sound blend <span>{Math.round((v.natBlend ?? 0.75) * 100)}%</span><input type="range" min={0} max={100} value={Math.round((v.natBlend ?? 0.75) * 100)} onChange={(e) => set({ natBlend: Number(e.target.value) / 100 })} /></label>}
            {v.enabled && ch.natural && <p className="hint">Now: {ch.natural.now} · laughs {ch.natural.laughs} · other sounds {ch.natural.noises}</p>}
          </div>
        </section>

        <section className="panel">
          <h4 className="drawer-sub">Performance</h4>
          <div className="seg three">{QUAL.map((q) => <button key={q.id} className={v.quality === q.id ? 'on' : ''} onClick={() => set({ quality: q.id })}><b>{q.label}</b><span>{q.sub}</span></button>)}</div>
          <div className="row-gap wrap" style={{ marginTop: 10 }}>
            <span className="muted-text small">Run on</span>
            <button className={`chip${v.device !== 'cpu' ? ' on' : ''}`} onClick={() => set({ device: 'gpu' })}>GPU (DirectML: AMD, NVIDIA, Intel)</button>
            <button className={`chip${v.device === 'cpu' ? ' on' : ''}`} onClick={() => set({ device: 'cpu' })}>CPU</button>
            <span className="muted-text small" style={{ marginLeft: 12 }}>Pitch tracker</span>
            {[['auto', 'Auto'], ['rmvpe', 'RMVPE (best)'], ['yin', 'YIN (light)']].map(([id, l]) => <button key={id} className={`chip${(v.f0 || 'auto') === id ? ' on' : ''}`} onClick={() => set({ f0: id })}>{l}</button>)}
          </div>
          {v.device === 'cpu' && <p className="hint">On the CPU the AI voice needs a fast processor; if you hear dropouts, use Studio quality (longer blocks) or the GPU.</p>}
        </section>
      </> : (
        <section className="panel vc-grid">
          <div className="fx">
            <div className="fx-head"><b>Pitch</b></div>
            <div className="fx-head"><Toggle small on={v.autoPitch} onChange={(on) => set({ autoPitch: on })} /><span className="muted-text small">Auto pitch (aim for a target)</span></div>
            {v.autoPitch && <label>Target pitch <span>{v.dsp.targetHz} Hz</span><input type="range" min={80} max={300} value={v.dsp.targetHz} onChange={(e) => set({ dsp: { targetHz: Number(e.target.value) } })} /></label>}
            {v.autoPitch
              ? <label>Fine-tune <span>{v.pitch > 0 ? '+' : ''}{v.pitch || 0} semitones</span><input type="range" min={-6} max={6} step={0.5} value={v.pitch || 0} onChange={(e) => set({ pitch: Number(e.target.value) })} /></label>
              : <label>Pitch <span>{v.dsp.pitch > 0 ? '+' : ''}{v.dsp.pitch} semitones</span><input type="range" min={-24} max={24} step={0.5} value={v.dsp.pitch} onChange={(e) => set({ dsp: { pitch: Number(e.target.value) } })} /></label>}
          </div>
          <div className="fx">
            <div className="fx-head"><b>Formant</b><span className="fx-tag">vocal-tract size</span></div>
            <label>Formant shift <span>{v.dsp.formant > 0 ? '+' : ''}{v.dsp.formant}%</span><input type="range" min={-40} max={60} value={v.dsp.formant} onChange={(e) => set({ dsp: { formant: Number(e.target.value) } })} /></label>
            <p className="hint">Moves the resonances separately from the pitch: about +15 to +20% sounds female, −10 to −15% male. Too far sounds cartoonish.</p>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="row-between">
          <div><h4 className="drawer-sub">Hotkey</h4><p className="hint">Switches between your changed and your real voice from any game. Turns the changer on if it's off.</p></div>
          <button className={`hotkey${binding ? ' binding' : ''}`} onClick={() => setBinding(true)}>{binding ? 'Press keys… (Esc clears)' : v.hotkey || 'Set hotkey'}</button>
        </div>
        {vs.hotkeyError && <p className="hint warn-text">{vs.hotkeyError} is in use by another app. Pick a different one.</p>}
      </section>

      <p className="hint pad">How natural it sounds depends on your mic and room: a clean, close mic with noise suppression on gives the best result. AI voices change who you sound like, not what you say. Only use voices you have the right to use.</p>
    </div>
  );
}
