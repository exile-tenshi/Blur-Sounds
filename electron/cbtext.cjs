// Text helpers for the chatbox: unicode fonts, case, emoji packs, borders, quotes, facts, profanity filter.
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', a = 'abcdefghijklmnopqrstuvwxyz', D = '0123456789';
const cp = (n) => String.fromCodePoint(n);
function block(up, low, dig, exc = {}) {
  const m = {};
  for (let i = 0; i < 26; i++) { m[A[i]] = exc[A[i]] || cp(up + i); m[a[i]] = exc[a[i]] || cp(low + i); }
  if (dig) for (let i = 0; i < 10; i++) m[D[i]] = cp(dig + i);
  return m;
}
function table(from, to) { const m = {}; const t = Array.from(to); Array.from(from).forEach((c, i) => { if (t[i] && t[i] !== '_') m[c] = t[i]; }); return m; }
const FONTS = {
  bold: block(0x1D400, 0x1D41A, 0x1D7CE),
  italic: block(0x1D434, 0x1D44E, 0, { h: 'ℎ' }),
  bolditalic: block(0x1D468, 0x1D482, 0x1D7CE),
  sansbold: block(0x1D5D4, 0x1D5EE, 0x1D7EC),
  script: block(0x1D4D0, 0x1D4EA, 0),
  fraktur: block(0x1D56C, 0x1D586, 0),
  double: block(0x1D538, 0x1D552, 0x1D7D8, { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' }),
  mono: block(0x1D670, 0x1D68A, 0x1D7F6),
  wide: Object.assign(block(0xFF21, 0xFF41, 0xFF10), { ' ': '　' }),
  circled: Object.assign(block(0x24B6, 0x24D0, 0), table(D, '⓪①②③④⑤⑥⑦⑧⑨')),
  smallcaps: table(a, 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ'),
  superscript: Object.assign(table(a, 'ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖ_ʳˢᵗᵘᵛʷˣʸᶻ'), table(A, 'ᴬᴮᶜᴰᴱᶠᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾ_ᴿˢᵀᵁⱽᵂˣʸᶻ'), table(D, '⁰¹²³⁴⁵⁶⁷⁸⁹'), { '+': '⁺', '-': '⁻', '(': '⁽', ')': '⁾' }),
};
function applyFont(s, font) {
  if (!font || font === 'normal') return s;
  if (font === 'strike') return Array.from(s).map((c) => (c === '\n' || c === ' ' ? c : c + '\u0336')).join('');
  const m = FONTS[font]; if (!m) return s;
  return Array.from(s).map((c) => m[c] || c).join('');
}
// v2.3.1 "Tiny text": superscript / small caps where a look-alike exists, everything else unchanged (all BMP: 1 UTF-16 unit each).
function applyTiny(s, mode) {
  if (mode === 'superscript') return Array.from(s).map((c) => FONTS.superscript[c] || c).join('');
  if (mode === 'smallcaps') return Array.from(s).map((c) => FONTS.smallcaps[c] || FONTS.smallcaps[c.toLowerCase()] || c).join('');
  return s;
}
function applyCase(s, mode) {
  if (mode === 'upper') return s.toUpperCase();
  if (mode === 'lower') return s.toLowerCase();
  if (mode === 'title') return s.replace(/\b([a-z])([a-z']*)/gi, (_, f, r) => f.toUpperCase() + r.toLowerCase());
  return s;
}
const PACKS = {
  default: { date: '📅', tz: '🌐', pc: '💻', net: '📶', uptime: '🖥️', battery: '🔋', countdown: '⏳', stopwatch: '⏱️', session: '⌛', afk: '💤', world: '🌍', players: '👥', hr: '❤️', twitch: '🟣', tiktok: '📱', quote: '💬', fact: '💡', play: '🕹️', join: '👋' },
  cute: { date: '🗓️', tz: '🌏', pc: '🖥️', net: '🫧', uptime: '🌱', battery: '🔋', countdown: '🎀', stopwatch: '⏰', session: '🌙', afk: '😴', world: '🌸', players: '🧸', hr: '💗', twitch: '💜', tiktok: '🎀', quote: '🌷', fact: '✨', play: '🎮', join: '🐾' },
  gamer: { date: '📆', tz: '🛰️', pc: '⚡', net: '📡', uptime: '🔋', battery: '🔋', countdown: '🚀', stopwatch: '⏱️', session: '🔴', afk: '🛌', world: '🗺️', players: '🎯', hr: '🫀', twitch: '🔴', tiktok: '🎬', quote: '🔥', fact: '🧠', play: '🎮', join: '➕' },
  minimal: Object.fromEntries(['date', 'tz', 'pc', 'net', 'uptime', 'battery', 'countdown', 'stopwatch', 'session', 'afk', 'world', 'players', 'hr', 'twitch', 'tiktok', 'quote', 'fact', 'play', 'join'].map((k) => [k, '▸'])),
  none: {},
};
function icon(pack, key) { const p = PACKS[pack] || PACKS.default; const v = pack === 'none' ? '' : (p[key] ?? PACKS.default[key] ?? ''); return v ? v + ' ' : ''; }
const BORDERS = { lines: ['━━━━━━━━━━━━', '━━━━━━━━━━━━'], stars: ['✦ · ✧ · ✦ · ✧ · ✦', '✦ · ✧ · ✦ · ✧ · ✦'], cute: ['⋆｡˚ ☁︎ ˚｡⋆｡˚☽˚｡⋆', '⋆｡˚ ☁︎ ˚｡⋆｡˚☽˚｡⋆'] };
const SPARKLES = ['✨', '💫', '⭐', '🌟', '✦', '🔥', '💖', '🌙', '🎶', '🫶', '💜', '🌸'];
const QUOTES = {
  motivation: ['Stay hungry, stay foolish.', 'Done is better than perfect.', 'Small steps every day.', 'You miss 100% of the shots you don’t take.', 'Hard work beats talent when talent doesn’t work hard.', 'Make it happen.', 'Be the energy you want to attract.', 'Progress, not perfection.', 'Dream big, start small.', 'Discipline is choosing what you want most.'],
  funny: ['I’m not lazy, I’m in energy-saving mode.', 'My bed is a magical place where I remember everything I forgot to do.', 'I put the “pro” in procrastinate.', 'Error 404: motivation not found.', 'I’m on a seafood diet. I see food, I eat it.', 'Running late is my cardio.', 'Do not disturb, already disturbed.', 'I came, I saw, I forgot why I came.', 'Brain.exe has stopped working.', 'Powered by snacks and vibes.'],
  chill: ['Good vibes only.', 'Breathe in, chill out.', 'Collect moments, not things.', 'Let it be.', 'Stay wavy.', 'Slow down, enjoy the view.', 'Mood: cozy.', 'Everything is fine ☕', 'Vibing at my own pace.', 'Nights like these.'],
};
const FACTS = ['Honey never spoils.', 'Octopuses have three hearts.', 'Bananas are berries, strawberries aren’t.', 'A day on Venus is longer than its year.', 'Sharks existed before trees.', 'Wombat poop is cube shaped.', 'There are more trees on Earth than stars in the Milky Way.', 'Sloths can hold their breath longer than dolphins.', 'The Eiffel Tower grows about 15 cm in summer.', 'Cows have best friends.', 'A group of flamingos is called a flamboyance.', 'Hot water can freeze faster than cold water.', 'Butterflies taste with their feet.', 'The heart of a shrimp is in its head.', 'Scotland’s national animal is the unicorn.', 'Otters hold hands while they sleep.', 'Lightning is 5x hotter than the Sun’s surface.', 'Koalas have fingerprints like humans.', 'A jiffy is 1/100th of a second.', 'Pineapples take about 2 years to grow.'];
const SWEARS = ['fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'shitty', 'bullshit', 'bitch', 'bitches', 'asshole', 'bastard', 'dick', 'dickhead', 'pussy', 'cunt', 'whore', 'slut', 'damn', 'goddamn', 'piss', 'cock', 'twat', 'wanker', 'prick', 'retard', 'fag', 'faggot', 'nigga', 'nigger'];
function profanity(text, mode, extra) {
  const words = [...SWEARS, ...String(extra || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean)];
  const esc = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((x, y) => y.length - x.length);
  const rx = new RegExp(`\\b(${esc.join('|')})\\b`, 'gi');
  let hit = false;
  const out = text.replace(rx, (w) => { hit = true; return mode === 'remove' ? '' : w[0] + '*'.repeat(Math.max(1, w.length - 1)); }).replace(/ {2,}/g, ' ');
  return { text: out, hit };
}
const CLOCKS = ['🕛', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚'];
const CLOCKS_HALF = ['🕧', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢', '🕣', '🕤', '🕥', '🕦'];
function clockEmoji(d) { const h = d.getHours() % 12; return d.getMinutes() >= 30 ? CLOCKS_HALF[h] : CLOCKS[h]; }
module.exports = { applyFont, applyTiny, applyCase, icon, PACKS, BORDERS, SPARKLES, QUOTES, FACTS, profanity, clockEmoji, FONTS };
