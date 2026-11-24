import React, { useEffect, useState } from 'react';
import { Icon } from './Icons.jsx';

const STEPS = [['download', 'Download from vb-audio.com'], ['verify', 'Check signature & hash'], ['extract', 'Unpack'], ['install', 'Install driver (admin)'], ['detect', 'Find the new devices']];
const BUSY = ['download', 'verify', 'extract', 'install', 'detect'];

export function useHifi() {
  const [h, setH] = useState(null);
  useEffect(() => {
    let live = true; const load = () => window.bsp.invoke('hifi:status').then((x) => live && setH(x));
    load(); const off = window.bsp.onHifi((x) => setH((o) => ({ ...(o || {}), ...x }))); const offM = window.bsp.onMixer(() => window.bsp.invoke('hifi:status').then((x) => live && setH((o) => ({ ...(o || {}), ...x }))));
    return () => { live = false; off(); offM(); };
  }, []);
  return h;
}
const open = (u) => window.bsp.invoke('app:openUrl', u);

export function HifiCredit({ h }) {
  return <p className="hint hifi-credit">Hi-Fi Cable is made by <b>VB-Audio Software</b> (Vincent Burel) and is <b>donationware</b>: free for personal use, pay what you want if you find it useful. Blur Sounds Pro downloads the official installer from vb-audio.com; it doesn't include the driver. <a onClick={() => open(h?.page || 'https://vb-audio.com/Cable/')}>vb-audio.com/Cable</a> · <a onClick={() => open(h?.donate || 'https://vb-audio.com/Voicemeeter/Donationware.htm')}>Support VB-Audio (donate)</a></p>;
}

export function HifiPanel() {
  const h = useHifi(); const [confirmRestart, setConfirmRestart] = useState(false);
  if (!h) return null;
  const busy = BUSY.includes(h.phase); const idx = STEPS.findIndex(([k]) => k === h.phase);
  const install = () => window.bsp.invoke('hifi:install');
  const drv = h.driver || {};
  return (
    <section className="panel hifi-panel">
      <div className="row-between">
        <div className="hifi-title"><span className="strip-icon red"><Icon.cable size={18} /></span>
          <div><h3>VB-Audio Hi-Fi Cable</h3><p className="muted-text small">The virtual cable Blur Sounds Pro sends your stream mix and processed mic through (VRChat / OBS record “Hi-Fi Cable Output”).</p></div></div>
        {h.installed ? <span className="pill ok"><i />Installed</span> : h.phase === 'reboot' ? <span className="pill warn"><i />Restart needed</span> : <span className="pill warn"><i />Not installed</span>}
      </div>
      {h.installed && !busy && (
        <div className="hifi-status">
          <div><span className="muted-text small">Apps play into</span><b>{h.inputName}</b></div>
          <div><span className="muted-text small">Record / VRChat mic from</span><b>{h.outputName}</b></div>
          {drv.registered && <div><span className="muted-text small">Driver</span><b>{drv.device || drv.name}{drv.deviceStatus ? ` · ${drv.deviceStatus}` : ''}</b></div>}
        </div>)}
      {!h.installed && !busy && h.phase !== 'reboot' && h.partial && <p className="hint">Only one side of the cable is showing. It may be disabled in Windows Sound settings, or the install didn't finish. Repair usually fixes it.</p>}
      {(busy || ['done', 'failed', 'cancelled', 'ready'].includes(h.phase)) && (
        <ol className="hifi-steps">
          {STEPS.map(([k, label], i) => (
            <li key={k} className={h.phase === k ? 'now' : (idx > i || h.phase === 'done' || (h.phase === 'ready' && i < 3)) ? 'done' : ''}>
              {label}{h.phase === k && k === 'download' && h.pct != null ? ` · ${h.pct}%` : ''}{h.phase === k && k === 'install' ? ' · approve the Windows prompt, then click “Install Driver” in the VB-Audio window' : ''}
            </li>))}
        </ol>)}
      {h.verified && <p className="hint">Verified: signed by {String(h.verified.signer || '').replace(/,.*$/, '').replace(/^CN=/, '')} ({h.verified.signature}){h.verified.pinned ? ', matches the known v1.0.0.7 package' : ', newer VB-Audio package (signature checked)'}.</p>}
      {h.phase === 'done' && <p className="hint ok-text">Hi-Fi Cable is ready.{h.configured && h.configured.changes.length ? ' ' + h.configured.changes.join(' · ') + '.' : ''} In VRChat pick <b>{h.outputName}</b> as your microphone.</p>}
      {h.phase === 'reboot' && <p className="hint">The driver is installed but Windows needs a restart before the cable shows up. Blur Sounds Pro will pick it up automatically afterwards.</p>}
      {h.phase === 'failed' && <p className="hint bad-text">Install failed: {h.error}</p>}
      {h.phase === 'cancelled' && <p className="hint">{h.error} Nothing was changed.</p>}
      <div className="row-gap">
        {!h.installed && h.phase !== 'reboot' && <button className="primary-btn" disabled={busy} onClick={install}>{busy ? 'Installing…' : h.phase === 'failed' || h.phase === 'cancelled' ? 'Try again' : 'Install Hi-Fi Cable'}</button>}
        {h.installed && <button className="ghost-btn" disabled={busy} onClick={install}>{busy ? 'Working…' : 'Reinstall / repair…'}</button>}
        {h.installed && <button className="ghost-btn" onClick={() => window.bsp.invoke('hifi:configure')}>Use it for my stream</button>}
        {h.phase === 'reboot' && (confirmRestart
          ? <><button className="ghost-btn" onClick={() => setConfirmRestart(false)}>Later</button><button className="primary-btn" onClick={() => window.bsp.invoke('hifi:restart')}>Restart Windows now</button></>
          : <button className="primary-btn" onClick={() => setConfirmRestart(true)}>Restart to finish…</button>)}
      </div>
      {h.installed && !busy && <p className="hint">Repair re-runs VB-Audio's official setup: choose “Install Driver” to repair, or “Remove Driver” to uninstall (restart Windows afterwards).</p>}
      <HifiCredit h={h} />
    </section>
  );
}

// First run: shown once when the cable is missing.
export function HifiFirstRun({ settings, update }) {
  const h = useHifi(); const [hide, setHide] = useState(false);
  if (!h || hide || h.installed || !settings || settings.app.hifiPromptDismissed || !h.driver || h.driver.registered || h.phase === 'reboot') return null;
  if (!h.inputName && h.phase === 'idle' && h.driver === undefined) return null;
  const busy = BUSY.includes(h.phase);
  const dismiss = () => { setHide(true); update(['app', 'hifiPromptDismissed'], true); };
  return (
    <div className="modal-back"><div className="modal panel hifi-first">
      <h2>Install Hi-Fi Cable?</h2>
      <p>Blur Sounds Pro sends your stream mix and your processed mic to VRChat / OBS through VB-Audio's free <b>Hi-Fi Cable</b>. It isn't installed on this PC yet.</p>
      <HifiPanel />
      <div className="row-gap"><span className="spacer" /><button className="ghost-btn" disabled={busy} onClick={dismiss}>{h.phase === 'done' ? 'Close' : 'Not now'}</button></div>
    </div></div>
  );
}
