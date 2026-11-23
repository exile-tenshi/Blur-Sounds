import React, { useEffect, useState } from 'react';
import { Icon } from '../components/Icons.jsx';
import { Toggle, Select } from '../components/Controls.jsx';
import Library from '../components/Library.jsx';
import { useEngine, Stat } from './Clips.jsx';

const hms = (s) => { s = Math.floor(s); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

export default function Record({ settings, update }) {
  const r = settings.record;
  const es = useEngine(); const med = es?.media || {};
  const [mx, setMx] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [refresh, setRefresh] = useState(0); const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { const offs = [window.bsp.onMixer(setMx), window.bsp.onRecSaved((x) => { setRefresh((n) => n + 1); setMsg(x?.ok ? `Saved ${x.path.split(/[\\/]/).pop()}` : `Recording failed: ${x?.error}`); })]; return () => offs.forEach((f) => f()); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const rec = med.recording;
  const chans = mx?.settings?.channelList || [];
  return (
    <div className="page record-page">
      <section className="hero panel">
        <div className="hero-main">
          <div className="eyebrow">Recorder</div>
          <div className="rec-row">
            <button className={`rec-btn${rec ? ' on' : ''}`} disabled={busy} onClick={async () => {
              setBusy(true); setMsg('');
              if (rec) { await window.bsp.invoke('rec:stop'); } else { const x = await window.bsp.invoke('rec:start'); if (x && !x.ok) setMsg(x.error); }
              setBusy(false);
            }}>{rec ? <Icon.stop size={26} /> : <Icon.rec size={30} />}</button>
            <div>
              <div className={`rec-time${rec ? ' live' : ''}`}>{rec ? hms((now - rec.startedAt) / 1000) : '00:00:00'}</div>
              <div className="muted-text">{rec ? `Recording ${rec.video ? 'screen + audio' : 'audio'}…` : busy ? 'Finishing up…' : 'Ready to record'}</div>
            </div>
          </div>
          {msg && <p className="hint">{msg}</p>}
        </div>
        <div className="hero-status">
          <Stat label="Video" value={r.video ? (med.ffmpeg ? `Display ${settings.clips.video.display + 1} · ${settings.clips.video.fps} fps` : 'ffmpeg not found') : 'Off (audio only)'} ok={r.video && med.ffmpeg} />
          <Stat label="Saving to" value={med.recDir || '…'} ok />
          <button className="ghost-btn" onClick={() => window.bsp.invoke('clip:openDir', 'rec')}><Icon.folder size={14} />Open recordings folder</button>
        </div>
      </section>
      <section className="panel settings-strip">
        <div className="set"><span className="eyebrow">Capture</span><div className="row-gap"><Toggle small on={r.video} onChange={(v) => update(['record', 'video'], v)} label="Screen" /><Toggle small on={r.includeMic} onChange={(v) => update(['record', 'includeMic'], v)} label="My mic" /></div></div>
        <div className="set grow"><span className="eyebrow">Channels in the recording</span>
          <div className="row-gap wrap">{chans.map((c) => <Toggle key={c.id} small on={mx.settings.channels[c.id].inRec} onChange={(v) => window.bsp.invoke('mixer:channel', c.id, { inRec: v })} label={c.label} />)}</div></div>
      </section>
      <section className="panel lib-panel">
        <div className="row-between"><h3>Recordings</h3></div>
        <Library kind="rec" refreshKey={refresh} empty="No recordings yet." />
      </section>
    </div>
  );
}
