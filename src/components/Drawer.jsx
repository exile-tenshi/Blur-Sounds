import React from 'react';
export default function Drawer({ title, sub, onClose, children, wide }) {
  return (
    <div className="drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className={`drawer panel${wide ? ' wide' : ''}`}>
        <div className="drawer-head"><div><h3>{title}</h3>{sub && <p className="muted-text small">{sub}</p>}</div><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}
