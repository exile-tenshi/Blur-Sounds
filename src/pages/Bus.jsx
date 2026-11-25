// v2.6.0 Bus mixer: Voicemeeter-style strips x buses, in plain words.
import React, { useEffect, useState } from 'react';
import { Icon } from '../components/Icons.jsx';
import { Toggle, Select, Meter, Fader } from '../components/Controls.jsx';
import { EqEditor } from '../components/Eq.jsx';

const FLAT = () => ({ enabled: false, preset: 'flat', preampDb: 0, bands: [
  { type: 'lowcut', f: 30, g: 0, q: 0.7, on: false }, { type: 'lowshelf', f: 90, g: 0, q: 0.7, on: true }, { type: 'peak', f: 250, g: 0, q: 1, on: true },
  { type: 'peak', f: 1000, g: 0, q: 1, on: true }, { type: 'peak', f: 3000, g: 0, q: 1, on: true }, { type: 'highshelf', f: 9000, g: 0, q: 0.7, on: true }, { type: 'highcut', f: 20000, g: 0, q: 0.7, on: false }] });
const okEq = (eq) => (eq && Array.isArray(eq.bands) ? eq : FLAT());
export const BUS_INFO = {
  A1: { name: 'A1', title: 'You hear', sub: 'your headphones / speakers' },
  A2: { name: 'A2', title: 'Hardware 2', sub: 'a second output (e.g. VR headset)' },
  A3: { name: 'A3', title: 'Hardware 3', sub: 'a third output' },
  B1: { name: 'B1', title: 'Mic cable', sub: 'what Discord / VRChat hear' },
  B2: { name: 'B2', title: 'Stream', sub: 'what OBS / Streamlabs capture' },
};
const IDS = ['A1', 'A2', 'A3', 'B1', 'B2'];
// fader 0..1 <-> dB (-60..+12) for input gains
const dbToF = (db) => Math.max(0, Math.min(1, (db + 60) / 72)); const fToDb = (f) => Math.round((f * 72 - 60) * 2) / 2;
const volToDb = (v) => (v <= 0.0005 ? '-∞' : (20 * Math.log10(v)).toFixed(1));
const ICON = { game: Icon.game, chat: Icon.chat, media: Icon.media, aux: Icon.aux };

export default function Bus() {
  const [st, setSt] = useState(null);
  const [lv, setLv] = useState({});
  const [sel, setSel] = useState(null); // { id, tab }
  const [note, setNote] = useState('');
  const [help, setHelp] = useState(false);
  const [sceneName, setSceneName] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    window.bsp.invoke('bus:get').then(setSt);
    const offs = [window.bsp.onBus && window.bsp.onBus(setSt), window.bsp.onLevels((l) => setLv((l && l.engine) || {}))];
    return () => offs.forEach((f) => f && f());
  }, []);
  if (!st) return <div className="page"><div className="empty-state panel"><h2>Loading…</h2></div></div>;
  const got = (r) => { if (r) { setSt(r); setNote(r.note || ''); } };
  const route = (id, b, on) => window.bsp.invoke('bus:route', id, b, on).then(got);
  const strip = (id, p) => window.bsp.invoke('bus:strip', id, p).then(got);
  const out = (id, p) => window.bsp.invoke('bus:out', id, p).then(got);
  const bl = lv.bus || {};
  const stripLevel = (s) => s.kind === 'mic' ? (lv.micPost || 0) : s.kind === 'channel' ? ((lv.channels || {})[s.ch] || 0) : ((bl.strips || {})[s.id] || 0);
  const busLevel = (id) => (bl.buses || {})[id] ?? (id === 'B1' ? Math.max(0, lv.micOutPk || 0) : id === 'B2' ? Math.max(0, lv.streamPk || 0) : 0);
  const all = [...st.strips, st.mic, ...st.inputs];
  const cur = sel && all.find((x) => x.id === sel.id);
  const outsHw = st.devices.outputs.filter((o) => !/(cable|vb-audio|voicemeeter|sonar)/i.test(o.name));

  const Strip = (s) => {
    const isCh = s.kind === 'channel', isMic = s.kind === 'mic', isIn = s.kind === 'input';
    const fv = isCh ? s.volume : isMic ? Math.max(0, Math.min(1, (s.gainDb + 24) / 48)) : dbToF(s.gainDb || 0);
    const setF = (v) => isCh ? strip(s.id, { volume: v }) : isMic ? strip(s.id, { gainDb: Math.round((v * 48 - 24) * 2) / 2 }) : strip(s.id, { gainDb: fToDb(v) });
    const label = isCh ? volToDb(s.volume) + ' dB' : `${isMic || isIn ? (s.gainDb > 0 ? '+' : '') + (s.gainDb || 0) : ''} dB`;
    const Ic = isMic ? Icon.mic : isIn ? (s.loopback ? Icon.speaker : Icon.mic) : (ICON[s.icon] || Icon.aux);
    const fx = [['eq', 'EQ', isMic ? s.eq && s.eq.enabled : s.eq && s.eq.enabled], ['dyn', 'Gate · Comp', (s.gate && s.gate.enabled) || (s.comp && s.comp.enabled)]];
    return (
      <div key={s.id} className={`bx-strip${sel && sel.id === s.id ? ' sel' : ''}${s.muted || s.mute ? ' muted' : ''}${s.solo ? ' solo' : ''}`}>
        <div className="bx-strip-head"><Ic size={15} /><b title={s.name || s.label}>{s.label}</b>{isIn && <i className="bx-x" title="Remove this input" onClick={() => window.bsp.invoke('bus:removeInput', s.id).then(got)}>×</i>}</div>
        <span className="bx-kind">{isCh ? 'Apps' : isMic ? (s.name || 'Microphone') : s.name}</span>
        <div className="bx-fader"><Meter level={stripLevel(s)} height={150} muted={s.muted || s.mute} /><Fader value={fv} onChange={setF} height={150} /></div>
        <span className="bx-db">{label}</span>
        {!isMic && <label className="bx-pan" title="Pan: left / right">L<input type="range" min={-100} max={100} value={Math.round((s.pan || 0) * 100)} onChange={(e) => strip(s.id, { pan: Number(e.target.value) / 100 })} onDoubleClick={() => strip(s.id, { pan: 0 })} />R</label>}
        {!isMic && <div className="bx-ms">
          <button className={`bx-m${s.muted || s.mute ? ' on' : ''}`} title="Mute everywhere" onClick={() => strip(s.id, { mute: !(s.muted || s.mute) })}>M</button>
          <button className={`bx-s${s.solo ? ' on' : ''}`} title="Solo: hear only soloed strips on A1–A3" onClick={() => strip(s.id, { solo: !s.solo })}>S</button>
        </div>}
        <div className="bx-routes">{IDS.map((b) => <button key={b} className={`bx-r ${b[0]}${s.routes[b] ? ' on' : ''}`} title={`${BUS_INFO[b].title}: ${BUS_INFO[b].sub}`} onClick={() => route(s.id, b, !s.routes[b])}>{b}</button>)}</div>
        <div className="bx-fx">{fx.map(([t, l, on]) => <button key={t} className={`bx-fxb${on ? ' on' : ''}${sel && sel.id === s.id && sel.tab === t ? ' open' : ''}`} onClick={() => setSel(sel && sel.id === s.id && sel.tab === t ? null : { id: s.id, tab: t })}>{l}</button>)}</div>
        {isCh && s.hear && <span className="bx-tag" title="Passing through Blur Sounds so EQ / dynamics / pan apply to what you hear (about 40 ms).">processed</span>}
      </div>
    );
  };

  const Detail = () => {
    if (!cur) return null; const s = cur; const isMic = s.kind === 'mic';
    const gate = s.gate || { enabled: false, thresholdDb: -50 }; const comp = s.comp || { enabled: false, thresholdDb: -18, ratio: 3, makeupDb: 0 };
    const gThr = gate.thresholdDb ?? -50;
    return (
      <section className="panel bx-detail">
        <div className="row-between"><h4 className="drawer-sub">{s.label} · {sel.tab === 'eq' ? 'Equalizer' : 'Gate & compressor'}</h4><button className="ghost-btn" onClick={() => setSel(null)}>Close</button></div>
        {sel.tab === 'eq' ? <EqEditor eq={okEq(s.eq)} mic={isMic} onChange={(eq) => strip(s.id, { eq })} />
          : <div className="fx-grid">
            <div className={`fx${gate.enabled ? ' on' : ''}`}>
              <div className="fx-head"><Toggle small on={!!gate.enabled} onChange={(on) => strip(s.id, { gate: { ...gate, enabled: on } })} /><b>Gate</b><span className="fx-tag">silences quiet noise</span></div>
              <label>Open above <span>{gThr} dB</span><input type="range" min={-80} max={-10} value={gThr} onChange={(e) => strip(s.id, { gate: { ...gate, enabled: true, thresholdDb: Number(e.target.value) } })} /></label>
            </div>
            <div className={`fx${comp.enabled ? ' on' : ''}`}>
              <div className="fx-head"><Toggle small on={!!comp.enabled} onChange={(on) => strip(s.id, { comp: { ...comp, enabled: on } })} /><b>Compressor</b><span className="fx-tag">evens out loud & quiet</span></div>
              <label>Threshold <span>{comp.thresholdDb} dB</span><input type="range" min={-50} max={0} value={comp.thresholdDb} onChange={(e) => strip(s.id, { comp: { ...comp, enabled: true, thresholdDb: Number(e.target.value) } })} /></label>
              <label>Ratio <span>{comp.ratio}:1</span><input type="range" min={1} max={10} step={0.5} value={comp.ratio} onChange={(e) => strip(s.id, { comp: { ...comp, enabled: true, ratio: Number(e.target.value) } })} /></label>
              <label>Make-up <span>+{comp.makeupDb} dB</span><input type="range" min={0} max={18} value={comp.makeupDb} onChange={(e) => strip(s.id, { comp: { ...comp, enabled: true, makeupDb: Number(e.target.value) } })} /></label>
            </div>
          </div>}
        {s.kind === 'channel' && sel.tab !== 'eq' && <p className="hint">Turning these on routes this channel through Blur Sounds so you hear the effect too (adds about 40 ms). Turn them off for the direct path.</p>}
        {isMic && <p className="hint">These are the same settings as the mic chain on the Mixer page.</p>}
      </section>
    );
  };

  const BusCard = (b) => {
    const info = BUS_INFO[b.id]; const lim = b.limiter || { enabled: false, ceilingDb: -1 }; const pick = b.id === 'A2' || b.id === 'A3';
    return (
      <div key={b.id} className={`bx-bus ${b.id[0]}${b.mute ? ' muted' : ''}`}>
        <div className="bx-bus-head"><b className="bx-busid">{b.id}</b><div><b>{info.title}</b><span>{info.sub}</span></div></div>
        {pick ? <Select value={b.deviceId || null} onChange={(v) => out(b.id, { deviceId: v })} options={[{ value: null, label: 'Not used' }, ...outsHw.map((o) => ({ value: o.id, label: o.name }))]} />
          : <span className="bx-dev" title={b.name}>{b.name || (b.id === 'B2' ? 'Streaming is off' : b.id === 'B1' ? 'No mic cable' : '')}</span>}
        <div className="bx-busrow"><Meter level={busLevel(b.id)} height={90} muted={b.mute} />
          <div className="bx-busctl">
            <label>Gain <span>{(b.gainDb || 0) > 0 ? '+' : ''}{b.gainDb || 0} dB</span><input type="range" min={-30} max={12} step={0.5} value={b.gainDb || 0} onChange={(e) => out(b.id, { gainDb: Number(e.target.value) })} onDoubleClick={() => out(b.id, { gainDb: 0 })} /></label>
            <div className="row-gap wrap">
              <button className={`bx-m${b.mute ? ' on' : ''}`} onClick={() => out(b.id, { mute: !b.mute })}>M</button>
              <button className={`chip${b.mono ? ' on' : ''}`} onClick={() => out(b.id, { mono: !b.mono })}>Mono</button>
              <button className={`chip${lim.enabled ? ' on' : ''}`} title="Brick-wall limiter: nothing goes above the ceiling" onClick={() => out(b.id, { limiter: { ...lim, enabled: !lim.enabled } })}>Limiter {lim.enabled ? `${lim.ceilingDb} dB` : ''}</button>
              <button className={`chip${b.eq && b.eq.enabled ? ' on' : ''}`} onClick={() => setSel(sel && sel.id === 'bus:' + b.id ? null : { id: 'bus:' + b.id, tab: 'eq' })}>EQ</button>
            </div>
            {lim.enabled && <label>Ceiling <span>{lim.ceilingDb} dB</span><input type="range" min={-12} max={0} step={0.5} value={lim.ceilingDb} onChange={(e) => out(b.id, { limiter: { ...lim, ceilingDb: Number(e.target.value) } })} /></label>}
            <label>Delay <span>{b.delayMs || 0} ms</span><input type="range" min={0} max={500} step={5} value={b.delayMs || 0} onChange={(e) => out(b.id, { delayMs: Number(e.target.value) })} onDoubleClick={() => out(b.id, { delayMs: 0 })} /></label>
          </div>
        </div>
      </div>
    );
  };
  const busSel = sel && sel.id.startsWith('bus:') && st.buses.find((b) => 'bus:' + b.id === sel.id);

  return (
    <div className="page bx-page">
      <section className="panel bx-hero">
        <div className="row-between">
          <div><h2 className="bx-title"><span>✠</span> Bus Mixer</h2><p className="muted-text small">Every sound source is a strip. Light up a bus button to send it there: <b>A</b> buses are speakers & headphones, <b>B</b> buses are virtual cables.</p></div>
          <div className="row-gap">
            <button className="ghost-btn" onClick={() => setHelp(!help)}>{help ? 'Hide guide' : 'How it works'}</button>
            <button className="ghost-btn" title="Removes every bus-mixer extra. Your channels, mic and stream settings stay as they are." onClick={() => { if (confirm('Go back to plain routing? Pan, gate, comp, solo, A2/A3, extra inputs and bus effects are removed. Scenes are kept.')) window.bsp.invoke('bus:reset').then(got); }}>Reset to plain routing</button>
          </div>
        </div>
        {help && <div className="bx-guide">
          <div><b>1 · Strips</b><span>Apps (Game, Chat, Media, Aux), your mic, and any extra input you add.</span></div>
          <div><b>2 · Buses</b><span><em>A1</em> you hear · <em>A2/A3</em> extra outputs · <em>B1</em> your mic in Discord/VRChat · <em>B2</em> your stream.</span></div>
          <div><b>3 · Route</b><span>Click A1–B2 on a strip. Red = on. Example: Media on B2 only = viewers hear your music, you don't.</span></div>
          <div><b>4 · Scenes</b><span>Save the whole board ("Gaming", "Just chatting") and switch with one click.</span></div>
        </div>}
        {note && <p className="warn-box">{note}</p>}
        {st.solo && <p className="hint warn-text">Solo is on: only soloed strips reach A1–A3.</p>}
        <div className="bx-scenes">
          <span className="muted-text small">Scenes</span>
          {st.scenes.map((sc) => <span key={sc.id} className="bx-scene"><button className="chip" onClick={() => window.bsp.invoke('bus:sceneLoad', sc.id).then(got)}>{sc.name}</button><i title="Delete scene" onClick={() => { if (confirm(`Delete the scene "${sc.name}"?`)) window.bsp.invoke('bus:sceneDelete', sc.id).then(got); }}>×</i></span>)}
          <input className="cal-input" placeholder="Scene name" value={sceneName} onChange={(e) => setSceneName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sceneName && window.bsp.invoke('bus:sceneSave', sceneName).then((r) => { got(r); setSceneName(''); })} />
          <button className="ghost-btn" onClick={() => window.bsp.invoke('bus:sceneSave', sceneName || '').then((r) => { got(r); setSceneName(''); })}>Save scene</button>
        </div>
      </section>

      <section className="panel bx-board">
        <div className="bx-strips">
          {all.map(Strip)}
          <div className="bx-add">
            {!adding ? <button className="ghost-btn full" onClick={() => setAdding(true)}><Icon.plus size={14} />Add input</button> : <>
              <span className="muted-text small">A second mic or line-in</span>
              <Select value={null} onChange={(v) => { if (v) window.bsp.invoke('bus:addInput', { deviceId: v, label: 'Input' }).then((r) => { got(r); setAdding(false); }); }} options={[{ value: null, label: 'Pick a microphone…' }, ...st.devices.inputs.filter((i) => !/cable output|vb-audio/i.test(i.name)).map((i) => ({ value: i.id, label: i.name }))]} />
              <span className="muted-text small">…or capture an output</span>
              <Select value={null} onChange={(v) => { if (v) window.bsp.invoke('bus:addInput', { deviceId: v, loopback: true, label: 'Loopback' }).then((r) => { got(r); setAdding(false); }); }} options={[{ value: null, label: 'Pick an output…' }, ...outsHw.map((o) => ({ value: o.id, label: o.name }))]} />
              <button className="ghost-btn" onClick={() => setAdding(false)}>Cancel</button>
            </>}
          </div>
        </div>
      </section>

      {cur && <Detail />}
      {busSel && <section className="panel bx-detail"><div className="row-between"><h4 className="drawer-sub">{busSel.id} · {BUS_INFO[busSel.id].title} · Equalizer</h4><button className="ghost-btn" onClick={() => setSel(null)}>Close</button></div>
        <EqEditor eq={okEq(busSel.eq)} onChange={(eq) => out(busSel.id, { eq })} /></section>}

      <section className="panel">
        <h4 className="drawer-sub">Buses</h4>
        <div className="bx-buses">{st.buses.map(BusCard)}</div>
        <p className="hint">A1 effects and dynamics on a channel send that channel through Blur Sounds (about 40 ms extra) so you hear them; with nothing changed here, apps play straight to your devices like before.</p>
      </section>
    </div>
  );
}
