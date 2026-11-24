import React, { useMemo } from 'react';
import { Toggle } from './Controls.jsx';

export const EQ_PRESETS = {
  flat: { label: 'Flat', g: [0, 0, 0, 0, 0, 0, 0] },
  bass: { label: 'Bass boost', g: [0, 6, 2, 0, 0, 1, 0] },
  footsteps: { label: 'Footsteps (FPS)', g: [0, -4, -2, 1, 5, 3, 0] },
  immersive: { label: 'Immersive', g: [0, 4, 0, -1, 2, 4, 0] },
  voice: { label: 'Vocal clarity', g: [0, -4, -2, 1, 4, 2, 0] },
  treble: { label: 'Treble', g: [0, 0, 0, 0, 1, 6, 0] },
  bright: { label: 'Bright', g: [0, -1, 0, 0, 2, 5, 0] },
  warm: { label: 'Warm', g: [0, 3, 2, 0, -1, -2, 0] },
  broadcast: { label: 'Broadcast mic', g: [1, -2, -3, 1, 3, 2, 0], cut: 90 },
  podcast: { label: 'Podcast mic', g: [1, 2, -2, 0, 2, 1, 0], cut: 80 },
  demud: { label: 'De-mud mic', g: [1, 0, -5, 0, 2, 1, 0], cut: 100 },
};
export function applyPreset(eq, key) {
  const p = EQ_PRESETS[key]; if (!p) return eq;
  const bands = eq.bands.map((b, i) => ({ ...b, g: p.g[i] ?? 0, ...(i === 0 ? { on: !!p.cut, f: p.cut || b.f } : {}) }));
  return { ...eq, preset: key, enabled: key !== 'flat' ? true : eq.enabled, bands };
}

const FS = 48000;
function coeffs(b) {
  const A = Math.pow(10, b.g / 40), w = 2 * Math.PI * Math.min(b.f, FS * 0.45) / FS, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * Math.max(0.1, b.q));
  let B0, B1, B2, A0, A1, A2;
  if (b.type === 'lowshelf') { const s = 2 * Math.sqrt(A) * al; B0 = A * ((A + 1) - (A - 1) * cs + s); B1 = 2 * A * ((A - 1) - (A + 1) * cs); B2 = A * ((A + 1) - (A - 1) * cs - s); A0 = (A + 1) + (A - 1) * cs + s; A1 = -2 * ((A - 1) + (A + 1) * cs); A2 = (A + 1) + (A - 1) * cs - s; }
  else if (b.type === 'highshelf') { const s = 2 * Math.sqrt(A) * al; B0 = A * ((A + 1) + (A - 1) * cs + s); B1 = -2 * A * ((A - 1) + (A + 1) * cs); B2 = A * ((A + 1) + (A - 1) * cs - s); A0 = (A + 1) - (A - 1) * cs + s; A1 = 2 * ((A - 1) - (A + 1) * cs); A2 = (A + 1) - (A - 1) * cs - s; }
  else if (b.type === 'lowcut') { B0 = (1 + cs) / 2; B1 = -(1 + cs); B2 = (1 + cs) / 2; A0 = 1 + al; A1 = -2 * cs; A2 = 1 - al; }
  else if (b.type === 'highcut') { B0 = (1 - cs) / 2; B1 = 1 - cs; B2 = (1 - cs) / 2; A0 = 1 + al; A1 = -2 * cs; A2 = 1 - al; }
  else { B0 = 1 + al * A; B1 = -2 * cs; B2 = 1 - al * A; A0 = 1 + al / A; A1 = -2 * cs; A2 = 1 - al / A; }
  return [B0 / A0, B1 / A0, B2 / A0, A1 / A0, A2 / A0];
}
function magDb(cs, f) {
  const w = 2 * Math.PI * f / FS; let db = 0;
  for (const [b0, b1, b2, a1, a2] of cs) {
    const cr = Math.cos(w), ci = -Math.sin(w), c2r = Math.cos(2 * w), c2i = -Math.sin(2 * w);
    const nr = b0 + b1 * cr + b2 * c2r, ni = b1 * ci + b2 * c2i, dr = 1 + a1 * cr + a2 * c2r, di = a1 * ci + a2 * c2i;
    db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  return db;
}
const fx = (f, W) => (Math.log10(f / 20) / Math.log10(20000 / 20)) * W;

export function EqCurve({ eq, height = 130 }) {
  const W = 520, H = height, R = 15;
  const pathD = useMemo(() => {
    const cs = eq.bands.filter((b) => b.on !== false).map(coeffs);
    let d = '';
    for (let i = 0; i <= 160; i++) {
      const f = 20 * Math.pow(1000, i / 160);
      const db = eq.enabled ? magDb(cs, f) + (eq.preampDb || 0) : 0;
      const y = H / 2 - Math.max(-R, Math.min(R, db)) / R * (H / 2 - 6);
      d += `${i ? 'L' : 'M'}${fx(f, W).toFixed(1)},${y.toFixed(1)}`;
    }
    return d;
  }, [eq, H]);
  return (
    <svg className="eq-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {[50, 100, 200, 500, 1000, 2000, 5000, 10000].map((f) => <line key={f} x1={fx(f, W)} x2={fx(f, W)} y1="0" y2={H} className="grid" />)}
      {[-12, -6, 0, 6, 12].map((g) => <line key={g} x1="0" x2={W} y1={H / 2 - g / R * (H / 2 - 6)} y2={H / 2 - g / R * (H / 2 - 6)} className={g === 0 ? 'grid zero' : 'grid'} />)}
      <path d={`${pathD} L${W},${H} L0,${H} Z`} className="fill" />
      <path d={pathD} className="line" />
      {eq.bands.map((b, i) => b.on !== false && <circle key={i} cx={fx(b.f, W)} cy={H / 2 - Math.max(-R, Math.min(R, ['lowcut', 'highcut'].includes(b.type) ? 0 : b.g)) / R * (H / 2 - 6)} r="4" className="node" />)}
      {['50', '100', '200', '500', '1k', '2k', '5k', '10k'].map((t, i) => <text key={t} x={fx([50, 100, 200, 500, 1000, 2000, 5000, 10000][i], W) + 3} y={H - 4} className="lbl">{t}</text>)}
    </svg>
  );
}

const FLAT = [
  { type: 'lowcut', f: 30, g: 0, q: 0.7, on: false }, { type: 'lowshelf', f: 90, g: 0, q: 0.7, on: true }, { type: 'peak', f: 250, g: 0, q: 1.0, on: true },
  { type: 'peak', f: 1000, g: 0, q: 1.0, on: true }, { type: 'peak', f: 3000, g: 0, q: 1.0, on: true }, { type: 'highshelf', f: 9000, g: 0, q: 0.7, on: true }, { type: 'highcut', f: 20000, g: 0, q: 0.7, on: false },
];
const TYPES = { lowcut: 'Low cut', lowshelf: 'Low shelf', peak: 'Peak', highshelf: 'High shelf', highcut: 'High cut' };
export function EqEditor({ eq, onChange, mic }) {
  // v2.4.2: touching a band turns the EQ on (before, moving a slider did nothing until the toggle was switched on)
  const setBand = (i, patch) => onChange({ ...eq, enabled: true, preset: 'custom', bands: eq.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const order = mic ? ['flat', 'bass', 'voice', 'treble', 'broadcast', 'podcast', 'demud', 'warm'] : ['flat', 'bass', 'voice', 'footsteps', 'treble', 'immersive', 'warm'];
  const presets = order.map((k) => [k, EQ_PRESETS[k]]);
  const reset = () => onChange({ ...eq, preset: 'flat', preampDb: 0, bands: FLAT.map((b) => ({ ...b })) });
  return (
    <div className="eq">
      <div className="row-gap wrap">
        <Toggle on={eq.enabled} onChange={(v) => onChange({ ...eq, enabled: v })} label="Equalizer" />
        <span className="spacer" />
        <div className="chips">
          {presets.map(([k, p]) => <button key={k} className={`chip${eq.preset === k ? ' on' : ''}`} onClick={() => onChange(applyPreset(eq, k))}>{p.label}</button>)}
        </div>
        <button className="ghost-btn eq-reset" onClick={reset} title="All bands back to 0 dB">Reset</button>
      </div>
      <EqCurve eq={eq} />
      <div className="eq-bands">
        {eq.bands.map((b, i) => (
          <div key={i} className={`eq-band${b.on === false ? ' off' : ''}`}>
            <label className="eq-band-head"><input type="checkbox" checked={b.on !== false} onChange={(e) => setBand(i, { on: e.target.checked })} />{TYPES[b.type]}</label>
            {!['lowcut', 'highcut'].includes(b.type) && <>
              <input type="range" className="vrange" min={-12} max={12} step={0.5} value={b.g} onChange={(e) => setBand(i, { g: Number(e.target.value) })} />
              <span className="eq-val">{b.g > 0 ? '+' : ''}{b.g} dB</span>
            </>}
            <input className="eq-num" type="number" value={Math.round(b.f)} min={20} max={20000} onChange={(e) => setBand(i, { f: Number(e.target.value) || b.f })} />
            <span className="eq-unit">Hz</span>
            {b.type === 'peak' && <input className="eq-num" type="number" step={0.1} min={0.2} max={10} value={b.q} onChange={(e) => setBand(i, { q: Number(e.target.value) || 1 })} title="Q" />}
          </div>
        ))}
      </div>
    </div>
  );
}
