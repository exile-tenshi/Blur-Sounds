import React from 'react';
const P = ({ d, size = 18 }) => (<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={d} /></svg>);
export const Icon = {
  mixer: (p) => <P {...p} d="M5 3h2v6h2v2H7v10H5V11H3V9h2V3zm6 0h2v12h2v2h-2v4h-2v-4H9v-2h2V3zm6 0h2v4h2v2h-2v12h-2V9h-2V7h2V3z" />,
  chat: (p) => <P {...p} d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm3 6v2h2v-2H7zm4 0v2h2v-2h-2zm4 0v2h2v-2h-2z" />,
  pads: (p) => <P {...p} d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" />,
  settings: (p) => <P {...p} d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.3 7.3 0 0 0-1.7-1L15 3h-4l-.4 3a7.3 7.3 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1c.5.4 1.1.7 1.7 1l.3 3h4l.4-3c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.4-2.2-1.6zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" />,
  game: (p) => <P {...p} d="M7 7h10a5 5 0 0 1 4.9 6l-.7 3.4a2.5 2.5 0 0 1-4.3 1.1L14.5 15h-5l-2.4 2.5a2.5 2.5 0 0 1-4.3-1.1L2.1 13A5 5 0 0 1 7 7zm0 3v1.5H5.5v1H7V14h1v-1.5h1.5v-1H8V10H7zm9.5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />,
  headset: (p) => <P {...p} d="M12 2a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h2v-8H5v-2a7 7 0 0 1 14 0v2h-3v8h2a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9z" />,
  media: (p) => <P {...p} d="M9 3v11.6A4 4 0 1 0 11 18V8h6V3H9z" />,
  aux: (p) => <P {...p} d="M4 9h4l5-5v16l-5-5H4V9zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" />,
  vchange: (p) => <P {...p} d="M3 10h2v4H3v-4zm4-3h2v10H7V7zm4-4h2v18h-2V3zm4 4h2v10h-2V7zm4 3h2v4h-2v-4z" />,
  mic: (p) => <P {...p} d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zm7 9a7 7 0 0 1-6 6.9V21h3v2H8v-2h3v-3.1A7 7 0 0 1 5 11h2a5 5 0 0 0 10 0h2z" />,
  muted: (p) => <P {...p} d="M4 9h4l5-5v16l-5-5H4V9zm12.6.2 1.4-1.4 2 2 2-2 1.4 1.4-2 2 2 2-1.4 1.4-2-2-2 2-1.4-1.4 2-2-2-2z" />,
  speaker: (p) => <P {...p} d="M4 9h4l5-5v16l-5-5H4V9zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" />,
  micOff: (p) => <P {...p} d="M3.3 2 2 3.3l6 6V11a4 4 0 0 0 5.6 3.6l1.5 1.5A6 6 0 0 1 6 11H4a8 8 0 0 0 7 7.9V22h2v-3.1a7.9 7.9 0 0 0 3.6-1.4l4.1 4.1 1.3-1.3L3.3 2zM16 11V5a4 4 0 0 0-7.8-1.3L16 11.5V11zm2 0a6 6 0 0 1-.6 2.6l1.5 1.5A8 8 0 0 0 20 11h-2z" />,
  cable: (p) => <P {...p} d="M7 2h2v4h2v4a4 4 0 0 1-3 3.9V17a3 3 0 0 0 6 0v-1a5 5 0 0 1 10 0h-2a3 3 0 0 0-6 0v1a5 5 0 0 1-10 0v-3.1A4 4 0 0 1 3 10V6h2V2h2v4H7V2z" />,
  stream: (p) => <P {...p} d="M12 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM7.8 7.8l1.4 1.4a4 4 0 0 0 0 5.6l-1.4 1.4a6 6 0 0 1 0-8.4zm8.4 0a6 6 0 0 1 0 8.4l-1.4-1.4a4 4 0 0 0 0-5.6l1.4-1.4zM5 5l1.4 1.4a8 8 0 0 0 0 11.2L5 19A10 10 0 0 1 5 5zm14 0a10 10 0 0 1 0 14l-1.4-1.4a8 8 0 0 0 0-11.2L19 5z" />,
  clip: (p) => <P {...p} d="M4 5h11a2 2 0 0 1 2 2v2.5l4-2.5v10l-4-2.5V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm3 4v6l5-3-5-3z" />,
  rec: (p) => <P {...p} d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" />,
  folder: (p) => <P {...p} d="M3 5h7l2 2h9v12H3V5z" />,
  scissors: (p) => <P {...p} d="M9.6 8.2A3.5 3.5 0 1 0 8 9.9L10.1 12 8 14.1a3.5 3.5 0 1 0 1.6 1.7L12 13.4l7 7h3L9.6 8.2zM6 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 11a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm16-15h-3l-5.6 5.6 1.5 1.5L22 4z" />,
  voice: (p) => <P {...p} d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM3 9h2v4H3zm16 0h2v4h-2zM7 11a5 5 0 0 0 10 0h2a7 7 0 0 1-6 6.9V21h-2v-3.1A7 7 0 0 1 5 11h2z" />,
  play: (p) => <P {...p} d="M8 5v14l11-7z" />,
  pause: (p) => <P {...p} d="M6 5h4v14H6zm8 0h4v14h-4z" />,
  next: (p) => <P {...p} d="M6 6l8.5 6L6 18V6zm10 0h2v12h-2z" />,
  prev: (p) => <P {...p} d="M18 6v12l-8.5-6L18 6zM6 6h2v12H6z" />,
  send: (p) => <P {...p} d="M2 21l21-9L2 3v7l15 2-15 2z" />,
  plus: (p) => <P {...p} d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />,
  trash: (p) => <P {...p} d="M9 3h6l1 2h4v2H4V5h4l1-2zM6 9h12l-1 12H7L6 9z" />,
  stop: (p) => <P {...p} d="M6 6h12v12H6z" />,
  grip: (p) => <P {...p} d="M9 5h2v2H9zm4 0h2v2h-2zM9 11h2v2H9zm4 0h2v2h-2zm-4 6h2v2H9zm4 0h2v2h-2z" />,
  vr: (p) => <P {...p} d="M3 7h18a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-5l-2.5-3h-3L8 17H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm4 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm10 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" />,
  clock: (p) => <P {...p} d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 5v6l5 3 1-1.6-4-2.4V7h-2z" />,
  window: (p) => <P {...p} d="M3 4h18v16H3V4zm2 4v10h14V8H5z" />,
  status: (p) => <P {...p} d="M4 5h16v2H4zm0 6h10v2H4zm0 6h13v2H4z" />,
  bubble: (p) => <P {...p} d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-6l-4 3v-3H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />,
};
export function Logo({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg-r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ff3b46" /><stop offset="1" stopColor="#a90f19" /></linearGradient>
        <linearGradient id="lg-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f1f3f5" /><stop offset="1" stopColor="#8d939b" /></linearGradient>
      </defs>
      <path d="M8 6h30l18 18v34H26L8 40z" fill="#121418" stroke="url(#lg-s)" strokeWidth="2.5" />
      <rect x="18" y="30" width="5" height="16" fill="url(#lg-s)" />
      <rect x="27" y="22" width="5" height="24" fill="url(#lg-r)" />
      <rect x="36" y="26" width="5" height="20" fill="url(#lg-s)" />
      <rect x="45" y="34" width="5" height="12" fill="url(#lg-s)" />
    </svg>
  );
}
