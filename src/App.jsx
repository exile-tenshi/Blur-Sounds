import React, { useEffect, useState } from 'react';
import { Icon, Logo } from './components/Icons.jsx';
import Mixer from './pages/Mixer.jsx';
import Chatbox from './pages/Chatbox.jsx';
import Soundboard from './pages/Soundboard.jsx';
import Settings from './pages/Settings.jsx';
import Clips from './pages/Clips.jsx';
import Record from './pages/Record.jsx';
import Cables from './pages/Cables.jsx';
import EngineAlert from './EngineAlert.jsx';
import { ListenQuick } from './components/ListenSwitch.jsx';
import { HifiFirstRun } from './components/HifiCable.jsx';
import { SetupWizard, HealBanner } from './components/SetupWizard.jsx';
import { UpdateBadge, UpdateToast } from './components/Updater.jsx';

const NAV = [
  { id: 'mixer', label: 'Mixer', icon: Icon.mixer },
  { id: 'clips', label: 'Clips', icon: Icon.clip },
  { id: 'record', label: 'Record', icon: Icon.rec },
  { id: 'cables', label: 'Cables', icon: Icon.cable },
  { id: 'chatbox', label: 'Chatbox', icon: Icon.chat },
  { id: 'soundboard', label: 'Sounds', icon: Icon.pads },
  { id: 'settings', label: 'Settings', icon: Icon.settings },
];

export default function App() {
  const [settings, setSettings] = useState(null);
  const [page, setPage] = useState('mixer');
  const [helper, setHelper] = useState({ status: 'starting' });
  const [cb, setCb] = useState(null);
  const [wizard, setWizard] = useState(null); // null | 'first' | 'rerun'

  useEffect(() => {
    window.bsp.invoke('settings:get').then((s) => { setSettings(s); if (s.ui && s.ui.page) setPage(s.ui.page); if (!(s.app && s.app.setup && s.app.setup.done)) setWizard('first'); });
    const offs = [window.bsp.onHelper(setHelper), window.bsp.onChatbox(setCb)];
    const openW = () => setWizard('rerun'); window.addEventListener('bsp-setup-open', openW); offs.push(() => window.removeEventListener('bsp-setup-open', openW));
    return () => offs.forEach((f) => f());
  }, []);

  const update = async (keyPath, value) => { const s = await window.bsp.invoke('settings:set', keyPath, value); setSettings({ ...s }); return s; };
  const go = (id) => { setPage(id); update(['ui', 'page'], id); };
  if (!settings) return <div className="boot"><Logo size={56} /></div>;

  return (
    <div className="shell">
      <header className="titlebar">
        <div className="brand"><Logo size={24} /><span className="brand-name">BLUR SOUNDS</span><span className="brand-pro">PRO</span></div>
        <div className="title-status">
          <span className={`pill ${helper.status === 'running' ? 'ok' : 'warn'}`} title={helper.status === 'running' ? '' : [helper.message, helper.hint].filter(Boolean).join('\n')}><i />Audio engine {helper.status === 'running' ? 'online' : helper.status === 'failed' ? 'failed' : helper.status}</span>
          {helper.status === 'running' && <ListenQuick />}
          <RecPill go={go} />
          <UpdateBadge go={go} />
          <span className={`pill ${cb && cb.live ? 'live' : ''}`}><i />VRChat chatbox {cb && cb.live ? 'live' : 'off'}</span>
        </div>
        <div className="win-controls">
          <button onClick={() => window.bsp.invoke('win:control', 'min')} aria-label="Minimize"><svg width="10" height="10"><path d="M0 5h10" stroke="currentColor" /></svg></button>
          <button onClick={() => window.bsp.invoke('win:control', 'max')} aria-label="Maximize"><svg width="10" height="10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" /></svg></button>
          <button className="close" onClick={() => window.bsp.invoke('win:control', 'close')} aria-label="Close"><svg width="10" height="10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" /></svg></button>
        </div>
      </header>
      <nav className="rail">
        {NAV.map((n) => (
          <button key={n.id} className={`rail-item${page === n.id ? ' active' : ''}`} onClick={() => go(n.id)}>
            <n.icon size={20} /><span>{n.label}</span>
          </button>
        ))}
        <div className="rail-foot">v2.4</div>
      </nav>
      {helper.status === 'running' && !wizard && settings.app.setup?.done && <HifiFirstRun settings={settings} update={update} />}
      {wizard && <SetupWizard rerun={wizard === 'rerun'} onClose={async () => { setWizard(null); setSettings({ ...(await window.bsp.invoke('settings:get')) }); }} />}
      <main className="content">
        <HealBanner />
        {['failed', 'error', 'missing'].includes(helper.status) && page !== 'mixer' && <EngineAlert helper={helper} compact />}
        {page === 'mixer' && <Mixer />}
        {page === 'clips' && <Clips settings={settings} update={update} />}
        {page === 'record' && <Record settings={settings} update={update} />}
        {page === 'cables' && <Cables />}
        {page === 'chatbox' && <Chatbox settings={settings} update={update} setSettings={setSettings} state={cb} />}
        {page === 'soundboard' && <Soundboard settings={settings} update={update} setSettings={setSettings} />}
        {page === 'settings' && <Settings settings={settings} update={update} setSettings={setSettings} />}
      </main>
      <SoundEngine settings={settings} />
      <ClipToast settings={settings} />
      <UpdateToast />
    </div>
  );
}

// Always-mounted soundboard player so hotkeys work from any page.
function SoundEngine({ settings }) {
  useEffect(() => {
    const playing = new Set();
    const sinkFor = async (label) => {
      if (!label) return '';
      const devs = await navigator.mediaDevices.enumerateDevices();
      const d = devs.find((x) => x.kind === 'audiooutput' && x.label === label);
      return d ? d.deviceId : '';
    };
    const play = async (id) => {
      const sb = window.__bspSettings?.soundboard; if (!sb) return;
      const s = sb.sounds.find((x) => x.id === id); if (!s) return;
      const url = window.bsp.fileUrl(s.file);
      const vol = Math.max(0, Math.min(1, (sb.volume ?? 1) * (s.volume ?? 1)));
      const main = new Audio(url); main.volume = vol;
      const sink = await sinkFor(sb.outputLabel);
      if (sink && main.setSinkId) { try { await main.setSinkId(sink); } catch {} }
      playing.add(main); main.onended = () => playing.delete(main); main.play().catch(() => {});
      if (sb.monitor && sb.outputLabel) { const mon = new Audio(url); mon.volume = vol; playing.add(mon); mon.onended = () => playing.delete(mon); mon.play().catch(() => {}); }
      window.dispatchEvent(new CustomEvent('bsp-sound', { detail: id }));
    };
    const stop = () => { playing.forEach((a) => { a.pause(); }); playing.clear(); };
    window.__bspPlay = play; window.__bspStop = stop;
    const o1 = window.bsp.onSoundTrigger(play); const o2 = window.bsp.onSoundStop(stop);
    return () => { o1(); o2(); };
  }, []);
  useEffect(() => { window.__bspSettings = settings; }, [settings]);
  return null;
}

function RecPill({ go }) {
  const [rec, setRec] = useState(null);
  useEffect(() => window.bsp.onEngine((e) => setRec(e?.media?.recording || null)), []);
  return rec ? <button className="pill live" onClick={() => go('record')}><i />Recording</button> : null;
}

function ClipToast({ settings }) {
  const [t, setT] = useState(null);
  useEffect(() => window.bsp.onClipSaved((r) => {
    setT(r); setTimeout(() => setT((x) => (x === r ? null : x)), 4500);
    if (r.ok && window.__bspSettings?.clips?.sound) {
      try { const ac = new AudioContext(); const o = ac.createOscillator(); const g = ac.createGain(); o.type = 'triangle';
        o.frequency.setValueAtTime(880, ac.currentTime); o.frequency.setValueAtTime(1320, ac.currentTime + 0.09);
        g.gain.setValueAtTime(0.0001, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.3);
        o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.32); setTimeout(() => ac.close(), 600); } catch {}
    }
  }), []);
  if (!t) return null;
  return <div className={`toast${t.ok ? '' : ' bad'}`}><b>{t.ok ? 'Clip saved' : 'Clip failed'}</b><span>{t.ok ? `${t.why || ''} · ${t.path.split(/[\\/]/).pop()}` : t.error}</span></div>;
}
