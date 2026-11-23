import React, { useEffect, useState } from 'react';
import { Icon } from '../components/Icons.jsx';
import { Toggle, Select, MiniMeter } from '../components/Controls.jsx';
import Library from '../components/Library.jsx';
import { keyToAccel } from './Soundboard.jsx';

const LENGTHS = [15, 30, 60, 120, 180, 300];
export function useEngine() {
  const [e, setE] = useState(null);
  useEffect(() => { window.bsp.invoke('engine:get').then((r) => r && setE(r)); return window.bsp.onEngine(setE); }, []);
  return e;
}

export default function Clips({ settings, update }) {
  const c = settings.clips;
  const es = useEngine();
  const eng = es?.engine || {}; const med = es?.media || {};
  const [binding, setBinding] = useState(false);
  const [phrase, setPhrase] = useState(c.voice.phrase);
  const [refresh, setRefresh] = useState(0);
  const [last, setLast] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => window.bsp.onClipSaved((r) => { setLast(r); setRefresh((x) => x + 1); }), []);
  useEffect(() => {
    if (!binding) return;
    const h = (e) => { e.preventDefault(); const a = keyToAccel(e); if (a === null) return; setBinding(false); update(['clips', 'hotkey'], a); };
    window.addEventListener('keydown', h, true); return () => window.removeEventListener('keydown', h, true);
  }, [binding]);
  const voice = eng.voice || {};
  const buffered = Math.min(c.seconds, Math.max(eng.clip?.buffered || 0, 0));
  const vState = !c.voice.enabled ? 'off' : voice.error ? 'error' : voice.ready ? 'listening' : 'loading';

  return (
    <div className="page clips-page">
      <section className="hero panel">
        <div className="hero-main">
          <div className="eyebrow">Instant replay</div>
          <h2 className="hero-title">Say <span className="red">“{c.voice.phrase}”</span> or press <kbd>{c.hotkey || '—'}</kbd></h2>
          <p className="muted-text">Saves the last {c.seconds} seconds of {c.video.enabled ? 'your screen and ' : ''}game, chat and media audio{c.includeMic ? ' plus your mic' : ''}.</p>
          <div className="row-gap" style={{ marginTop: 14 }}>
            <button className="primary-btn big" disabled={!c.enabled || saving} onClick={async () => { setSaving(true); const r = await window.bsp.invoke('clip:save'); setSaving(false); setLast(r); setRefresh((x) => x + 1); }}><Icon.clip size={16} />{saving ? 'Saving…' : 'Save clip now'}</button>
            <button className="ghost-btn" onClick={() => window.bsp.invoke('clip:openDir', 'clips')}><Icon.folder size={14} />Open clips folder</button>
          </div>
          {last && <p className={`hint ${last.ok ? '' : 'warn-text'}`}>{last.ok ? `Saved ${last.path.split(/[\\/]/).pop()}${last.why ? ` — ${last.why}` : ''}${last.audio ? ` · desktop ${last.audio.deskDb} dB, mic ${last.audio.micDb} dB` : ''}${last.note ? ` (${last.note})` : ''}` : `Clip failed: ${last.error}`}</p>}
        </div>
        <div className="hero-status">
          <Stat label="Replay buffer" value={c.enabled ? `${Math.round(buffered)}s / ${c.seconds}s` : 'Off'} ok={c.enabled && buffered > 0} bar={c.enabled ? buffered / c.seconds : 0} />
          <Stat label="Screen capture" value={!c.enabled || !c.video.enabled ? 'Off' : med.videoRing ? `Recording · display ${c.video.display + 1}` : med.ffmpeg ? (med.ringError || 'Starting…') : 'ffmpeg not found'} ok={med.videoRing} warn={c.video.enabled && c.enabled && !med.videoRing} />
          <Stat label="Voice trigger" value={vState === 'listening' ? 'Listening (offline)' : vState === 'error' ? voice.error : vState === 'loading' ? 'Loading speech model…' : 'Off'} ok={vState === 'listening'} warn={vState === 'error'} pulse={vState === 'listening'} />
          {voice.heard && <div className="heard">Last heard: <i>“{voice.heard}”</i></div>}
        </div>
      </section>

      <section className="panel settings-strip">
        <div className="set">
          <Toggle on={c.enabled} onChange={(v) => update(['clips', 'enabled'], v)} label="Replay buffer" />
        </div>
        <div className="set"><span className="eyebrow">Clip length</span>
          <div className="chips">{LENGTHS.map((s) => <button key={s} className={`chip${c.seconds === s ? ' on' : ''}`} onClick={() => update(['clips', 'seconds'], s)}>{s < 60 ? `${s}s` : `${s / 60}m`}</button>)}</div></div>
        <div className="set"><span className="eyebrow">Hotkey</span>
          <button className={`key-btn${binding ? ' binding' : ''}`} onClick={() => setBinding(!binding)}>{binding ? 'Press keys… (Esc clears)' : c.hotkey || 'Not set'}</button></div>
        <div className="set"><span className="eyebrow">Voice phrase</span>
          <div className="row-gap"><Toggle small on={c.voice.enabled} onChange={(v) => update(['clips', 'voice', 'enabled'], v)} />
            <input className="text-input" value={phrase} onChange={(e) => setPhrase(e.target.value)} onBlur={() => phrase.trim() && phrase !== c.voice.phrase && update(['clips', 'voice', 'phrase'], phrase.trim().toLowerCase())} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} style={{ width: 130 }} /></div></div>
        <div className="set"><span className="eyebrow">Video</span>
          <div className="row-gap"><Toggle small on={c.video.enabled} onChange={(v) => update(['clips', 'video', 'enabled'], v)} />
            <Select value={String(c.video.display)} onChange={(v) => update(['clips', 'video', 'display'], Number(v || 0))} options={[0, 1, 2].map((i) => ({ value: String(i), label: `Display ${i + 1}` }))} />
            <Select value={String(c.video.fps)} onChange={(v) => update(['clips', 'video', 'fps'], Number(v || 60))} options={[30, 60].map((i) => ({ value: String(i), label: `${i} fps` }))} /></div></div>
        <div className="set"><span className="eyebrow">Audio</span>
          <div className="row-gap"><Toggle small on={c.includeMic} onChange={(v) => update(['clips', 'includeMic'], v)} label="My mic" /><Toggle small on={c.sound} onChange={(v) => update(['clips', 'sound'], v)} label="Saved sound" /></div></div>
      </section>

      <ClipAudio c={c} update={update} last={last} />

      <section className="panel lib-panel">
        <div className="row-between"><h3>Clips</h3><span className="muted-text small">{med.clipsDir}</span></div>
        <Library kind="clips" refreshKey={refresh} empty={`No clips yet — say “${c.voice.phrase}” or press ${c.hotkey}.`} />
      </section>
    </div>
  );
}

export function Stat({ label, value, ok, warn, bar, pulse }) {
  return (
    <div className="stat">
      <div className="row-between"><span className="eyebrow" style={{ margin: 0 }}>{label}</span><span className={`dot${ok ? ' ok' : warn ? ' warn' : ''}${pulse ? ' pulse' : ''}`} /></div>
      <div className={`stat-val${warn ? ' warn-text' : ''}`}>{value}</div>
      {bar !== undefined && <div className="stat-bar"><i style={{ width: `${Math.min(100, (bar || 0) * 100)}%` }} /></div>}
    </div>
  );
}

const dbOf = (pk) => (pk > 0.00001 ? Math.round(20 * Math.log10(pk)) : -99);
function ClipAudio({ c, update, last }) {
  const [lv, setLv] = useState({}); const [mx, setMx] = useState(null);
  useEffect(() => { const offs = [window.bsp.onLevels((d) => setLv(d.engine || {})), window.bsp.onMixer(setMx)]; return () => offs.forEach((f) => f()); }, []);
  const outs = mx?.outputs || [];
  const src = c.audioSource || 'auto';
  const using = lv.clipUsing === 'system' ? 'whole output device (loopback)' : 'per-app capture';
  return (
    <section className="panel clip-audio">
      <div className="set"><span className="eyebrow">Clip audio source</span>
        <div className="chips">
          {[['auto', 'Auto (apps, falls back to output)'], ['apps', 'Apps I hear (per-app)'], ['system', 'Everything on an output device']].map(([v, l]) => <button key={v} className={`chip${src === v ? ' on' : ''}`} onClick={() => update(['clips', 'audioSource'], v)}>{l}</button>)}
        </div>
        {src !== 'apps' && <Select value={c.systemDevice} onChange={(v) => update(['clips', 'systemDevice'], v)} options={[{ value: null, label: 'Windows default output' }, ...outs.map((o) => ({ value: o.id, label: o.name }))]} />}
      </div>
      <div className="set grow"><span className="eyebrow">Recording into the buffer right now</span>
        <div className="ca-meter"><span>Desktop</span><MiniMeter level={lv.clipDesk || 0} /><b className={dbOf(lv.clipDesk || 0) < -60 ? 'warn-text' : ''}>{dbOf(lv.clipDesk || 0)} dB</b></div>
        <div className="ca-meter"><span>Mic</span><MiniMeter level={c.includeMic ? lv.clipMic || 0 : 0} /><b>{c.includeMic ? `${dbOf(lv.clipMic || 0)} dB` : 'off'}</b></div>
        <p className="hint">Using {using}. Clips get 3 audio tracks: desktop + mic (default), desktop only, mic only. Levels follow your own mix — Streamer-mode stream faders don't affect clips.</p>
      </div>
    </section>
  );
}
