import React, { useEffect, useState } from 'react';
import { Icon } from '../components/Icons.jsx';
import { HSlider, Toggle } from '../components/Controls.jsx';

export function keyToAccel(e) {
  const k = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl'); if (e.altKey) mods.push('Alt'); if (e.shiftKey) mods.push('Shift');
  let key = k.length === 1 ? k.toUpperCase() : k;
  if (key === ' ') key = 'Space';
  if (/^Numpad/.test(e.code)) key = 'num' + e.code.replace('Numpad', '').toLowerCase();
  if (key === 'Escape') return '';
  return [...mods, key].join('+');
}

export default function Soundboard({ settings, update, setSettings }) {
  const sb = settings.soundboard;
  const [outs, setOuts] = useState([]);
  const [binding, setBinding] = useState(null);
  const [flash, setFlash] = useState(null);
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then((d) => setOuts(d.filter((x) => x.kind === 'audiooutput' && x.deviceId !== 'default' && x.deviceId !== 'communications'))).catch(() => {});
    const f = (e) => { setFlash(e.detail); setTimeout(() => setFlash(null), 300); };
    window.addEventListener('bsp-sound', f);
    const off = window.bsp.onHotkeyErrors(setErrors);
    return () => { window.removeEventListener('bsp-sound', f); off(); };
  }, []);

  useEffect(() => {
    if (!binding) return;
    const h = (e) => {
      e.preventDefault(); const acc = keyToAccel(e); if (acc === null) return;
      if (binding === '__stop') update(['soundboard', 'stopHotkey'], acc);
      else update(['soundboard', 'sounds'], sb.sounds.map((s) => s.id === binding ? { ...s, hotkey: acc } : s));
      setBinding(null);
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [binding, sb]);

  const add = async () => { const sounds = await window.bsp.invoke('sound:add'); setSettings({ ...settings, soundboard: { ...sb, sounds } }); };
  const remove = async (id) => { const sounds = await window.bsp.invoke('sound:remove', id); setSettings({ ...settings, soundboard: { ...sb, sounds } }); };

  return (
    <div className="page">
      <section className="panel sb-bar">
        <div className="sb-field">
          <div className="eyebrow">Play into</div>
          <div className="select grow"><select value={sb.outputLabel} onChange={(e) => update(['soundboard', 'outputLabel'], e.target.value)}>
            <option value="">Windows default output</option>
            {outs.map((o) => <option key={o.deviceId} value={o.label}>{o.label}</option>)}
          </select></div>
        </div>
        <div className="sb-field"><div className="eyebrow">Hear it yourself</div><Toggle on={sb.monitor} onChange={(v) => update(['soundboard', 'monitor'], v)} label="Monitor on default output" /></div>
        <div className="sb-field narrow"><div className="eyebrow">Board volume · {Math.round(sb.volume * 100)}</div><HSlider value={sb.volume} onChange={(v) => update(['soundboard', 'volume'], v)} /></div>
        <div className="sb-field narrow">
          <div className="eyebrow">Stop all hotkey</div>
          <button className={`hotkey${binding === '__stop' ? ' binding' : ''}`} onClick={() => setBinding('__stop')}>{binding === '__stop' ? 'Press keys…' : sb.stopHotkey || 'Set hotkey'}</button>
        </div>
        <button className="ghost-btn" onClick={() => window.__bspStop && window.__bspStop()}><Icon.stop size={14} />Stop all</button>
        <button className="primary-btn" onClick={add}><Icon.plus size={16} />Add sounds</button>
      </section>
      <p className="hint pad">Tip: pick “CABLE Input (VB-Audio Virtual Cable)” to play sounds into a virtual mic. Hotkeys work while VRChat or any other app is focused. Esc clears a hotkey.</p>
      {errors.length > 0 && <p className="hint pad warn-text">These hotkeys are in use by another app: {errors.join(', ')}</p>}
      <section className="pads">
        {sb.sounds.length === 0 && <div className="empty-state panel"><Icon.pads size={34} /><h2>No sounds yet</h2><p>Add MP3, WAV, OGG or FLAC files, then give each one a hotkey.</p></div>}
        {sb.sounds.map((s) => (
          <div key={s.id} className={`pad panel${flash === s.id ? ' flash' : ''}`}>
            <button className="pad-play" onClick={() => window.__bspPlay && window.__bspPlay(s.id)}><Icon.play size={26} /></button>
            <input className="pad-name" value={s.name} onChange={(e) => update(['soundboard', 'sounds'], sb.sounds.map((x) => x.id === s.id ? { ...x, name: e.target.value } : x))} />
            <div className="pad-row">
              <button className={`hotkey${binding === s.id ? ' binding' : ''}`} onClick={() => setBinding(s.id)}>{binding === s.id ? 'Press keys…' : s.hotkey || 'Set hotkey'}</button>
              <button className="icon-btn tiny" onClick={() => remove(s.id)} title="Remove"><Icon.trash size={14} /></button>
            </div>
            <HSlider value={s.volume ?? 1} onChange={(v) => update(['soundboard', 'sounds'], sb.sounds.map((x) => x.id === s.id ? { ...x, volume: v } : x))} />
          </div>
        ))}
      </section>
    </div>
  );
}
