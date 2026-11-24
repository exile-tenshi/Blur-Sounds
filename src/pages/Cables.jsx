import React, { useEffect, useState } from 'react';
import { Icon } from '../components/Icons.jsx';
import { Toggle, Select } from '../components/Controls.jsx';
import { HifiPanel } from '../components/HifiCable.jsx';

const short = (n) => String(n || '').replace(/\s*\(.*$/, '');

export default function Cables() {
  const [st, setSt] = useState(null);
  const [name, setName] = useState(''); const [cable, setCable] = useState(null);
  const [confirm, setConfirm] = useState(false); const [msg, setMsg] = useState('');
  useEffect(() => window.bsp.onMixer(setSt), []);
  if (!st || !st.ready) return <div className="page"><div className="empty-state panel"><Icon.cable size={36} /><h2>Waiting for the audio engine</h2></div></div>;
  const m = st.settings; const cables = st.cables || [];
  const free = cables.filter((c) => !c.ownedBySonar && !c.usedBy.length);
  const outName = (id) => st.outputs.find((o) => o.id === id)?.name;
  return (
    <div className="page cables-page">
      <HifiPanel />
      <section className="panel">
        <div className="row-between"><div><h3>Virtual cables</h3><p className="muted-text small">Audio devices Blur Sounds Pro can route channels, your stream mix and your processed mic through.</p></div>
          <span className={`pill ${st.sonarRunning ? 'warn' : 'ok'}`}><i />SteelSeries Sonar {st.sonarRunning ? 'running' : 'not running'}</span></div>
        <div className="cable-list">
          {cables.length === 0 && <div className="apps-empty">No virtual cables found. Use “Install Hi-Fi Cable” above to add one.</div>}
          {cables.map((c) => (
            <div key={c.id} className={`cable-row${c.ownedBySonar ? ' sonar' : ''}`}>
              <span className="strip-icon"><Icon.cable size={16} /></span>
              <div className="cable-names">
                <div className="cable-name">{short(c.name)} <span className="muted-text small">{(/\(([^)]*)\)/.exec(c.name) || [])[1]}</span></div>
                <div className="muted-text small">Apps play into <b>{short(c.name)}</b>{c.recordName ? <> · other apps hear it on <b>{short(c.recordName)}</b></> : null}</div>
              </div>
              <div className="cable-use">
                {c.ownedBySonar ? <span className="tag warn">Owned by Sonar</span> : c.usedBy.length ? c.usedBy.map((u) => <span key={u} className="tag on">{u}</span>) : <span className="tag">Free</span>}
              </div>
            </div>
          ))}
        </div>
        <p className="hint">Windows only allows new audio devices from a signed driver, so Blur Sounds Pro maps its channels onto cables you already have. For more cables, install VB-Audio Virtual Cable (free) or its A+B/C+D packs, then they show up here automatically.</p>
      </section>

      <div className="two-col">
        <section className="panel">
          <h3>Channels</h3>
          <p className="muted-text small">Each channel is a group of apps with its own fader, EQ and stream level. Put a channel on a cable to process it like Sonar does.</p>
          <div className="chan-list">
            {m.channelList.map((c) => { const cfg = m.channels[c.id]; return (
              <div key={c.id} className="chan-row">
                <input className="text-input" defaultValue={c.label} onBlur={(e) => e.target.value.trim() && e.target.value !== c.label && window.bsp.invoke('mixer:renameChannel', c.id, e.target.value.trim())} />
                <Select className="grow" value={cfg.mode === 'cable' ? cfg.cableId : null} onChange={(v) => window.bsp.invoke('mixer:channel', c.id, v ? { mode: 'cable', cableId: v } : { mode: 'direct' })}
                  options={[{ value: null, label: 'Direct (no cable)' }, ...cables.map((x) => ({ value: x.id, label: `${short(x.name)}${x.ownedBySonar ? ' (Sonar)' : ''}` }))]} />
                {!c.builtin ? <button className="icon-btn" title="Delete channel" onClick={() => window.bsp.invoke('mixer:removeChannel', c.id)}><Icon.trash size={14} /></button> : <span className="icon-spacer" />}
              </div>); })}
          </div>
          <div className="chan-row add">
            <input className="text-input" placeholder="New channel name (e.g. Music)" value={name} onChange={(e) => setName(e.target.value)} />
            <Select className="grow" value={cable} onChange={setCable} options={[{ value: null, label: 'Direct (no cable)' }, ...free.map((x) => ({ value: x.id, label: short(x.name) }))]} />
            <button className="primary-btn" disabled={!name.trim() || m.channelList.length >= 8} onClick={async () => { await window.bsp.invoke('mixer:addChannel', { label: name.trim(), cableId: cable }); setName(''); setCable(null); }}><Icon.plus size={14} />Add</button>
          </div>
        </section>

        <section className="panel">
          <h3>Outputs</h3>
          <div className="out-block">
            <div className="eyebrow">Personal mix (what you hear from cable channels)</div>
            <Select value={m.personalOut} onChange={(v) => window.bsp.invoke('mixer:global', { personalOut: v })} options={[{ value: null, label: `Master output · ${short(outName(m.master.deviceId || st.defaultOutput))}` }, ...st.outputs.filter((o) => !/cable|sonar/i.test(o.name)).map((o) => ({ value: o.id, label: o.name }))]} />
          </div>
          <div className="out-block">
            <div className="row-between"><div className="eyebrow">Stream mix</div><Toggle small on={m.streamMode} onChange={(v) => window.bsp.invoke('mixer:global', { streamMode: v })} label="Streamer mode" /></div>
            <Select value={m.streamOut} onChange={(v) => window.bsp.invoke('mixer:global', { streamOut: v })} options={[{ value: null, label: 'Pick a cable…' }, ...cables.filter((c) => !c.ownedBySonar).map((c) => ({ value: c.id, label: c.name }))]} />
            {m.streamOut && <p className="hint">In Streamlabs / OBS add an <b>Audio Input Capture</b> using <b>{cables.find((c) => c.id === m.streamOut)?.recordName || 'the cable output'}</b>. Set per-channel stream levels on the Mixer with Streamer mode on.</p>}
          </div>
          <div className="out-block">
            <div className="eyebrow">Virtual mic (processed mic)</div>
            <Select value={st.micChain?.outId} onChange={(v) => window.bsp.invoke('mic:chain', { outId: v, enabled: v ? true : st.micChain.enabled })} options={[{ value: null, label: 'Off' }, ...cables.filter((c) => !c.ownedBySonar).map((c) => ({ value: c.id, label: c.name }))]} />
            {st.micChain?.outId && <p className="hint">Pick <b>{cables.find((c) => c.id === st.micChain.outId)?.recordName || 'the cable output'}</b> as the microphone in Discord / VRChat.</p>}
          </div>
        </section>
      </div>

      <section className="panel reset-panel row-between">
        <div><h3>Reset routing</h3><p className="muted-text small">Puts every channel back to Direct, turns off Streamer mode and the mic chain, and clears all per-app output overrides so apps follow Windows defaults again. SteelSeries Sonar's own settings are never touched.</p></div>
        {confirm ? <div className="row-gap"><button className="ghost-btn" onClick={() => setConfirm(false)}>Cancel</button><button className="primary-btn" onClick={async () => { await window.bsp.invoke('mixer:resetRouting'); setConfirm(false); setMsg('Routing reset.'); }}>Yes, reset</button></div>
          : <button className="ghost-btn" onClick={() => setConfirm(true)}>Reset routing…</button>}
      </section>
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}
