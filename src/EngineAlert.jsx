import React, { useState } from 'react';

// Readable "audio engine isn't running" panel: what happened, how to fix it, Retry and the helper log.
export default function EngineAlert({ helper, compact }) {
  const [busy, setBusy] = useState(false);
  if (!helper) return null;
  const retry = async () => { setBusy(true); await window.bsp.invoke('helper:retry'); setTimeout(() => setBusy(false), 2500); };
  const msg = helper.message || (helper.status === 'starting' ? 'Starting the audio engine…' : `Engine status: ${helper.status}. ${helper.detail || ''}`);
  return (
    <div className={`engine-alert${compact ? ' compact' : ''}`}>
      <div className="engine-alert-text">
        <b>{msg}</b>
        {helper.hint && <span>{helper.hint}</span>}
        {helper.code && <small>Error code {helper.code}{helper.status === 'stopped' && !helper.fatal ? ' · restarting automatically' : ''}</small>}
      </div>
      <div className="engine-alert-actions">
        <button className="primary-btn" disabled={busy || helper.status === 'starting'} onClick={retry}>{busy ? 'Retrying…' : 'Retry'}</button>
        <button className="ghost-btn" onClick={() => window.bsp.invoke('helper:openLogs')}>Open logs</button>
      </div>
    </div>
  );
}
