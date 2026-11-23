// Import your settings from the standalone MagicChatbox (read-only).
const fs = require('fs');
const path = require('path');

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } }

function mcbDir() { return path.join(process.env.APPDATA || '', 'Vrcosc-MagicChatbox'); }

function importMagicChatbox(settings) {
  const dir = mcbDir();
  if (!fs.existsSync(dir)) return { ok: false, error: 'MagicChatbox data folder not found' };
  const cb = settings.chatbox; const found = [];
  const status = readJson(path.join(dir, 'StatusList.json'));
  const list = Array.isArray(status) ? status : status && status.Items;
  if (Array.isArray(list) && list.length) {
    const skip = new Set(['Enjoy 💖', 'Below you can create your own status']);
    const items = list.filter((i) => i && i.msg && !skip.has(i.msg))
      .sort((a, b) => (b.IsActive ? 1 : 0) - (a.IsActive ? 1 : 0) || String(b.LastUsed).localeCompare(String(a.LastUsed)))
      .map((i) => ({ text: i.msg, enabled: !!(i.IsActive || i.UseInCycle), favorite: !!i.IsFavorite }));
    if (items.length) { cb.modules.status.items = items; found.push(`${items.length} statuses`); }
  }
  const osc = readJson(path.join(dir, 'OscSettings.json'));
  if (osc) { cb.ip = osc.OscIP || cb.ip; cb.port = osc.OscPortOut || cb.port; found.push('OSC target'); }
  const time = readJson(path.join(dir, 'TimeSettings.json'));
  if (time) { cb.modules.time.h24 = !!time.Time24H; found.push('time format'); }
  const app = readJson(path.join(dir, 'AppSettings.json'));
  if (app) {
    if (app.SwitchStatusInterval) cb.modules.status.rotateSec = app.SwitchStatusInterval;
    cb.modules.status.random = !!app.IsRandomCycling;
    cb.separator = app.SeperateWithENTERS ? 'newline' : (app.OscMessageSeparator || ' ┆ ');
    found.push('rotation + separator');
  }
  const media = readJson(path.join(dir, 'MediaLinkSettings.json'));
  if (media) {
    const sep = media.Separator || ' ᵇʸ ';
    cb.modules.nowPlaying.template = `🎵 {title}${sep}{artist}`;
    cb.modules.nowPlaying.pausedTemplate = `${media.IconPause || '⏸'} ${media.TextPaused || 'Paused'}`;
    cb.modules.nowPlaying.enabled = !media.Disabled;
    found.push('now playing style');
  }
  const win = readJson(path.join(dir, 'WindowActivitySettings.json'));
  if (win) { cb.modules.focus.enabled = !!win.ShowFocusedApp; cb.modules.focus.template = `${win.DesktopFocusTitle || 'ⁱⁿ'} {app}`; found.push('focused app'); }
  settings.app.importedMagicChatbox = true;
  return { ok: true, found };
}

module.exports = { importMagicChatbox, mcbDir };
