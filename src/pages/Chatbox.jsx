import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icons.jsx';
import { Toggle, Select } from '../components/Controls.jsx';
import SCHEMA from '../../electron/cbschema.json';

const MAX = 144;
const ulen = (s) => String(s || '').length;
const GI = { weather: '🌤️', pc: '💻', net: '📶', afk: '💤', window: '🪟', clock: '🕒', media: '🎵', vr: '🥽', stream: '📡', text: '🔤', bubble: '💬', status: '⚙️', send: '⚡' };
const fieldMatches = (f, g, cat, q) => !q || [f.label, f.help, g.label, cat, ...(f.options || []).map((o) => o.label)].some((x) => x && String(x).toLowerCase().includes(q));

export default function Chatbox({ settings, update, setSettings, state }) {
  const cb = settings.chatbox; const m = cb.modules; const opt = cb.opt || {};
  const [msg, setMsg] = useState(''); const [newStatus, setNewStatus] = useState(''); const [note, setNote] = useState('');
  const [q, setQ] = useState(''); const [cat, setCat] = useState('all');
  const typingTimer = useRef(null);
  const val = (f) => (f.path ? f.path.reduce((o, k) => (o ? o[k] : undefined), settings) : opt[f.id] ?? f.default);
  const setVal = (f, v) => update(f.path || ['chatbox', 'opt', f.id], v);
  const setMod = (mod, key, value) => update(['chatbox', 'modules', mod, key], value);
  const setItems = (items) => setMod('status', 'items', items);
  const onType = (v) => {
    setMsg(v); window.bsp.invoke('chatbox:typing', v.length > 0);
    clearTimeout(typingTimer.current); typingTimer.current = setTimeout(() => window.bsp.invoke('chatbox:typing', false), 2500);
  };
  const send = async (text = msg) => {
    if (!String(text).trim()) return;
    const r = await window.bsp.invoke('chatbox:send', text);
    if (r && !r.ok) { setNote(r.error); return; }
    if (text === msg) setMsg(''); setNote(''); const s = await window.bsp.invoke('settings:get'); setSettings({ ...s });
  };
  const preview = state?.preview ?? ''; const live = !!state?.live;
  const since = state?.lastSentAt ? Math.round((Date.now() - state.lastSentAt) / 1000) : null;
  const presets = String(opt['presets.items'] ?? SCHEMA.groups.find((g) => g.id === 'presets').fields[0].default).split('\n').map((x) => x.trim()).filter(Boolean);
  const ql = q.trim().toLowerCase();
  const catLabel = Object.fromEntries(SCHEMA.categories.map((c) => [c.id, c.label]));
  const groups = SCHEMA.groups.filter((g) => cat === 'all' || g.cat === cat).map((g) => ({ ...g, shown: g.fields.filter((f) => fieldMatches(f, g, catLabel[g.cat], ql)) })).filter((g) => g.shown.length);
  const matchCount = groups.reduce((n, g) => n + g.shown.filter((f) => !f.legacy).length, 0);

  return (
    <div className="page chatbox-page">
      <div className="cb-grid v3">
        <div className="cb-left">
          <section className="panel cb-hero">
            <div className="cb-hero-head">
              <div>
                <div className="eyebrow">Magic Chatbox</div>
                <h2>VRChat chatbox over OSC</h2>
                <p className="muted-text">Sends to {cb.ip}:{cb.port} · /chatbox/input · min {Math.max(1.5, cb.sendIntervalSec)}s between updates</p>
              </div>
              <button className={`live-btn${live ? ' on' : ''}`} onClick={async () => { await window.bsp.invoke('chatbox:live', !live); update(['chatbox', 'live'], !live); }}>
                <span className="live-dot" />{live ? 'LIVE' : 'GO LIVE'}
              </button>
            </div>
            <div className="vrc-preview">
              <div className="vrc-bubble">
                {preview ? preview.split('\n').map((l, i) => <div key={i}>{l || '\u00a0'}</div>) : <div className="muted-text">{state?.afk && opt['clear.afk'] ? 'Cleared while AFK' : 'Nothing to show — turn on a module'}</div>}
              </div>
              <div className="vrc-meta">
                <span className={ulen(preview) > MAX - 10 ? 'warn-text' : ''}>{ulen(preview)}/{MAX}</span>
                <span>{state?.paused ? `paused — ${state.paused}` : live ? (since != null ? `sent ${since}s ago · ${state.sendCount} updates` : 'waiting for first send') : 'preview only — not sending'}</span>
              </div>
            </div>
            <div className="composer">
              <input value={msg} placeholder="Type a message for the chatbox…" onChange={(e) => onType(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} maxLength={400} />
              <span className={`composer-count${ulen(msg) >= MAX ? ' warn-text' : ''}`}>{ulen(msg)}/{MAX}</span>
              <button className="primary-btn" onClick={() => send()} disabled={!msg.trim()}><Icon.send size={16} />Send</button>
            </div>
            <div className="composer-foot">
              <Toggle small on={cb.typingIndicator} onChange={(v) => update(['chatbox', 'typingIndicator'], v)} label="Typing indicator" />
              <Toggle small on={cb.notify} onChange={(v) => update(['chatbox', 'notify'], v)} label="Notification sound" />
              <span className="muted-text">Message shows for</span>
              <input className="num-input" type="number" min={3} max={120} value={m.message.durationSec} onChange={(e) => setMod('message', 'durationSec', Number(e.target.value) || 12)} />
              <span className="muted-text">s</span>
              {state?.message && <button className="ghost-btn" onClick={() => window.bsp.invoke('chatbox:clearMessage')}>Clear message</button>}
            </div>
            {note && <p className="hint warn-text" style={{ margin: '0 16px 12px' }}>{note}</p>}
          </section>

          <section className="panel">
            <div className="panel-head"><Icon.send size={16} /><h3>Quick messages</h3><span className="spacer" /><span className="muted-text small">{opt['presets.hotkeys'] ? 'Ctrl+Shift+1…9' : 'hotkeys off'}</span></div>
            <div className="preset-chips">
              {presets.map((p, i) => <button key={i} className="preset-chip" onClick={() => send(p)} title={opt['presets.hotkeys'] && i < 9 ? `Ctrl+Shift+${i + 1}` : 'Send'}>{opt['presets.hotkeys'] && i < 9 && <kbd>{i + 1}</kbd>}{p}</button>)}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><Icon.status /><h3>Status rotator</h3><span className="spacer" /><Toggle on={m.status.enabled} onChange={(v) => setMod('status', 'enabled', v)} /></div>
            <div className="row-gap">
              <span className="muted-text">Rotate every</span>
              <input className="num-input" type="number" min={2} max={600} value={m.status.rotateSec} onChange={(e) => setMod('status', 'rotateSec', Number(e.target.value) || 5)} />
              <span className="muted-text">s</span><span className="spacer" />
              <Toggle small on={m.status.random} onChange={(v) => setMod('status', 'random', v)} label="Shuffle" />
            </div>
            <div className="status-list">
              {m.status.items.map((it, i) => (
                <div key={i} className={`status-item${it.enabled ? ' on' : ''}`}>
                  <input type="checkbox" checked={it.enabled} onChange={(e) => setItems(m.status.items.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />
                  <input className="status-text" value={it.text} maxLength={144} onChange={(e) => setItems(m.status.items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                  <button className="icon-btn tiny" onClick={() => setItems(m.status.items.filter((_, j) => j !== i))} title="Delete"><Icon.trash size={14} /></button>
                </div>
              ))}
            </div>
            <div className="composer small">
              <input value={newStatus} placeholder="Add a status…" maxLength={144} onChange={(e) => setNewStatus(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && newStatus.trim()) { setItems([...m.status.items, { text: newStatus.trim(), enabled: true }]); setNewStatus(''); } }} />
              <button className="ghost-btn" onClick={() => { if (newStatus.trim()) { setItems([...m.status.items, { text: newStatus.trim(), enabled: true }]); setNewStatus(''); } }}><Icon.plus size={14} />Add</button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><Icon.bubble /><h3>Recent messages</h3></div>
            <div className="history">
              {(cb.history || []).length === 0 && <div className="muted-text">Messages you send show up here.</div>}
              {(cb.history || []).slice(0, 8).map((h, i) => <button key={i} className="history-item" onClick={() => setMsg(h.text)} title="Click to reuse">{h.text}</button>)}
            </div>
            <div className="row-gap"><button className="ghost-btn" onClick={async () => { const r = await window.bsp.invoke('chatbox:import'); setNote(r.ok ? `Imported ${r.found.join(', ')}` : r.error); if (r.settings) setSettings({ ...r.settings }); }}>Re-import from MagicChatbox</button></div>
          </section>
        </div>

        <div className="cb-right">
          <section className="panel opt-browser">
            <div className="opt-head">
              <div><h3>Chatbox options</h3><p className="muted-text small">{SCHEMA.count} new options · {ql || cat !== 'all' ? `${matchCount} shown` : 'search or pick a category'}</p></div>
              <div className="opt-search"><input placeholder="Search options… (e.g. weather, font, ping)" value={q} onChange={(e) => setQ(e.target.value)} />{q && <button className="icon-btn tiny" onClick={() => setQ('')}>✕</button>}</div>
            </div>
            <div className="chips opt-cats">
              <button className={`chip${cat === 'all' ? ' on' : ''}`} onClick={() => setCat('all')}>All</button>
              {SCHEMA.categories.map((c) => <button key={c.id} className={`chip${cat === c.id ? ' on' : ''}`} onClick={() => setCat(c.id)}>{c.label}</button>)}
            </div>
          </section>
          {groups.length === 0 && <div className="apps-empty">No options match “{q}”.</div>}
          {groups.map((g) => (
            <section key={g.id} className={`panel opt-group${g.id === 'weather' ? ' spotlight' : ''}`}>
              <div className="opt-group-head">
                <span className="opt-gi">{GI[g.icon] || '•'}</span>
                <div className="grow"><h3>{g.label}</h3>{g.module && state?.parts?.[g.module] && <div className="opt-live" title="Live output">{state.parts[g.module]}</div>}</div>
                <span className="opt-cat">{catLabel[g.cat]}</span>
              </div>
              {g.widget === 'weather' && !ql && <WeatherCard st={state?.weather} on={val(g.fields[0])} />}
              {g.widget === 'stopwatch' && <Stopwatch st={state?.stopwatch} />}
              <div className="opt-fields">
                {g.shown.map((f) => <Field key={f.id} f={f} value={val(f)} onChange={(v) => setVal(f, v)} settings={settings} setSettings={setSettings} setNote={setNote} state={state} />)}
              </div>
              <GroupStatus g={g} state={state} />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function GroupStatus({ g, state }) {
  if (!state) return null;
  let t = null;
  if (g.id === 'weather' && state.weather?.error) t = `Weather: ${state.weather.error}`;
  if (g.id === 'twitch' && state.twitch?.error) t = `Twitch: ${state.twitch.error}`;
  if (g.id === 'twitch' && state.twitch?.data) t = state.twitch.data.live ? `Live now · ${state.twitch.data.viewers ?? '?'} viewers` : `twitch.tv/${state.twitch.data.channel} is offline right now`;
  if ((g.id === 'vrcworld' || g.id === 'vrcplayers') && state.vrc) t = state.vrc.error ? `VRChat log: ${state.vrc.error}` : state.vrc.world ? `From VRChat log: ${state.vrc.world.name || '…'} · ${state.vrc.players} players` : 'Waiting for the VRChat log…';
  if (g.id === 'vrcosc' && state.osc) t = state.osc.error ? `OSC: ${state.osc.error}` : state.osc.port ? (state.osc.lastAt ? `Receiving avatar parameters on ${state.osc.port}${state.osc.muted != null ? ` · mic ${state.osc.muted ? 'muted' : 'on'}` : ''}${state.osc.hr ? ` · ${state.osc.hr} bpm` : ''}` : `Listening on ${state.osc.port} — enable OSC in VRChat's Action Menu`) : 'Off until a mute/heart-rate/AFK option is on';
  if (g.id === 'pc' && state.sys) t = `Now: CPU ${state.sys.cpu ?? '—'}% · GPU ${state.sys.gpu ?? '—'}%${state.sys.gpuTemp ? ` ${state.sys.gpuTemp}°C` : ''} · VRAM ${state.sys.vramUsed ?? '—'}/${state.sys.vramTotal ?? '—'} GB${state.sys.gpuName ? ` · ${state.sys.gpuName}` : ''}${state.sys.boardTemp ? '' : ' · CPU temp not exposed by Windows'}`;
  if (g.id === 'afk' && state.sys?.idleSec != null) t = `Idle ${Math.round(state.sys.idleSec)}s${state.osc?.afk != null ? ` · VRChat AFK: ${state.osc.afk ? 'yes' : 'no'}` : ''}`;
  if (g.id === 'net' && state.sys) t = state.sys.ping != null ? `Ping ${state.sys.ping} ms` : state.sys.pingError ? `Ping failed: ${state.sys.pingError}` : null;
  return t ? <p className="hint opt-status">{t}</p> : null;
}

function WeatherCard({ st, on }) {
  const w = st?.data; const [busy, setBusy] = useState(false);
  return (
    <div className="wx">
      {w ? <>
        <div className="wx-main"><span className="wx-icon">{w.icon}</span><div><div className="wx-temp">{w.temp}{w.unit}</div><div className="wx-cond">{w.cond} · feels {w.feels}°</div></div></div>
        <div className="wx-grid">
          <div><span>High / low</span><b>{w.hi}° / {w.lo}°</b></div><div><span>Wind</span><b>{w.wind} {w.windUnit}</b></div>
          <div><span>Humidity</span><b>{w.hum}%</b></div><div><span>Rain</span><b>{w.rain ?? '—'}%</b></div>
        </div>
        <div className="wx-foot"><span>📍 {w.city}{w.region ? `, ${w.region}` : ''} · via {w.via === 'city' ? 'city override' : w.via}</span><span>updated {new Date(w.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
      </> : <div className="muted-text">{on ? (st?.error ? `Weather error: ${st.error}` : 'Fetching weather…') : 'Turn on “Show weather” to fetch it.'}</div>}
      <button className="ghost-btn wx-refresh" disabled={busy || !on} onClick={async () => { setBusy(true); await window.bsp.invoke('chatbox:weatherRefresh'); setBusy(false); }}>{busy ? 'Refreshing…' : 'Refresh now'}</button>
    </div>
  );
}

function Stopwatch({ st }) {
  const s = Math.floor(st?.sec || 0); const t = `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return (
    <div className="row-gap sw">
      <span className="sw-time">{t}</span>
      {st?.running ? <button className="ghost-btn" onClick={() => window.bsp.invoke('chatbox:stopwatch', 'pause')}>Pause</button> : <button className="primary-btn" onClick={() => window.bsp.invoke('chatbox:stopwatch', 'start')}>{s ? 'Resume' : 'Start'}</button>}
      <button className="ghost-btn" onClick={() => window.bsp.invoke('chatbox:stopwatch', 'reset')}>Reset</button>
    </div>
  );
}

function TextIn({ value, onChange, placeholder, area }) {
  const [v, setV] = useState(value ?? ''); const t = useRef(null);
  useEffect(() => { setV(value ?? ''); }, [value]);
  const ch = (x) => { setV(x); clearTimeout(t.current); t.current = setTimeout(() => onChange(x), 350); };
  return area ? <textarea className="opt-area" value={v} placeholder={placeholder} onChange={(e) => ch(e.target.value)} rows={4} /> : <input className="opt-text" value={v} placeholder={placeholder} onChange={(e) => ch(e.target.value)} />;
}

function Field({ f, value, onChange, settings, setSettings, setNote, state }) {
  const label = <span className="opt-label">{f.label}{!f.legacy && <i className="opt-new" title="New in this version" />}</span>;
  const help = f.help ? <span className="opt-help">{f.help}</span> : null;
  if (f.type === 'bool') return <div className="opt-field bool"><Toggle small on={!!value} onChange={onChange} />{label}{help}</div>;
  if (f.type === 'num') return <div className="opt-field">{label}<div className="row-gap"><input className="num-input wide" type="number" min={f.min} max={f.max} step={f.step || 1} value={value ?? ''} onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== '' && isFinite(n)) onChange(Math.min(f.max ?? n, Math.max(f.min ?? n, n))); }} />{f.unit && <span className="muted-text small">{f.unit}</span>}</div>{help}</div>;
  if (f.type === 'text') return <div className="opt-field">{label}<TextIn value={value} onChange={onChange} placeholder={f.placeholder} />{help}</div>;
  if (f.type === 'list') return <div className="opt-field wide">{label}<TextIn area value={value} onChange={onChange} placeholder={f.placeholder} />{help}</div>;
  if (f.type === 'datetime') return <div className="opt-field">{label}<input className="opt-text" type="datetime-local" value={value || ''} onChange={(e) => onChange(e.target.value)} />{help}</div>;
  if (f.type === 'select') return <div className="opt-field">{label}<Select value={value ?? null} onChange={(v) => onChange(v ?? '')} options={f.options.map((o) => ({ value: o.value === '' ? null : o.value, label: o.label }))} />{help}</div>;
  if (f.type === 'widget') return <div className="opt-field wide">{label}<Widget f={f} value={value} onChange={onChange} settings={settings} setSettings={setSettings} setNote={setNote} />{help}</div>;
  return null;
}

function Widget({ f, value, onChange, settings, setSettings, setNote }) {
  const cb = settings.chatbox; const mods = SCHEMA.modules;
  const [name, setName] = useState(cb.activeProfile || ''); const [msg, setMsg] = useState('');
  if (f.widget === 'affix') {
    const v = value || {};
    return <div className="affix-grid">{mods.map((m) => <label key={m.id}><span>{m.label}</span><TextIn value={v[m.id] || ''} onChange={(x) => onChange({ ...(cb.opt?.[f.id] || {}), [m.id]: x })} placeholder={f.id.endsWith('prefix') ? 'before' : 'after'} /></label>)}</div>;
  }
  if (f.widget === 'pages') {
    const v = value || {};
    return <div className="affix-grid">{mods.map((m) => <label key={m.id}><span>{m.label}</span><select className="app-move wide" value={v[m.id] || 0} onChange={(e) => onChange({ ...(cb.opt?.[f.id] || {}), [m.id]: Number(e.target.value) })}><option value={0}>Always</option><option value={1}>Page 1</option><option value={2}>Page 2</option><option value={3}>Page 3</option></select></label>)}</div>;
  }
  if (f.widget === 'order') {
    const order = [...(cb.order || [])]; for (const m of mods) if (!order.includes(m.id)) order.push(m.id);
    const move = async (i, d) => { const o = [...order]; const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; const s = await window.bsp.invoke('settings:set', ['chatbox', 'order'], o); setSettings({ ...s }); };
    const label = (id) => mods.find((m) => m.id === id)?.label || id;
    return <div className="order-list">{order.map((id, i) => <div key={id} className="order-row"><span className="order-n">{i + 1}</span><span className="grow">{label(id)}</span><button className="icon-btn tiny" onClick={() => move(i, -1)} disabled={!i}>▲</button><button className="icon-btn tiny" onClick={() => move(i, 1)} disabled={i === order.length - 1}>▼</button></div>)}</div>;
  }
  const act = async (action, n) => { const r = await window.bsp.invoke('chatbox:profile', action, n); if (r?.settings) setSettings({ ...r.settings }); setMsg(r?.ok ? (r.file ? `${action === 'export' ? 'Saved' : 'Loaded'} ${r.file}` : 'Done') : r?.canceled ? '' : r?.error || 'Failed'); };
  if (f.widget === 'profiles') {
    const names = Object.keys(cb.profiles || {});
    return <div className="prof">
      <div className="row-gap"><input className="opt-text" placeholder="Profile name (e.g. Streaming)" value={name} onChange={(e) => setName(e.target.value)} /><button className="primary-btn" disabled={!name.trim()} onClick={() => act('save', name.trim())}>Save current</button></div>
      <div className="prof-list">{names.length === 0 && <span className="muted-text small">No saved profiles yet.</span>}{names.map((n) => <div key={n} className={`prof-row${cb.activeProfile === n ? ' on' : ''}`}><span className="grow">{n}</span><button className="ghost-btn" onClick={() => act('load', n)}>Load</button><button className="icon-btn tiny" onClick={() => act('delete', n)}><Icon.trash size={13} /></button></div>)}</div>
      {msg && <span className="hint">{msg}</span>}
    </div>;
  }
  if (f.widget === 'export') return <div className="row-gap"><button className="ghost-btn" onClick={() => act('export', cb.activeProfile || 'chatbox-profile')}>Export to file…</button>{msg && <span className="hint">{msg}</span>}</div>;
  if (f.widget === 'import') return <div className="row-gap"><button className="ghost-btn" onClick={() => act('import')}>Import from file…</button>{msg && <span className="hint">{msg}</span>}</div>;
  return null;
}
