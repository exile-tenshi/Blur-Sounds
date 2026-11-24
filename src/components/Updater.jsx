import React, { useEffect, useState } from 'react';
import { Toggle } from './Controls.jsx';

// v2.4.2 in-app updates from the public GitHub releases.
function useUpdate() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    let alive = true;
    window.bsp.invoke('update:get').then((s) => alive && s && setSt(s));
    const off = window.bsp.onUpdate ? window.bsp.onUpdate((s) => setSt((p) => ({ ...(p || {}), ...s }))) : () => {};
    return () => { alive = false; off(); };
  }, []);
  return [st, setSt];
}

export function UpdateBadge({ go }) {
  const [st] = useUpdate();
  if (!st || !['available', 'ready', 'downloading'].includes(st.status)) return null;
  return <button className="pill update" onClick={() => go('settings')} title={`Blur Sounds Pro ${st.latest} is available`}><i />Update {st.latest}</button>;
}

export function UpdateToast() {
  const [st, setSt] = useUpdate();
  const r = st && st.result; if (!r) return null;
  const close = () => { window.bsp.invoke('update:dismissResult'); setSt({ ...st, result: null }); };
  return <div className={`toast${r.ok ? '' : ' bad'}`} onClick={close}><b>{r.ok ? 'Updated' : 'Update rolled back'}</b><span>{r.message}</span></div>;
}

const notesText = (t) => String(t || '').replace(/\r/g, '').replace(/^#+\s*/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim();

export function UpdatePanel({ settings, update }) {
  const [st, setSt] = useUpdate();
  const [busy, setBusy] = useState(false);
  const s = st || { status: 'idle' };
  const check = async () => { setBusy(true); try { setSt(await window.bsp.invoke('update:check')); } finally { setBusy(false); } };
  const run = async () => { setBusy(true); try { const r = await window.bsp.invoke('update:run'); if (r) setSt(r); } finally { setBusy(false); } };
  const when = s.checkedAt ? new Date(s.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
  let line;
  if (s.status === 'checking') line = 'Checking GitHub for a new version…';
  else if (s.status === 'current') line = `You're on the latest version (${s.current}).${when ? ` Checked ${when}.` : ''}`;
  else if (s.status === 'available' || s.status === 'ready') line = `Version ${s.latest} is available. You have ${s.current}.`;
  else if (s.status === 'downloading') line = `Downloading ${s.latest}… ${Math.round((s.progress || 0) * 100)}%`;
  else if (s.status === 'installing') line = 'Installing: Blur Sounds Pro will close, update and reopen by itself.';
  else if (s.status === 'error' || s.status === 'noasset') line = s.error || 'The update check failed.';
  else line = `Version ${s.current || ''}. Updates come from the public Blur Sounds Pro releases on GitHub.`;
  const canRun = s.status === 'available' || s.status === 'ready';
  return (
    <section className="panel">
      <div className="panel-head"><h3>Updates</h3></div>
      <div className="setting"><div><b>{canRun ? `Blur Sounds Pro ${s.latest}` : 'Check for updates'}</b><p className={`muted-text${s.status === 'error' ? ' bad-text' : ''}`}>{line}</p>
          {s.status === 'downloading' && <div className="upd-bar"><i style={{ width: `${Math.round((s.progress || 0) * 100)}%` }} /></div>}</div>
        <div className="row-gap">
          {canRun && <button className="primary-btn" disabled={busy} onClick={run}>Update now</button>}
          <button className="ghost-btn" disabled={busy || ['checking', 'downloading', 'installing'].includes(s.status)} onClick={check}>Check for updates</button>
        </div></div>
      {canRun && s.notes && <div className="upd-notes"><div className="upd-notes-head">What's new in {s.latest}{s.url ? <> · <a href="#" onClick={(e) => { e.preventDefault(); window.bsp.invoke('app:openUrl', s.url); }}>release page</a></> : null}</div><pre>{notesText(s.notes)}</pre></div>}
      {canRun && <p className="hint">The download is checked against its published SHA-256 before anything changes. Your settings stay where they are, the current version is kept as “Blur Sounds Pro (previous version)” next to the app folder, and if the new version doesn't start it's put back automatically.</p>}
      <div className="setting"><div><b>Check on startup</b><p className="muted-text">Look for a new version each time the app opens (no account, nothing personal is sent).</p></div>
        <Toggle on={settings.app.autoUpdateCheck !== false} onChange={(v) => update(['app', 'autoUpdateCheck'], v)} /></div>
    </section>
  );
}
