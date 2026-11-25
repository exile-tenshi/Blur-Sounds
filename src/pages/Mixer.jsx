import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icons.jsx';
import { Fader, Meter, HSlider, Select, Toggle, MiniMeter } from '../components/Controls.jsx';
import { EqEditor } from '../components/Eq.jsx';
import Drawer from '../components/Drawer.jsx';
import EngineAlert from '../EngineAlert.jsx';
import { ListenPanel } from '../components/ListenSwitch.jsx';
import { StreamPath } from '../components/StreamPath.jsx';
import { MicPath } from '../components/MicPath.jsx';

const ICONS = { game: Icon.game, chat: Icon.headset, media: Icon.media, aux: Icon.aux, cable: Icon.cable };

function useThrottled(fn, ms = 60) {
  const t = useRef(0); const last = useRef(null); const timer = useRef(null);
  return (...a) => {
    last.current = a; const now = Date.now();
    if (now - t.current > ms) { t.current = now; fn(...a); }
    else { clearTimeout(timer.current); timer.current = setTimeout(() => { t.current = Date.now(); fn(...last.current); }, ms); }
  };
}

export default function Mixer() {
  const [st, setSt] = useState(null);
  const [levels, setLevels] = useState({ sessions: {}, mic: 0, master: 0 });
  const [media, setMedia] = useState(null);
  const [local, setLocal] = useState({});
  const [dragProc, setDragProc] = useState(null);
  const [drawer, setDrawer] = useState(window.__bspInitialDrawer || null); // {type:'channel', id} | {type:'mic'}

  useEffect(() => {
    const offs = [window.bsp.onMixer(setSt), window.bsp.onLevels(setLevels), window.bsp.onMedia(setMedia)];
    return () => offs.forEach((f) => f());
  }, []);

  const sendChannel = useThrottled((ch, patch) => window.bsp.invoke('mixer:channel', ch, patch));
  const sendApp = useThrottled((p, patch) => window.bsp.invoke('mixer:app', p, patch));
  const sendDev = useThrottled((kind, id, patch) => window.bsp.invoke('mixer:device', kind, id, patch));
  const sendGlobal = useThrottled((patch) => window.bsp.invoke('mixer:global', patch));

  if (!st || !st.ready) {
    return (<div className="page"><div className="empty-state panel"><Icon.mixer size={36} /><h2>Waiting for the audio engine</h2>
      {st && st.helper && st.helper.status !== 'starting' ? <EngineAlert helper={st.helper} /> : <p>Starting…</p>}</div></div>);
  }

  const s = st.settings;
  const outputs = st.outputs || []; const inputs = st.inputs || [];
  const masterId = s.master.deviceId || st.defaultOutput;
  const master = outputs.find((o) => o.id === masterId) || outputs[0];
  const micId = s.mic.deviceId || st.defaultCommsInput || st.defaultInput;
  const mic = inputs.find((o) => o.id === micId) || inputs[0];
  const eng = levels.engine || {};
  // v2.3: each app's own level = its Windows session peak meter, or the engine's capture of that exact process (cable mode)
  const lv = (pids) => Math.max(0, ...pids.map((p) => Math.max(levels.sessions?.[p] || 0, eng.procs?.[p] || 0)));

  const chVal = (id, k) => (local[`ch.${id}.${k}`] ?? s.channels[id][k]);
  const setCh = (id, patch) => { setLocal((l) => ({ ...l, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [`ch.${id}.${k}`, v])) })); sendChannel(id, patch); };
  const appVal = (a, k) => (local[`app.${a.process}.${k}`] ?? (k === 'volume' ? a.appVolume : a.appMuted));
  const setApp = (a, patch) => { setLocal((l) => ({ ...l, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [`app.${a.process}.${k}`, v])) })); sendApp(a.process, patch); };
  const devVal = (kind, d, k) => (local[`${kind}.${d?.id}.${k}`] ?? d?.[k]);
  const setDev = (kind, d, patch) => { setLocal((l) => ({ ...l, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [`${kind}.${d.id}.${k}`, v])) })); sendDev(kind, d.id, patch); };
  const chatMix = local.chatMix ?? s.chatMix ?? 0;
  const streamMode = !!s.streamMode;
  const playing = media && media.title;
  const chans = s.channelList;
  const cableName = (id) => (st.cables || []).find((c) => c.id === id)?.name || outputs.find((o) => o.id === id)?.name || 'cable';

  return (
    <div className="page mixer-page">
      {st.defaultIsGuarded && <div className="warn-box guard-banner"><b>Windows' default speakers are your stream cable.</b> Anything not routed by Blur Sounds Pro would be broadcast. Blur Sounds Pro is moving it back now.</div>}
      {!st.defaultIsGuarded && st.guardLog?.[0] && Date.now() - st.guardLog[0].at < 10 * 60 * 1000 && <div className="hint guard-banner ok"><b>Broadcast guard:</b> {st.guardLog[0].msg}</div>}
      <section className="topbar panel three">
        <div className="topbar-block master">
          <div className="eyebrow">Master output</div>
          <div className="master-row">
            <Select className="grow" value={s.master.deviceId} onChange={(v) => window.bsp.invoke('mixer:device', 'master', v || st.defaultOutput, { select: v })}
              options={[{ value: null, label: `Windows default · ${outputs.find((o) => o.id === st.defaultOutput)?.name || '—'}` }, ...outputs.map((o) => ({ value: o.id, label: o.name }))]} />
            {master && <>
              <button className={`icon-btn${devVal('master', master, 'muted') ? ' danger' : ''}`} onClick={() => setDev('master', master, { mute: !devVal('master', master, 'muted') })} title="Mute output">
                {devVal('master', master, 'muted') ? <Icon.muted /> : <Icon.speaker />}
              </button>
              <div className="master-slider"><HSlider value={devVal('master', master, 'volume') ?? 1} onChange={(v) => setDev('master', master, { volume: v })} /><MiniMeter level={levels.master} /></div>
              <span className="num">{Math.round((devVal('master', master, 'volume') ?? 1) * 100)}</span>
            </>}
          </div>
        </div>
        <div className="topbar-block chatmix">
          <div className="eyebrow row-between"><span>ChatMix</span><span className="muted-text">{chatMix === 0 ? 'balanced' : chatMix < 0 ? `game +${Math.round(-chatMix * 100)}` : `chat +${Math.round(chatMix * 100)}`}</span></div>
          <div className="chatmix-row">
            <span className="cm-l"><Icon.game size={16} />Game</span>
            <input type="range" className="chatmix-slider" min={-100} max={100} value={Math.round(chatMix * 100)}
              onChange={(e) => { const v = Number(e.target.value) / 100; setLocal((l) => ({ ...l, chatMix: Math.abs(v) < 0.04 ? 0 : v })); sendGlobal({ chatMix: Math.abs(v) < 0.04 ? 0 : v }); }}
              onDoubleClick={() => { setLocal((l) => ({ ...l, chatMix: 0 })); sendGlobal({ chatMix: 0 }); }} />
            <span className="cm-r">Chat<Icon.headset size={16} /></span>
          </div>
          <div className="row-between stream-row">
            <Toggle small on={streamMode} onChange={(v) => window.bsp.invoke('mixer:global', { streamMode: v })} label="Streamer mode" />
            <span className="muted-text small">{streamMode ? (st.stream && st.stream.dest ? `Stream mix → ${st.stream.dest.name.replace(/\s*\(.*$/, '')}` : <b className="bad-text">No stream output: see Stream audio below</b>) : st.stream && st.stream.via === 'desktop' ? 'Stream = your desktop audio' : 'One mix for you and your stream'}</span>
          </div>
        </div>
        <div className="topbar-block nowplaying">
          <div className="eyebrow">Now playing{media?.app ? ` · ${prettyApp(media.app)}` : ''}</div>
          <div className="np-row">
            <div className="np-text"><div className="np-title">{playing ? media.title : 'Nothing playing'}</div><div className="np-artist">{playing ? media.artist : 'Start Spotify or any media app'}</div></div>
            <div className="np-controls">
              <button className="icon-btn" onClick={() => window.bsp.invoke('media:control', 'prev')}><Icon.prev /></button>
              <button className="icon-btn primary" onClick={() => window.bsp.invoke('media:control', 'toggle')}>{media?.status === 'playing' ? <Icon.pause /> : <Icon.play />}</button>
              <button className="icon-btn" onClick={() => window.bsp.invoke('media:control', 'next')}><Icon.next /></button>
            </div>
          </div>
        </div>
      </section>
      <ListenPanel />
      <MicPath st={st} eng={eng} onOpenChain={() => setDrawer({ type: 'mic' })} />
      <StreamPath si={st.stream} />

      <section className="strips" style={{ gridTemplateColumns: `repeat(${chans.length + 1}, minmax(${streamMode ? 230 : 190}px, 1fr))` }}>
        {chans.map((c) => {
          const cfg = s.channels[c.id]; const Ico = ICONS[c.icon] || Icon.cable;
          const apps = st.sessions.filter((a) => a.channel === c.id);
          const vol = chVal(c.id, 'volume'); const muted = chVal(c.id, 'muted');
          const svol = chVal(c.id, 'streamVolume'); const smuted = chVal(c.id, 'streamMuted');
          const factor = c.id === 'game' ? (chatMix > 0 ? 1 - chatMix : 1) : c.id === 'chat' ? (chatMix < 0 ? 1 + chatMix : 1) : 1;
          const appLevel = apps.length ? Math.max(...apps.map((a) => lv(a.pids) * (appVal(a, 'muted') ? 0 : 1))) * vol * factor : 0;
          const level = Math.max(appLevel, eng.channels?.[c.id] || 0);
          const rawLevel = apps.length ? Math.max(...apps.map((a) => lv(a.pids))) * vol * factor : 0; // activity while muted (greyed)
          const isCable = cfg.mode === 'cable' && cfg.cableId;
          return (
            <div key={c.id} className={`strip panel${dragProc ? ' drop-ready' : ''}${isCable ? ' cable' : ''}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const p = e.dataTransfer.getData('text/bsp-proc'); if (p) window.bsp.invoke('mixer:assign', p, c.id); setDragProc(null); }}>
              <div className="strip-head">
                <span className="strip-icon"><Ico size={18} /></span>
                <span className="strip-name">{c.label}</span>
                {cfg.eq?.enabled && <span className="strip-badge">EQ</span>}
                <button className="icon-btn tiny strip-gear" title="Routing & EQ" onClick={() => setDrawer({ type: 'channel', id: c.id })}><Icon.settings size={14} /></button>
              </div>
              <button className="route-chip" onClick={() => setDrawer({ type: 'channel', id: c.id })} title="Change routing">
                {isCable ? <><Icon.cable size={13} /><span>{cableName(cfg.cableId).replace(/\s*\(.*$/, '')}</span></> : <><Icon.speaker size={13} /><span>{cfg.output ? (outputs.find((o) => o.id === cfg.output)?.name || 'device').replace(/\s*\(.*$/, '') : 'Direct · app default'}</span></>}
              </button>
              <div className={`strip-body${streamMode ? ' dual' : ''}`}>
                <Meter level={muted ? rawLevel : level} muted={muted} />
                <div className="fader-col"><Fader value={vol} onChange={(v) => setCh(c.id, { volume: v })} height={streamMode ? 200 : 230} />{streamMode && <span className="fader-tag">You</span>}</div>
                {streamMode && <div className="fader-col"><Fader value={svol} onChange={(v) => setCh(c.id, { streamVolume: v })} height={200} red={false} />{<span className="fader-tag stream">Stream</span>}</div>}
                <div className="strip-readout"><span className="big">{Math.round(vol * 100)}</span><span className="unit">%</span>{streamMode && <span className="sub">{Math.round(svol * 100)}</span>}</div>
              </div>
              <div className={`mute-row${streamMode ? ' dual' : ''}`}>
                <button className={`mute-btn${muted ? ' active' : ''}`} onClick={() => setCh(c.id, { muted: !muted })}>{muted ? <Icon.muted size={16} /> : <Icon.speaker size={16} />}{streamMode ? '' : muted ? 'Muted' : 'Mute'}</button>
                {streamMode && <button className={`mute-btn${smuted ? ' active' : ''}`} onClick={() => setCh(c.id, { streamMuted: !smuted })} title="Mute on stream"><Icon.stream size={16} /></button>}
              </div>
              <div className="apps">
                {apps.length === 0 && <div className="apps-empty">Drag apps here</div>}
                {apps.map((a) => (
                  <div key={a.process} className={`app-row${a.active ? ' active' : ''}`} draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/bsp-proc', a.process); setDragProc(a.process); }} onDragEnd={() => setDragProc(null)}>
                    <div className="app-top">
                      {a.icon ? <img className="app-icon" src={a.icon} alt="" /> : <span className="app-icon ph">{(a.name || '?')[0]}</span>}
                      <span className="app-name" title={`${a.name} (${a.process}.exe)`}>{a.name}</span>
                      <select className="app-move" value={a.channel} title="Move to channel" onChange={(e) => window.bsp.invoke('mixer:assign', a.process, e.target.value)}>
                        {chans.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                      </select>
                      <button className={`icon-btn tiny${appVal(a, 'muted') ? ' danger' : ''}`} onClick={() => setApp(a, { muted: !appVal(a, 'muted') })}>{appVal(a, 'muted') ? <Icon.muted size={14} /> : <Icon.speaker size={14} />}</button>
                    </div>
                    <div className="app-bottom"><HSlider value={appVal(a, 'volume')} onChange={(v) => setApp(a, { volume: v })} /><span className="num small">{Math.round(appVal(a, 'volume') * 100)}</span></div>
                    <MiniMeter level={lv(a.pids)} muted={appVal(a, 'muted') || muted} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <div className="strip panel mic-strip">
          <div className="strip-head">
            <span className="strip-icon red"><Icon.mic size={18} /></span>
            <span className="strip-name">Mic</span>
            {st.micChain?.enabled && <span className="strip-badge red">FX</span>}
            <button className="icon-btn tiny strip-gear" title="Mic chain" onClick={() => setDrawer({ type: 'mic' })}><Icon.settings size={14} /></button>
          </div>
          <Select className="strip-out" value={s.mic.deviceId} onChange={(v) => window.bsp.invoke('mixer:device', 'mic', v || st.defaultCommsInput, { select: v })}
            options={[{ value: null, label: `Default · ${inputs.find((o) => o.id === (st.defaultCommsInput || st.defaultInput))?.name || '—'}` }, ...inputs.map((o) => ({ value: o.id, label: o.name }))]} />
          {mic && <>
            <div className="strip-body">
              <Meter level={eng.micPost ?? levels.mic} muted={devVal('mic', mic, 'muted')} />
              <Fader value={devVal('mic', mic, 'volume') ?? 1} onChange={(v) => setDev('mic', mic, { volume: v })} height={streamMode ? 200 : 230} />
              <div className="strip-readout"><span className="big">{Math.round((devVal('mic', mic, 'volume') ?? 1) * 100)}</span><span className="unit">%</span></div>
            </div>
            <button className={`mute-btn${devVal('mic', mic, 'muted') ? ' active' : ''}`} onClick={() => setDev('mic', mic, { mute: !devVal('mic', mic, 'muted') })}>
              {devVal('mic', mic, 'muted') ? <Icon.micOff size={16} /> : <Icon.mic size={16} />}{devVal('mic', mic, 'muted') ? 'Mic muted' : 'Mute mic'}
            </button>
            <button className={`chain-btn${st.micChain?.enabled ? ' on' : ''}`} onClick={() => setDrawer({ type: 'mic' })}>
              <span>Mic chain</span>
              <span className="chain-tags">{st.micChain?.enabled ? ['Gate', 'NS', 'ClearCast', 'Comp', 'EQ'].filter((t, i) => [st.micChain.gate.enabled, st.micChain.ns.enabled, st.micChain.clearcast, st.micChain.comp.enabled, st.micChain.eq.enabled][i]).join(' · ') || 'on' : 'off'}</span>
            </button>
            <div className="mic-tools">
              <div className="mic-name">{mic.name}</div>
              <div className="row-between"><span className="muted-text">Live level meter</span><Toggle small on={s.mic.meter} onChange={(v) => window.bsp.invoke('mixer:device', 'mic', mic.id, { meter: v })} /></div>
              <button className="ghost-btn full" disabled={mic.default && mic.comms} onClick={() => window.bsp.invoke('mixer:device', 'mic', mic.id, { makeDefault: true })}>{mic.default && mic.comms ? 'Windows default mic' : 'Set as Windows default mic'}</button>
            </div>
          </>}
        </div>
      </section>

      {drawer?.type === 'channel' && <ChannelDrawer st={st} id={drawer.id} onClose={() => setDrawer(null)} />}
      {drawer?.type === 'mic' && <MicDrawer st={st} levels={eng} mic={mic} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function ChannelDrawer({ st, id, onClose }) {
  const meta = st.settings.channelList.find((c) => c.id === id);
  const [cfg, setCfg] = useState(st.settings.channels[id]);
  const [err, setErr] = useState('');
  const patch = async (p) => { const n = { ...cfg, ...p }; setCfg(n); const r = await window.bsp.invoke('mixer:channel', id, p); setErr(r && !r.ok ? r.error : ''); };
  const guarded = new Set(st.guarded || []);
  const cables = (st.cables || []).filter((c) => !guarded.has(c.id) || c.id === cfg.cableId);
  return (
    <Drawer title={`${meta.label} channel`} sub="Routing, equalizer and what this channel feeds" onClose={onClose} wide>
      <div className="seg">
        <button className={cfg.mode !== 'cable' ? 'on' : ''} onClick={() => patch({ mode: 'direct' })}><b>Direct</b><span>Apps keep playing to their device. Volume, mute and ChatMix work through Windows app volumes.</span></button>
        <button className={cfg.mode === 'cable' ? 'on' : ''} onClick={() => patch({ mode: 'cable', cableId: cfg.cableId || cables.find((c) => !c.ownedBySonar && !c.usedBy.length)?.id || null })}><b>Virtual cable</b><span>Apps play into a cable; Blur Sounds Pro applies EQ and mixes it to your headphones (Sonar-style).</span></button>
      </div>
      {cfg.mode === 'cable' ? (
        <div className="field-row">
          <span className="muted-text">Cable</span>
          <Select className="grow" value={cfg.cableId} onChange={(v) => patch({ cableId: v })}
            options={[{ value: null, label: 'Pick a cable…' }, ...cables.map((c) => ({ value: c.id, label: `${c.name}${c.ownedBySonar ? ' — used by SteelSeries Sonar' : ''}${c.usedBy.length && c.id !== cfg.cableId ? ` — in use: ${c.usedBy.join(', ')}` : ''}` }))]} />
        </div>
      ) : (
        <div className="field-row">
          <span className="muted-text">Output device</span>
          <Select className="grow" value={cfg.output} onChange={(v) => patch({ output: v })} options={[{ value: null, label: 'App default (don’t change)' }, ...st.outputs.filter((o) => !guarded.has(o.id)).map((o) => ({ value: o.id, label: o.name }))]} />
        </div>
      )}
      {guarded.size > 0 && <p className="hint">Your stream cable{st.micChain?.enabled && st.micChain?.outId ? ' and virtual-mic cable are' : ' is'} hidden here: apps playing into {st.micChain?.enabled && st.micChain?.outId ? 'them' : 'it'} would always be broadcast. Use the Stream toggle on each channel instead.</p>}
      {cfg.mode === 'cable' && cables.find((c) => c.id === cfg.cableId)?.ownedBySonar && <p className="warn-box">SteelSeries Sonar is running and already listens to this device. Using it here too will double the audio — pick a VB-Audio cable or close Sonar first.</p>}
      {err && <p className="warn-box">{err}</p>}
      <div className="row-gap wrap">
        <Toggle small on={cfg.inClip} onChange={(v) => patch({ inClip: v })} label="Include in clips" />
        <Toggle small on={cfg.inRec} onChange={(v) => patch({ inRec: v })} label="Include in recordings" />
      </div>
      <h4 className="drawer-sub">Equalizer</h4>
      <p className="hint">{cfg.mode === 'cable' ? 'Applied to what you hear, your stream mix, clips and recordings.' : 'Applied live to what you hear, your stream mix, clips and recordings. While it is on, Blur Sounds Pro plays this channel\'s apps through its EQ (about 40 ms extra delay); turn it off for untouched direct audio.'}</p>
      <EqEditor eq={cfg.eq} onChange={(eq) => patch({ eq })} />
      {!meta.builtin && <div className="row-gap" style={{ marginTop: 14 }}><button className="ghost-btn" onClick={async () => { await window.bsp.invoke('mixer:removeChannel', id); onClose(); }}><Icon.trash size={14} />Delete channel</button></div>}
    </Drawer>
  );
}

function MicDrawer({ st, levels, mic, onClose }) {
  const [mc, setMc] = useState(st.micChain);
  const [canUndo, setCanUndo] = useState(false); useEffect(() => { window.bsp.invoke('micchain:canUndo').then((v) => setCanUndo(!!v)).catch(() => {}); }, []); // v2.6.1
  const patch = (p) => { const n = { ...mc, ...p }; setMc(n); window.bsp.invoke('mic:chain', p); };
  const sub = (k, p) => patch({ [k]: { ...mc[k], ...p } });
  const isSonarMic = /sonar/i.test(mic?.name || '');
  const ns = levels.ns || {};
  const outs = st.outputs.filter((o) => /cable|vb-audio|voicemeeter/i.test(o.name));
  return (
    <Drawer title="Mic chain" sub={mic ? `Input: ${mic.name}` : ''} onClose={onClose} wide>
      <div className="row-between"><Toggle on={mc.enabled} onChange={(v) => patch({ enabled: v })} label="Process my mic" />
        <div className="chain-meters"><span>in</span><MiniMeter level={levels.micPre || 0} /><span>out</span><MiniMeter level={levels.micPost || 0} /></div></div>
      {isSonarMic && <p className="warn-box">Your selected mic is Sonar's virtual mic. Pick your real mic (e.g. your USB or headset mic) on the Mic strip so the chain isn't stacked on Sonar's processing.</p>}
      <div className="field-row"><span className="muted-text">Send processed mic to</span>
        <Select className="grow" value={mc.outId} onChange={(v) => patch({ outId: v })} options={[{ value: null, label: 'Nowhere (meters, clips and stream only)' }, ...outs.map((o) => ({ value: o.id, label: o.name }))]} /></div>
      {mc.outId && <p className="hint">In Discord / VRChat choose “{(st.cables || []).find((c) => c.id === mc.outId)?.recordName || 'the matching cable output'}” as your microphone.</p>}
      <div className="ab-bar">
        <div className="seg ab">
          <button className={!mc.bypass ? 'on' : ''} onClick={() => patch({ bypass: false })}><b>After</b><span>Processed voice</span></button>
          <button className={mc.bypass ? 'on' : ''} onClick={() => patch({ bypass: true })}><b>Before</b><span>Raw mic, no processing</span></button>
        </div>
        <div className="ab-side">
          <Toggle small on={!!mc.monitor?.enabled} onChange={(v) => sub('monitor', { enabled: v })} label="Hear myself" />
          {mc.monitor?.enabled && <input type="range" min={0} max={100} value={Math.round((mc.monitor.volume ?? 0.8) * 100)} onChange={(e) => sub('monitor', { volume: Number(e.target.value) / 100 })} />}
        </div>
      </div>
      <div className="row-between reset-chain"><span className="muted-text small">Sounds odd (muffled, robotic, cut off, too bassy)? Go back to the safe starting settings.</span>
        <button className="ghost-btn" onClick={async () => { if (!window.confirm('Reset the mic chain?\n\nGate, noise suppression, echo cancel, high-pass, compressor, EQ, gain and “Hear myself” go back to the safe defaults. Your mic, your virtual mic cable, “Process my mic” and “Mic on stream” stay as they are.')) return; const n = await window.bsp.invoke('micchain:reset'); if (n) { setMc(n); setCanUndo(true); } }}>Reset mic chain</button>
        {canUndo && <button className="ghost-btn" onClick={async () => { const n = await window.bsp.invoke('micchain:undoReset'); if (n) setMc(n); setCanUndo(false); }}>Undo reset</button>}</div>
      {mc.bypass && <p className="warn-box">Compare mode: everyone (stream, VRChat, Discord) is hearing your raw mic right now. Flip back to After when you're done.</p>}
      {mc.monitor?.enabled && <p className="hint">“Hear myself” plays your mic into {(st.outputs.find((o) => o.id === st.settings.personalOut) || {}).name || 'your headphones'}. Use headphones, not speakers, or it will feed back.</p>}
      <div className="fx-grid">
        <div className={`fx wide2${mc.ns.enabled ? ' on' : ''}`}>
          <div className="fx-head"><Toggle small on={mc.ns.enabled} onChange={(v) => sub('ns', { enabled: v })} /><b>AI noise suppression</b><span className="fx-tag">{ns.engine && ns.engine !== 'off' ? ns.engine : (mc.ns.engine === 'rnnoise' ? 'RNNoise' : 'DeepFilterNet3')}</span></div>
          <div className="seg mini">
            <button className={mc.ns.engine !== 'rnnoise' ? 'on' : ''} onClick={() => sub('ns', { engine: 'deep' })}><b>DeepFilterNet3</b><span>Strongest · CPU, any GPU</span></button>
            <button className={mc.ns.engine === 'rnnoise' ? 'on' : ''} onClick={() => sub('ns', { engine: 'rnnoise' })}><b>RNNoise</b><span>Lightest</span></button>
          </div>
          <label>Strength <span>{Math.round(mc.ns.amount * 100)}%{mc.ns.engine !== 'rnnoise' ? ` · up to ${Math.round(6 + mc.ns.amount * 94)} dB` : ''}</span><input type="range" min={0} max={100} value={Math.round(mc.ns.amount * 100)} onChange={(e) => sub('ns', { amount: Number(e.target.value) / 100 })} /></label>
          <div className="ns-stats"><span>Removing <b>{ns.cutDb ?? 0} dB</b></span><span>Voice SNR <b>{ns.lsnr ?? '—'} dB</b></span><span>CPU <b>{ns.cpuMs ?? 0} ms</b>/10 ms</span></div>
          {ns.error && <p className="warn-box">{ns.error}</p>}
        </div>
        <div className={`fx${mc.aec?.enabled ? ' on' : ''}`}>
          <div className="fx-head"><Toggle small on={!!mc.aec?.enabled} onChange={(v) => sub('aec', { enabled: v })} /><b>Echo cancellation</b><span className={`led${ns.refActive ? ' on' : ''}`} /></div>
          <label className="sel">Echo source<Select value={mc.aec?.refId || null} onChange={(v) => sub('aec', { refId: v })} options={[{ value: null, label: 'Auto (your game/headset output)' }, ...st.outputs.filter((o) => !(st.guarded || []).includes(o.id)).map((o) => ({ value: o.id, label: o.name }))]} /></label>
          <div className="seg mini three">
            {[['mild', 'Mild', 'Most natural'], ['strong', 'Strong', 'Recommended'], ['max', 'Max', 'Kills all echo']].map(([k, l, d]) => (
              <button key={k} className={(mc.aec?.strength || 'strong') === k ? 'on' : ''} onClick={() => sub('aec', { strength: k })}><b>{l}</b><span>{d}</span></button>))}
          </div>
          <div className="ns-stats"><span>Removing <b>{ns.aecCutDb ?? 0} dB</b></span><span>Delay <b>{ns.aecDelayMs ? `${ns.aecDelayMs} ms` : 'measuring…'}</b></span><span className={ns.nearTalk ? 'on' : ''}>{ns.nearTalk ? 'You + echo: protecting voice' : ns.refActive ? 'Echo only' : 'Quiet'}</span></div>
          <p className="hint">Subtracts what your headset plays from your mic, finds the delay automatically and backs off while you talk over it so your voice isn't chopped.</p>
        </div>
        <div className={`fx${mc.hpf?.enabled ? ' on' : ''}`}>
          <div className="fx-head"><Toggle small on={!!mc.hpf?.enabled} onChange={(v) => sub('hpf', { enabled: v })} /><b>High-pass</b><span className="fx-tag">24 dB/oct</span></div>
          <label>Cutoff <span>{mc.hpf?.freq ?? 90} Hz</span><input type="range" min={40} max={250} step={5} value={mc.hpf?.freq ?? 90} onChange={(e) => sub('hpf', { freq: Number(e.target.value) })} /></label>
          <p className="hint">Removes rumble, desk bumps and AC hum below your voice.</p>
        </div>
        <div className={`fx${mc.gate.enabled ? ' on' : ''}`}>
          <div className="fx-head"><Toggle small on={mc.gate.enabled} onChange={(v) => sub('gate', { enabled: v })} /><b>Voice gate</b><span className={`led${levels.gate ? ' on' : ''}`} /></div>
          <label>Threshold <span>{mc.gate.thresholdDb} dB</span><input type="range" min={-80} max={-10} value={mc.gate.thresholdDb} onChange={(e) => sub('gate', { thresholdDb: Number(e.target.value) })} /></label>
          <label>Hold <span>{mc.gate.holdMs ?? 150} ms</span><input type="range" min={0} max={800} step={10} value={mc.gate.holdMs ?? 150} onChange={(e) => sub('gate', { holdMs: Number(e.target.value) })} /></label>
          <label>Release <span>{mc.gate.releaseMs} ms</span><input type="range" min={20} max={600} value={mc.gate.releaseMs} onChange={(e) => sub('gate', { releaseMs: Number(e.target.value) })} /></label>
          <label>Floor <span>{mc.gate.rangeDb ?? -60} dB</span><input type="range" min={-80} max={-6} value={mc.gate.rangeDb ?? -60} onChange={(e) => sub('gate', { rangeDb: Number(e.target.value) })} /></label>
        </div>
        <div className={`fx${mc.clearcast ? ' on' : ''}`}>
          <div className="fx-head"><Toggle small on={mc.clearcast} onChange={(v) => patch({ clearcast: v })} /><b>ClearCast-style AI</b><span className="fx-tag">VAD {Math.round((levels.vad || 0) * 100)}%</span></div>
          <p className="hint">Uses the AI's voice detection to duck everything that isn't speech (keyboard clacks, breathing between words).</p>
        </div>
        <div className={`fx${mc.comp.enabled ? ' on' : ''}`}>
          <div className="fx-head"><Toggle small on={mc.comp.enabled} onChange={(v) => sub('comp', { enabled: v })} /><b>Compressor</b><span className="fx-tag">GR {levels.gr || 0} dB</span></div>
          <label>Threshold <span>{mc.comp.thresholdDb} dB</span><input type="range" min={-50} max={0} value={mc.comp.thresholdDb} onChange={(e) => sub('comp', { thresholdDb: Number(e.target.value) })} /></label>
          <label>Ratio <span>{mc.comp.ratio}:1</span><input type="range" min={1} max={10} step={0.5} value={mc.comp.ratio} onChange={(e) => sub('comp', { ratio: Number(e.target.value) })} /></label>
          <label>Makeup <span>{mc.comp.makeupDb} dB</span><input type="range" min={0} max={18} value={mc.comp.makeupDb} onChange={(e) => sub('comp', { makeupDb: Number(e.target.value) })} /></label>
        </div>
      </div>
      <div className="field-row"><span className="muted-text">Output gain</span><input type="range" className="grow" min={-12} max={12} step={0.5} value={mc.gainDb} onChange={(e) => patch({ gainDb: Number(e.target.value) })} /><span className="num">{mc.gainDb > 0 ? '+' : ''}{mc.gainDb}</span></div>
      <Toggle small on={mc.inStream} onChange={(v) => patch({ inStream: v })} label="Mic on stream (mix my mic into the stream mix)" />
      <h4 className="drawer-sub">Mic equalizer</h4>
      <p className="hint">{mc.enabled ? 'Shapes what Discord / VRChat / your stream hear. Turn on “Hear myself” to listen to it.' : 'Turn on “Process my mic” for the mic EQ to apply.'}</p>
      <EqEditor eq={mc.eq} onChange={(eq) => patch({ eq })} mic />
    </Drawer>
  );
}

function prettyApp(id) {
  const s = String(id).toLowerCase();
  for (const [k, v] of [['spotify', 'Spotify'], ['nocturne', 'Nocturne'], ['chrome', 'Chrome'], ['opera', 'Opera']]) if (s.includes(k)) return v;
  const base = String(id).split(/[!\\/]/).pop().replace(/\.exe$/i, '');
  return base.length > 18 ? base.slice(0, 18) + '…' : base;
}
