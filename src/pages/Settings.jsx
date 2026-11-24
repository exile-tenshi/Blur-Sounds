import React, { useEffect, useState } from 'react';
import { Toggle } from '../components/Controls.jsx';
import { UpdatePanel } from '../components/Updater.jsx';

export default function Settings({ settings, update }) {
  const [info, setInfo] = useState(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { window.bsp.invoke('app:info').then(setInfo); }, []);
  const cb = settings.chatbox;
  return (
    <div className="page settings-page">
      <UpdatePanel settings={settings} update={update} />
      <section className="panel">
        <div className="panel-head"><h3>Setup wizard</h3></div>
        <div className="setting"><div><b>Run setup again</b><p className="muted-text">Walk through speakers, mic, virtual cable, Discord / VRChat, streaming and the VRChat chatbox again, with a check at each step.{settings.app.setup?.skipped ? ' (You skipped it last time.)' : ''}</p></div>
          <button className="primary-btn" onClick={() => window.dispatchEvent(new Event('bsp-setup-open'))}>Open setup</button></div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>General</h3></div>
        <div className="setting"><div><b>Start with Windows</b><p className="muted-text">Open Blur Sounds Pro when you sign in.</p></div><Toggle on={settings.app.startWithWindows} onChange={(v) => update(['app', 'startWithWindows'], v)} /></div>
        <div className="setting"><div><b>Close to tray</b><p className="muted-text">Keep the mixer, hotkeys and chatbox running when the window is closed.</p></div><Toggle on={settings.app.closeToTray} onChange={(v) => update(['app', 'closeToTray'], v)} /></div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>VRChat OSC</h3></div>
        <div className="setting"><div><b>Target</b><p className="muted-text">VRChat listens on 127.0.0.1:9000 by default. Enable OSC in VRChat's Action Menu → Options → OSC.</p></div>
          <div className="row-gap">
            <input className="text-input" value={cb.ip} onChange={(e) => update(['chatbox', 'ip'], e.target.value)} />
            <input className="num-input wide" type="number" value={cb.port} onChange={(e) => update(['chatbox', 'port'], Number(e.target.value) || 9000)} />
          </div>
        </div>
        <div className="setting"><div><b>Update interval</b><p className="muted-text">Seconds between chatbox updates. Never faster than 1.5s, so VRChat doesn't throttle you.</p></div>
          <input className="num-input wide" type="number" step={0.5} min={1.5} value={cb.sendIntervalSec} onChange={(e) => update(['chatbox', 'sendIntervalSec'], Math.max(1.5, Number(e.target.value) || 2))} /></div>
        <div className="setting"><div><b>Line separator</b><p className="muted-text">How modules are joined in the chatbox.</p></div>
          <div className="select"><select value={cb.separator} onChange={(e) => update(['chatbox', 'separator'], e.target.value)}>
            <option value="newline">New line</option><option value=" ┆ ">┆</option><option value=" | ">|</option><option value=" · ">·</option>
          </select></div></div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>Tools from Blur Sounds</h3></div>
        {info?.tools?.map((t) => (
          <div key={t.id} className="setting"><div><b>{t.name}</b><p className="muted-text mono">{t.path}</p></div>
            <button className="ghost-btn" disabled={!t.exists} onClick={async () => setMsg(String(await window.bsp.invoke('app:launchTool', t.id) || `Launched ${t.name}`))}>{t.exists ? 'Launch' : 'Not installed'}</button></div>
        ))}
        {msg && <p className="hint">{msg}</p>}
      </section>
      <section className="panel">
        <div className="panel-head"><h3>Mixer</h3></div>
        <div className="setting"><div><b>Reset per-app output routing</b><p className="muted-text">Clears every app's output-device override (same as Windows Settings → App volume and device preferences → Reset).</p></div>
          <button className="ghost-btn" onClick={() => window.bsp.invoke('mixer:resetRouting')}>Reset routing</button></div>
        <div className="setting"><div><b>Hidden apps</b><p className="muted-text">{(settings.mixer.hidden || []).join(', ') || 'None'}</p></div></div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>About</h3></div>
        <div className="setting"><div><b>Blur Sounds Pro {info?.version}</b><p className="muted-text mono">Settings: {info?.userData}</p></div>
          <button className="ghost-btn" onClick={() => window.bsp.invoke('app:openPath')}>Open data folder</button></div>
      </section>
    </div>
  );
}
