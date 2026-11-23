import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import Drawer from './Drawer.jsx';

const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : (b / 1e6).toFixed(1) + ' MB');
const fmtT = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}${s < 60 ? '.' + Math.floor((s % 1) * 10) : ''}`; };
const fmtDate = (ms) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function Library({ kind, refreshKey, empty }) {
  const [lib, setLib] = useState({ items: [] });
  const [open, setOpen] = useState(null);
  const load = () => window.bsp.invoke('clip:library', kind).then((r) => r && setLib(r));
  useEffect(() => { load(); }, [kind, refreshKey]);
  return (
    <>
      <div className="lib-grid">
        {lib.items.length === 0 && <div className="apps-empty lib-empty">{empty}</div>}
        {lib.items.map((it) => (
          <button key={it.file} className="lib-card" onClick={() => setOpen(it)}>
            <div className="lib-thumb">
              {it.thumb ? <img src={window.bsp.fileUrl(it.thumb)} alt="" /> : <div className="lib-ph">{it.ext === 'm4a' || it.ext === 'wav' ? <Icon.voice size={28} /> : <Icon.clip size={28} />}</div>}
              <span className="lib-ext">{it.ext.toUpperCase()}</span>
            </div>
            <div className="lib-meta"><div className="lib-name" title={it.name}>{it.name}</div><div className="muted-text small">{fmtDate(it.mtime)} · {fmtSize(it.size)}</div></div>
          </button>
        ))}
      </div>
      {open && <Viewer item={open} onClose={() => setOpen(null)} onChanged={(f) => { load(); if (f === null) setOpen(null); else if (f) setOpen((o) => ({ ...o, file: f, name: f.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') })); }} />}
    </>
  );
}

function Viewer({ item, onClose, onChanged }) {
  const ref = useRef(null);
  const [dur, setDur] = useState(0); const [t, setT] = useState(0);
  const [a, setA] = useState(0); const [b, setB] = useState(0);
  const [name, setName] = useState(item.name);
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState('');
  const isAudio = ['m4a', 'wav'].includes(item.ext);
  useEffect(() => { setName(item.name); }, [item.file]);
  const onMeta = () => { const d = ref.current.duration || 0; setDur(d); setA(0); setB(d); };
  const Tag = isAudio ? 'audio' : 'video';
  return (
    <Drawer title={item.name} sub={item.file} onClose={onClose} wide>
      <div className="viewer">
        <Tag ref={ref} src={window.bsp.fileUrl(item.file)} controls onLoadedMetadata={onMeta} onTimeUpdate={(e) => { setT(e.target.currentTime); if (b && e.target.currentTime > b && !e.target.paused && busy === 'preview') { e.target.pause(); setBusy(''); } }} className={isAudio ? 'viewer-audio' : 'viewer-video'} />
      </div>
      <h4 className="drawer-sub">Trim</h4>
      <div className="trim">
        <div className="trim-bar">
          <div className="trim-sel" style={{ left: `${dur ? (a / dur) * 100 : 0}%`, right: `${dur ? 100 - (b / dur) * 100 : 0}%` }} />
          <div className="trim-head" style={{ left: `${dur ? (t / dur) * 100 : 0}%` }} />
          <input type="range" min={0} max={dur || 1} step={0.05} value={a} onChange={(e) => { const v = Math.min(Number(e.target.value), b - 0.2); setA(v); if (ref.current) ref.current.currentTime = v; }} className="trim-in a" />
          <input type="range" min={0} max={dur || 1} step={0.05} value={b} onChange={(e) => { const v = Math.max(Number(e.target.value), a + 0.2); setB(v); if (ref.current) ref.current.currentTime = v; }} className="trim-in b" />
        </div>
        <div className="row-between">
          <span className="mono">{fmtT(a)} → {fmtT(b)} · {fmtT(b - a)} of {fmtT(dur)}</span>
          <div className="row-gap">
            <button className="ghost-btn" onClick={() => setA(Math.min(t, b - 0.2))}>Set start here</button>
            <button className="ghost-btn" onClick={() => setB(Math.max(t, a + 0.2))}>Set end here</button>
            <button className="ghost-btn" onClick={() => { ref.current.currentTime = a; ref.current.play(); setBusy('preview'); }}><Icon.play size={14} />Preview</button>
            <button className="primary-btn" disabled={!!busy && busy !== 'preview' || !dur || (a < 0.05 && b > dur - 0.05)} onClick={async () => { setBusy('trim'); setMsg('Saving trimmed copy…'); const r = await window.bsp.invoke('clip:trim', item.file, a, b); setBusy(''); setMsg(r?.ok ? 'Saved a trimmed copy — the original is untouched.' : `Trim failed: ${r?.error}`); onChanged(); }}><Icon.scissors size={14} />Save trimmed copy</button>
          </div>
        </div>
      </div>
      {!isAudio && <Share item={item} a={a} b={b} dur={dur} trimmed={dur > 0 && (a > 0.05 || b < dur - 0.05)} />}
      <h4 className="drawer-sub">File</h4>
      <div className="row-gap wrap">
        <input className="text-input grow" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
        <button className="ghost-btn" disabled={name === item.name || !name.trim()} onClick={async () => { const r = await window.bsp.invoke('clip:rename', item.file, name); if (r?.ok) { onChanged(r.file); setMsg('Renamed.'); } else setMsg(r?.error || 'Rename failed'); }}>Rename</button>
        <button className="ghost-btn" onClick={() => window.bsp.invoke('clip:reveal', item.file)}><Icon.folder size={14} />Show in folder</button>
        <button className="ghost-btn danger-btn" onClick={async () => { if (ref.current) ref.current.pause(); await window.bsp.invoke('clip:delete', item.file); onChanged(null); }}><Icon.trash size={14} />Move to Recycle Bin</button>
      </div>
      {msg && <p className="hint">{msg}</p>}
    </Drawer>
  );
}

const PLATFORM_ICON = { Discord: '#5865f2', TikTok: '#fe2c55', 'YouTube Shorts': '#ff0033', YouTube: '#ff0033', Twitch: '#9146ff', X: '#e7e9ea', 'Instagram Reels': '#d62976', Custom: '#9aa3ad' };
function Share({ item, a, b, dur, trimmed }) {
  const [cfg, setCfg] = useState(null); const [o, setO] = useState({ preset: 'discord10', audio: 'mix', encoder: 'auto', shape: '', targetMB: 25, height: 1080, fps: 60, vKbps: 10000, codec: 'h264', useTrim: true });
  const [running, setRunning] = useState(false); const [pl, setPl] = useState(null); const [prog, setProg] = useState(null); const [res, setRes] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { window.bsp.invoke('share:presets').then((r) => { if (!r) return; setCfg(r); if (r.last) setO((x) => ({ ...x, ...Object.fromEntries(Object.entries(r.last).filter(([, v]) => v != null)), shape: '' })); }); return window.bsp.onShare ? window.bsp.onShare(setProg) : undefined; }, []);
  const opts = { ...o, shape: o.shape || undefined, start: o.useTrim && trimmed ? a : 0, end: o.useTrim && trimmed ? b : 0 };
  useEffect(() => { const t = setTimeout(() => window.bsp.invoke('share:plan', item.file, opts).then((r) => setPl(r && r.ok ? r : null)), 250); return () => clearTimeout(t); }, [item.file, JSON.stringify(opts)]);
  if (!cfg) return null;
  const P = cfg.presets.find((x) => x.id === o.preset) || cfg.presets[0];
  const set = (k, v) => setO((x) => ({ ...x, [k]: v }));
  const tracks = pl?.src?.audio || [];
  const go = async () => { setRes(null); setErr(''); setRunning(true); setProg({ stage: 'Starting', pct: 0 }); const r = await window.bsp.invoke('share:export', item.file, opts); setRunning(false); if (r?.ok) setRes(r); else if (!r?.canceled) setErr(r?.error || 'Export failed'); setProg(null); };
  return (
    <>
      <h4 className="drawer-sub">Share / export</h4>
      <div className="share">
        <div className="share-tiles">
          {cfg.presets.map((p) => (
            <button key={p.id} className={`share-tile${o.preset === p.id ? ' on' : ''}`} onClick={() => { set('preset', p.id); set('shape', ''); setRes(null); setErr(''); }}>
              <span className="share-dot" style={{ background: PLATFORM_ICON[p.label] || '#888' }} /><b>{p.label}</b><span>{p.sub}</span>
            </button>
          ))}
        </div>
        <div className="share-opts">
          <label><span>Framing</span><select className="app-move wide" value={o.shape || P.shape} onChange={(e) => set('shape', e.target.value)}>{cfg.shapes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <label><span>Audio</span><select className="app-move wide" value={o.audio} onChange={(e) => set('audio', e.target.value)}>
            <option value="mix">{tracks[0]?.title || 'Desktop + mic'}</option>{tracks.length > 1 && <option value="desktop">Desktop only</option>}{tracks.length > 2 && <option value="mic">Mic only</option>}<option value="none">No audio</option></select></label>
          <label><span>Encoder</span><select className="app-move wide" value={o.encoder} onChange={(e) => set('encoder', e.target.value)}><option value="auto">Auto (AMD GPU → x264)</option><option value="hardware">AMD GPU only (fast)</option><option value="software">x264 two-pass (exact size)</option></select></label>
          {o.preset === 'custom' && <>
            <label><span>Target size (MB, 0 = none)</span><input className="opt-text" type="number" min={0} value={o.targetMB} onChange={(e) => set('targetMB', Number(e.target.value))} /></label>
            <label><span>Height</span><select className="app-move wide" value={o.height} onChange={(e) => set('height', Number(e.target.value))}>{[360, 480, 720, 1080, 1440, 1920].map((h) => <option key={h} value={h}>{h}p</option>)}</select></label>
            <label><span>FPS</span><select className="app-move wide" value={o.fps} onChange={(e) => set('fps', Number(e.target.value))}>{[24, 30, 60].map((h) => <option key={h} value={h}>{h}</option>)}</select></label>
            <label><span>Codec</span><select className="app-move wide" value={o.codec} onChange={(e) => set('codec', e.target.value)}><option value="h264">H.264 (plays everywhere)</option><option value="hevc">HEVC (smaller)</option></select></label>
            {!(o.targetMB > 0) && <label><span>Video bitrate (kbps)</span><input className="opt-text" type="number" min={300} value={o.vKbps} onChange={(e) => set('vKbps', Number(e.target.value))} /></label>}
          </>}
          {trimmed && <label className="share-trim"><input type="checkbox" checked={o.useTrim} onChange={(e) => set('useTrim', e.target.checked)} /><span>Use trim ({fmtT(a)} → {fmtT(b)})</span></label>}
        </div>
        <div className="share-est">
          {pl ? <>
            <div><span>Estimated size</span><b>{fmtSize(pl.estBytes)}</b>{pl.sizeBytes ? <i>limit {fmtSize(pl.sizeBytes)}</i> : null}</div>
            <div><span>Video</span><b>{pl.W}×{pl.H} · {pl.fps} fps</b><i>{(pl.vKbps / 1000).toFixed(1)} Mbps</i></div>
            <div><span>Length</span><b>{fmtT(pl.dur)}</b><i>{pl.hasAudio ? `${pl.aKbps} kbps audio` : 'no audio'}</i></div>
          </> : <div className="muted-text">Working out size…</div>}
        </div>
        {pl?.warnings?.map((w, i) => <p key={i} className="hint warn-text">{w}</p>)}
        {running && prog ? (
          <div className="share-prog"><div className="share-bar"><div style={{ width: `${prog.pct || 0}%` }} /></div><span>{prog.stage} · {Math.round(prog.pct || 0)}%</span><button className="ghost-btn" onClick={() => window.bsp.invoke('share:cancel')}>Cancel</button></div>
        ) : <div className="row-gap"><button className="primary-btn" onClick={go}><Icon.send size={14} />Export for {P.label}{P.sizeBytes ? ` (${P.sub.split(' (')[0]})` : ''}</button><span className="muted-text small">Saved to Clips › Exports · copied to clipboard so you can paste it</span></div>}
        {err && <p className="hint warn-text">{err}</p>}
        {res && (
          <div className="share-done">
            <div><b>✓ {fmtSize(res.size)}</b> · {res.plan.W}×{res.plan.H} {res.plan.fps}fps · {res.encoder} · {res.seconds.toFixed(0)}s{res.copied ? ' · copied — press Ctrl+V in Discord' : ''}</div>
            <div className="row-gap wrap">
              <button className="ghost-btn" onClick={async () => setRes({ ...res, copied: await window.bsp.invoke('share:copy', res.file) })}>Copy file</button>
              <button className="ghost-btn" onClick={() => window.bsp.invoke('clip:reveal', res.file)}><Icon.folder size={14} />Show in folder</button>
              {res.url && <button className="ghost-btn" onClick={() => window.bsp.invoke('share:open', res.url)}>Open {P.label}{res.url.startsWith('http') ? ' upload page' : ''}</button>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
