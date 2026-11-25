// v2.5.2 "Calibrate from my voice": read a few sentences, get personal presets for every voice, ranked.
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import { MiniMeter } from './Controls.jsx';

// Harvard sentences (public domain) plus a question and an exclamation so your natural intonation range is captured.
const LINES = [
  'The birch canoe slid on the smooth planks.',
  'Glue the sheet to the dark blue background.',
  'Wait, are you seriously coming with us tonight?',
  'It\'s easy to tell the depth of a well.',
  'These days a chicken leg is a rare dish.',
  'No way, that was the best round we\'ve ever played!',
  'Rice is often served in round bowls.',
  'The juice of lemons makes fine punch.',
  'Hello everyone, welcome back to the stream.',
  'Four hours of steady work faced us.',
];
const MIN_SEC = 20, MAX_SEC = 32;
const lvl = { ok: '✓', warn: '!', fail: '✕' };

let player = null;
function play(url, onEnd) { try { if (player) { player.pause(); player.onended = null; } player = new Audio(url); player.onended = onEnd; player.play(); } catch {} }
function stop() { try { if (player) player.pause(); } catch {} player = null; }

export default function Calibrate({ eng, voices, current, onApplied }) {
  const [cs, setCs] = useState(null);
  const [rec, setRec] = useState(null); // { sec, peak }
  const [line, setLine] = useState(0);
  const [err, setErr] = useState('');
  const [playing, setPlaying] = useState('');
  const [names, setNames] = useState({});
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(null); const [other, setOther] = useState(false);
  const timer = useRef(null); const done = useRef(true); const maxT = useRef(null);
  useEffect(() => {
    window.bsp.invoke('vc:calState').then(setCs);
    const off = window.bsp.onVcCalib && window.bsp.onVcCalib(setCs);
    return () => { off && off(); clearInterval(timer.current); clearTimeout(maxT.current); stop(); };
  }, []);
  if (!cs) return null;
  const res = cs.result; const running = cs.running;
  const start = async () => {
    setErr(''); stop(); setLine(0);
    const r = await window.bsp.invoke('vc:calRecStart'); if (!r || !r.ok) { setErr((r && r.error) || 'Couldn\'t start recording.'); return; }
    done.current = false; setRec({ sec: 0, peak: 0 }); setOpen(true);
    clearInterval(timer.current);
    timer.current = setInterval(async () => {
      const s = await window.bsp.invoke('vc:calRecState'); if (!s) return;
      setRec({ sec: s.seconds, peak: s.peak });
      setLine(Math.min(LINES.length - 1, Math.floor(s.seconds / 3.2)));
      if (!s.recording) { clearInterval(timer.current); finish(); }
    }, 150);
    clearTimeout(maxT.current); maxT.current = setTimeout(() => stopRec(), MAX_SEC * 1000);
  };
  const stopRec = async () => { if (done.current) return; clearInterval(timer.current); clearTimeout(maxT.current); const r = await window.bsp.invoke('vc:calRecStop'); finish(r); };
  const finish = async (r) => {
    if (done.current) return; done.current = true; clearTimeout(maxT.current);
    setRec(null);
    if (r && r.seconds < 8) { setErr(`Only ${Math.round(r.seconds)} s recorded. Read at least ${MIN_SEC} seconds.`); return; }
    const st = await window.bsp.invoke('vc:calibrate'); setCs(st); if (st && st.error) setErr(st.error);
  };
  const cancelRec = async () => { done.current = true; clearInterval(timer.current); clearTimeout(maxT.current); await window.bsp.invoke('vc:calRecStop'); setRec(null); };
  const hear = (id, p) => { if (playing === id) { stop(); setPlaying(''); return; } setPlaying(id); play(window.bsp.fileUrl(p), () => setPlaying('')); };
  const save = async (c, apply) => { const st = await window.bsp.invoke('vc:presetSave', { key: c.key, name: names[c.key] || `My ${c.name}`, apply }); setCs(st); if (apply && onApplied) onApplied(); };
  const m = res && res.measure;
  const cands = (res && res.candidates) || [];
  const want = m ? (m.likely === 'male' ? 'F' : 'M') : 'F';
  const groups = [want, want === 'F' ? 'M' : 'F'].map((g) => ({ g, list: cands.filter((c) => c.gender === g).sort((a, b) => (b.score || 0) - (a.score || 0)) })).filter((x) => x.list.length);
  const tooShort = rec && rec.sec < MIN_SEC;
  const active = cs.personal && cs.personal.presetId;
  return (
    <section className="panel cal">
      <div className="row-between">
        <div><h4 className="drawer-sub">Calibrate from my voice</h4>
          <p className="hint">Read a few sentences (about 25 seconds). Blur Sounds Pro measures your pitch, range and voice resonances, tries every downloaded voice on your sample and builds a personal preset for each one. The recording never leaves this PC.</p></div>
        <div className="row-gap">
          {!rec && !running && <button className="primary-btn" onClick={start}><Icon.mic size={14} />{res && !res.deleted ? 'Re-calibrate' : 'Start calibration'}</button>}
          {(res || cs.presets.length > 0) && !rec && <button className="ghost-btn" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show results'}</button>}
        </div>
      </div>
      {err && <p className="warn-box">{err}</p>}

      {rec && <div className="cal-rec">
        <div className="cal-lines">{LINES.map((t, i) => <p key={i} className={i === line ? 'now' : i < line ? 'done' : ''}>{t}</p>)}</div>
        <div className="cal-side">
          <div className="cal-time"><b>{Math.floor(rec.sec)}</b><span>/ {MIN_SEC}–{MAX_SEC - 2} s</span></div>
          <div className="upd-bar"><i style={{ width: `${Math.min(100, (rec.sec / (MAX_SEC - 2)) * 100)}%` }} /></div>
          <div className="cal-meter"><span>Level</span><MiniMeter level={eng.micPre || 0} /></div>
          <p className="hint">{(rec.peak || 0) > 0.97 ? 'Too loud: it\'s clipping. Lower your mic level.' : (eng.micPre || 0) < 0.08 && rec.sec > 2 ? 'Speak up, or move closer to the mic.' : 'Read the highlighted line in your normal voice, like you\'re talking to friends.'}</p>
          <div className="row-gap"><button className="primary-btn" disabled={tooShort} onClick={stopRec}>{tooShort ? `Keep reading… ${Math.ceil(MIN_SEC - rec.sec)} s` : 'Done'}</button><button className="ghost-btn" onClick={cancelRec}>Cancel</button></div>
        </div>
      </div>}

      {running && <div className="vc-prog"><span>{running.stage} (about 30–60 s)</span><div className="upd-bar"><i style={{ width: `${Math.round((running.pct || 0) * 100)}%` }} /></div><span>{Math.round((running.pct || 0) * 100)}%</span></div>}

      {open && !rec && !running && m && <div className="cal-res">
        <div className="cal-checks">{(m.checks || []).map((c) => <span key={c.id} className={`cal-chk ${c.level}`}><i>{lvl[c.level]}</i>{c.text}</span>)}</div>
        {res.error && <p className="warn-box">{res.error}</p>}
        <div className="vc-stats cal-stats">
          <div><span>Your pitch</span><b>{m.medianHz ? `${Math.round(m.medianHz)} Hz` : '—'}</b></div>
          <div><span>Range</span><b>{m.p10Hz ? `${m.p10Hz}–${m.p90Hz} Hz` : '—'}</b></div>
          <div><span>Formants F1/F2/F3</span><b>{m.f1 ? `${m.f1} / ${m.f2} / ${m.f3 || '—'}` : '—'}</b></div>
          <div><span>Noise floor</span><b>{m.noiseDb != null ? `${Math.round(m.noiseDb)} dB` : '—'}</b></div>
          <div><span>Gate</span><b>{m.gateDb != null ? `${m.gateDb} dB` : 'off'}</b></div>
          <div><span>Sounds</span><b>{m.likely === 'male' ? 'lower (male)' : 'higher (female)'}</b></div>
        </div>
        {res.recommend && <p className="hint">{res.recommend.note}</p>}
        {res.deleted && <p className="hint">Your recording was deleted. Presets you saved keep working; re-calibrate to try voices again.</p>}
        {!res.deleted && groups.filter(({ g }) => g === want || other).map(({ g, list }) => <div key={g} className="cal-group">
          <h5>{g === 'F' ? 'Female voices' : 'Male voices'} {g === want ? <em>best match for you first</em> : null}</h5>
          {res.before && <button className={`chip${playing === 'before' ? ' on' : ''}`} onClick={() => hear('before', res.before)}>{playing === 'before' ? '■ Stop' : '▶ Before (your voice)'}</button>}
          {list.map((c, i) => <div key={c.key} className={`cal-cand${i === 0 && g === want ? ' best' : ''}`}>
            <span className="cal-rank">#{i + 1}</span>
            <div className="cal-name"><b>{c.name}</b><span>{c.preset.shift > 0 ? '+' : ''}{c.preset.shift} st · range ×{c.preset.rangeScale} · formant {c.preset.natFormant > 0 ? '+' : ''}{c.preset.natFormant}%</span></div>
            {c.score != null && <div className="cal-score" title={`Words kept ${Math.round((c.contentSim || 0) * 100)}% · pitch on target ${Math.round((c.pitchAcc || 0) * 100)}%`}><i style={{ width: `${c.score}%` }} /><span>{Math.round(c.score)}</span></div>}
            {c.preview && <button className={`chip${playing === c.key ? ' on' : ''}`} onClick={() => hear(c.key, c.preview)}>{playing === c.key ? '■ Stop' : '▶ After'}</button>}
            <input className="cal-input" value={names[c.key] ?? `My ${c.name}`} onChange={(e) => setNames({ ...names, [c.key]: e.target.value })} />
            <button className="ghost-btn" onClick={() => save(c, false)}>Save</button>
            <button className={i === 0 ? 'primary-btn' : 'ghost-btn'} onClick={() => save(c, true)}>Save & use</button>
          </div>)}
        </div>)}
        {!res.deleted && groups.length > 1 && <button className="chip" onClick={() => setOther(!other)}>{other ? 'Hide' : 'Show'} {want === 'F' ? 'male' : 'female'} voices too</button>}
      </div>}

      {cs.presets.length > 0 && <div className="cal-presets">
        <h5>My presets</h5>
        {cs.presets.map((p) => <div key={p.id} className={`cal-preset${active === p.id ? ' on' : ''}`}>
          {renaming === p.id
            ? <input className="cal-input" autoFocus defaultValue={p.name} onBlur={(e) => { window.bsp.invoke('vc:presetRename', p.id, e.target.value).then(setCs); setRenaming(null); }} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
            : <b onDoubleClick={() => setRenaming(p.id)} title="Double-click to rename">{p.name}</b>}
          <span>{p.voiceName} · your pitch {Math.round(p.userHz)} Hz → {p.targetHz} Hz</span>
          {active === p.id ? <span className="pill live"><i />In use</span> : <button className="chip" onClick={() => window.bsp.invoke('vc:presetApply', p.id).then((s) => { setCs(s); onApplied && onApplied(); })}>Use</button>}
          <button className="chip" onClick={() => setRenaming(p.id)}>Rename</button>
          <button className="chip" onClick={() => { if (confirm(`Delete the preset "${p.name}"?`)) window.bsp.invoke('vc:presetDelete', p.id).then(setCs); }}>Delete</button>
        </div>)}
        {active && <button className="ghost-btn" onClick={() => window.bsp.invoke('vc:personalOff').then(setCs)}>Stop using my calibration</button>}
      </div>}

      {(cs.hasSample || cs.presets.length > 0) && !rec && <div className="row-gap wrap cal-foot">
        <span className="muted-text small">Stored only on this PC{cs.hasSample ? ' (your recording, previews and presets)' : ' (presets only; your recording is deleted)'}.</span>
        {cs.hasSample && <button className="ghost-btn" onClick={() => { if (confirm('Delete your calibration recording and previews? Saved presets keep working.')) { stop(); window.bsp.invoke('vc:calDelete', {}).then(setCs); } }}>Delete my recording</button>}
        <button className="ghost-btn" onClick={() => { if (confirm('Delete the recording AND all personal presets?')) { stop(); window.bsp.invoke('vc:calDelete', { all: true }).then(setCs); } }}>Delete everything</button>
        <button className="ghost-btn" onClick={() => window.bsp.invoke('vc:calOpenFolder')}><Icon.folder size={14} />Folder</button>
      </div>}
    </section>
  );
}
