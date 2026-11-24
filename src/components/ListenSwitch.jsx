import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import { Select } from './Controls.jsx';

const short = (n) => String(n || '').replace(/\s*\(.*$/, '');
const sub = (n) => (/\(([^)]*)\)/.exec(n || '') || [])[1] || '';
const GENERIC = /^(speakers|headphones|headset|headset earphone|digital output|digital audio|line out|realtek digital output)$/i;
// "Speakers (VR Headset)" -> "VR Headset"; "Headphones (USB Headset)" -> "USB Headset"; other names keep their own label
export const nice = (n) => { const a = short(n); const b = sub(n).replace(/^\d+\s*-\s*/, ''); return GENERIC.test(a) && b ? b : a; };
const kind = (n) => { const a = short(n); return GENERIC.test(a) ? a : sub(n); };
const icon = (n) => (/headphone|headset|earphone|g435|arctis|hyperx/i.test(n) ? Icon.headset : /vive|index|quest|oculus|rift|vr/i.test(n) ? Icon.vr : Icon.speaker);

// Shared state hook: listening device, options, presets; refreshes on every mixer push and after a switch.
export function useListen() {
  const [L, setL] = useState(null); const [toast, setToast] = useState(null);
  const load = () => window.bsp.invoke('listen:get').then(setL);
  useEffect(() => {
    load();
    const offs = [window.bsp.onMixer(() => load()), window.bsp.onListen((r) => { setToast(r); load(); setTimeout(() => setToast(null), 6000); }), window.bsp.onListenMissing((r) => setToast({ ok: false, error: `“${short(r.name)}” was disconnected. Windows fell back to another device; Blur Sounds Pro will switch back when it returns.` }))];
    return () => offs.forEach((f) => f());
  }, []);
  const pick = async (id) => { const r = await window.bsp.invoke('listen:set', id); if (!r.ok && r.error !== 'busy') setToast(r); load(); return r; };
  return { L, pick, toast, setToast, reload: load };
}

// Top-bar quick switch
export function ListenQuick() {
  const { L, pick } = useListen(); const [open, setOpen] = useState(false); const ref = useRef(null);
  useEffect(() => { const f = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, []);
  if (!L) return null;
  const cur = L.options.find((o) => o.id === L.current); const I = icon(cur ? cur.name : '');
  const have = new Set(L.options.map((o) => o.id));
  return (
    <div className="listen-quick" ref={ref}>
      <button className={`pill listen-pill${open ? ' open' : ''}`} onClick={() => setOpen(!open)} title="Listening device: one click moves Windows, Blur Sounds Pro and your apps">
        <I size={13} /><span>{cur ? nice(cur.name) : 'Pick output'}</span><b>▾</b>
      </button>
      {open && (
        <div className="listen-menu">
          {L.presets.length > 0 && <div className="listen-menu-head">Presets</div>}
          {L.presets.map((p) => (
            <button key={'p' + p.deviceId + p.name} disabled={!have.has(p.deviceId)} className={L.current === p.deviceId ? 'on' : ''} onClick={async () => { setOpen(false); await pick(p.deviceId); }}>
              <span>{p.name}</span><small>{have.has(p.deviceId) ? nice(p.deviceName) : 'not connected'}</small></button>))}
          <div className="listen-menu-head">Devices</div>
          {L.options.map((o) => { const DI = icon(o.name); return (
            <button key={o.id} className={L.current === o.id ? 'on' : ''} onClick={async () => { setOpen(false); await pick(o.id); }}>
              <span><DI size={13} /> {nice(o.name)}</span><small>{kind(o.name)}</small></button>); })}
          <button className="listen-next" onClick={async () => { setOpen(false); await window.bsp.invoke('listen:cycle'); }}>Next device{L.hotkey ? <small>{L.hotkey}</small> : null}</button>
        </div>
      )}
    </div>
  );
}

// Mixer panel: big device tiles + presets + hotkey
export function ListenPanel() {
  const { L, pick, toast } = useListen(); const [edit, setEdit] = useState(false); const [presets, setPresets] = useState([]); const [hk, setHk] = useState('');
  useEffect(() => { if (L && !edit) { setPresets(L.presets); setHk(L.hotkey || ''); } }, [L, edit]);
  if (!L) return null;
  const save = async () => { await window.bsp.invoke('listen:presets', presets.filter((p) => p.deviceId), hk); setEdit(false); };
  const captureKey = (e) => {
    e.preventDefault(); if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    if (e.key === 'Backspace' || e.key === 'Escape') return setHk('');
    const k = e.key.length === 1 ? e.key.toUpperCase() : e.key.replace(/^Arrow/, '');
    setHk([e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+'));
  };
  return (
    <section className="panel listen-panel">
      <div className="listen-row">
        <div className="listen-label" title="One click moves the Windows default (all roles), your Blur Sounds mix and mic monitor, and any app routed to the old device. Your stream cable is never touched."><div className="eyebrow">Listening on</div><small className="muted-text">all-in-one switch</small></div>
      <div className="listen-tiles">
        {L.presets.map((p) => { const here = L.options.some((o) => o.id === p.deviceId); const PI = icon(p.deviceName); return (
          <button key={'p' + p.name + p.deviceId} disabled={!here} className={`listen-tile preset${L.current === p.deviceId ? ' on' : ''}`} onClick={() => pick(p.deviceId)}>
            <PI size={16} /><b>{p.name}</b><small>{here ? nice(p.deviceName) : 'not connected'}</small></button>); })}
        {L.options.filter((o) => !L.presets.some((p) => p.deviceId === o.id)).map((o) => { const DI = icon(o.name); return (
          <button key={o.id} className={`listen-tile${L.current === o.id ? ' on' : ''}`} onClick={() => pick(o.id)}>
            <DI size={16} /><b>{nice(o.name)}</b><small>{kind(o.name)}</small></button>); })}
      </div>
        <button className="ghost-btn" onClick={() => setEdit(!edit)}>{edit ? 'Close' : 'Presets & hotkey'}</button>
      </div>
      {toast && <p className={`hint listen-toast${toast.ok ? ' ok' : ' bad'}`}>{toast.ok ? <>Now listening on <b>{nice(toast.name)}</b> · moved: {toast.changes.join(' · ')}</> : toast.error}</p>}
      {edit && (
        <div className="listen-edit">
          {presets.map((p, i) => (
            <div key={i} className="chan-row">
              <input className="text-input" value={p.name} onChange={(e) => setPresets(presets.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Select className="grow" value={p.deviceId} onChange={(v) => setPresets(presets.map((x, j) => (j === i ? { ...x, deviceId: v, deviceName: (L.options.find((o) => o.id === v) || {}).name || '' } : x)))}
                options={[{ value: null, label: 'Pick a device…' }, ...L.options.map((o) => ({ value: o.id, label: o.name })), ...(p.deviceId && !L.options.some((o) => o.id === p.deviceId) ? [{ value: p.deviceId, label: `${p.deviceName} (not connected)` }] : [])]} />
              <button className="icon-btn" title="Remove" onClick={() => setPresets(presets.filter((_, j) => j !== i))}><Icon.trash size={14} /></button>
            </div>))}
          <div className="row-gap">
            <button className="ghost-btn" disabled={presets.length >= 8} onClick={() => setPresets([...presets, { name: presets.length === 0 ? 'Headphones' : presets.length === 1 ? 'Speakers' : 'Preset ' + (presets.length + 1), deviceId: L.current, deviceName: (L.options.find((o) => o.id === L.current) || {}).name || '' }])}><Icon.plus size={14} />Add preset</button>
            <label className="hotkey-field">Cycle hotkey <input className="text-input" readOnly value={hk} placeholder="Click, then press keys" onKeyDown={captureKey} /></label>
            <span className="spacer" />
            <button className="primary-btn" onClick={save}>Save</button>
          </div>
          <p className="hint">The hotkey cycles through your presets (or every device if you have fewer than two). The tray icon has a “Listen on” menu too.</p>
        </div>
      )}
    </section>
  );
}
