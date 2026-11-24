import React, { useRef, useCallback, useEffect, useState } from 'react';

// v2.3 meter ballistics: instant attack, ~0.9 s fall from full scale (in the sqrt/display domain), 60 fps.
export function useBallistics(level) {
  const target = Math.min(1, Math.sqrt(Math.max(0, level || 0)));
  const [shown, setShown] = useState(target); const cur = useRef(target); const raf = useRef(0); const last = useRef(0);
  useEffect(() => {
    if (target >= cur.current) { cur.current = target; setShown(target); return; }
    const step = (t) => {
      const dt = last.current ? Math.min(0.1, (t - last.current) / 1000) : 1 / 60; last.current = t;
      cur.current = Math.max(target, cur.current - dt * 1.1); setShown(cur.current);
      raf.current = cur.current > target ? requestAnimationFrame(step) : 0;
    };
    last.current = 0; cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target]);
  return shown;
}

export function Fader({ value, onChange, disabled, height = 230, red = true }) {
  const ref = useRef(null);
  const setFrom = useCallback((clientY) => {
    const r = ref.current.getBoundingClientRect();
    const v = 1 - (clientY - r.top - 8) / (r.height - 16);
    onChange(Math.round(Math.max(0, Math.min(1, v)) * 100) / 100);
  }, [onChange]);
  const down = (e) => {
    if (disabled) return; e.preventDefault(); setFrom(e.clientY);
    const move = (ev) => setFrom(ev.clientY);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const wheel = (e) => { if (!disabled) onChange(Math.max(0, Math.min(1, Math.round((value + (e.deltaY < 0 ? 0.02 : -0.02)) * 100) / 100))); };
  const pct = Math.round(value * 100);
  return (
    <div className={`fader${disabled ? ' disabled' : ''}${red ? '' : ' silver'}`} style={{ height }} ref={ref} onPointerDown={down} onWheel={wheel}
      role="slider" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'ArrowUp') onChange(Math.min(1, value + 0.01)); if (e.key === 'ArrowDown') onChange(Math.max(0, value - 0.01)); }}>
      <div className="fader-ticks">{Array.from({ length: 11 }).map((_, i) => <span key={i} />)}</div>
      <div className="fader-track"><div className="fader-fill" style={{ height: `${pct}%` }} /></div>
      <div className="fader-cap" style={{ bottom: `calc((100% - 16px) * ${value})` }}><i /></div>
    </div>
  );
}

export function Meter({ level = 0, height = 230, muted }) {
  // muted: still shows the source's own activity, greyed, so you can see who is making sound
  const segs = 28; const lit = Math.round(useBallistics(level) * segs);
  return (
    <div className={`meter${muted ? ' muted' : ''}`} style={{ height }}>
      {Array.from({ length: segs }).map((_, i) => {
        const idx = segs - 1 - i; const on = idx < lit;
        const zone = idx > segs * 0.86 ? 'hot' : idx > segs * 0.66 ? 'warm' : 'ok';
        return <span key={i} className={`seg ${zone}${on ? ' on' : ''}`} />;
      })}
    </div>
  );
}

export function HSlider({ value, onChange, disabled }) {
  return (
    <input className="hslider" type="range" min={0} max={100} value={Math.round(value * 100)} disabled={disabled}
      style={{ '--p': `${Math.round(value * 100)}%` }} onChange={(e) => onChange(Number(e.target.value) / 100)} />
  );
}

export function Toggle({ on, onChange, label, small }) {
  return (
    <button type="button" className={`toggle${on ? ' on' : ''}${small ? ' small' : ''}`} onClick={() => onChange(!on)} aria-pressed={on}>
      <span className="toggle-knob" />{label ? <span className="toggle-label">{label}</span> : null}
    </button>
  );
}

export function Select({ value, onChange, options, className = '' }) {
  return (
    <div className={`select ${className}`}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {options.map((o) => <option key={o.value ?? ''} value={o.value ?? ''}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function MiniMeter({ level = 0, muted }) {
  const v = useBallistics(level);
  return <div className={`minimeter${muted ? ' muted' : ''}`}><i style={{ width: `${v * 100}%` }} /></div>;
}
