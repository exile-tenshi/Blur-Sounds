# Generates electron/cbschema.json: every Chatbox option (new ones are counted; legacy ones carry a settings "path").
import json, os
def B(id, label, d=False, help=''): return dict(id=id, type='bool', label=label, default=d, help=help)
def N(id, label, d, mn, mx, step=1, unit='', help=''): return dict(id=id, type='num', label=label, default=d, min=mn, max=mx, step=step, unit=unit, help=help)
def T(id, label, d='', help='', ph=''): return dict(id=id, type='text', label=label, default=d, help=help, placeholder=ph)
def S(id, label, d, opts, help=''): return dict(id=id, type='select', label=label, default=d, options=[dict(value=v, label=l) for v, l in opts], help=help)
def L(id, label, d, help='', ph=''): return dict(id=id, type='list', label=label, default=d, help=help, placeholder=ph)
def W(id, label, widget, d=None, help=''): return dict(id=id, type='widget', widget=widget, label=label, default=d, help=help)
def LEG(path, type_, label, **kw): return dict(id='legacy:' + '.'.join(path), path=path, type=type_, label=label, legacy=True, **kw)

cats = [('weather', 'Weather'), ('system', 'PC & system'), ('time', 'Time & timers'), ('music', 'Music'), ('vrchat', 'VRChat'), ('stream', 'Streaming'), ('style', 'Text & style'), ('behavior', 'Behavior')]
MODS = [('status', 'Status'), ('message', 'Message'), ('nowPlaying', 'Now playing'), ('focus', 'Focused app'), ('time', 'Time'), ('date', 'Date'), ('tz', 'Second clock'),
        ('weather', 'Weather'), ('pc', 'PC stats'), ('net', 'Ping'), ('uptime', 'Uptime'), ('battery', 'Battery'), ('countdown', 'Countdown'), ('stopwatch', 'Stopwatch'),
        ('session', 'Session timer'), ('afk', 'AFK'), ('vrcWorld', 'VRChat world'), ('vrcPlayers', 'Player count'), ('vrcMute', 'Mic mute'), ('hr', 'Heart rate'),
        ('twitch', 'Twitch'), ('tiktok', 'TikTok'), ('quote', 'Quote'), ('fact', 'Fun fact'), ('marquee', 'Marquee')]
TZ = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo',
      'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Moscow', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Shanghai',
      'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland', 'UTC']

groups = [
 dict(id='weather', cat='weather', label='Weather', icon='weather', module='weather', widget='weather', fields=[
   B('weather.enabled', 'Show weather', True),
   S('weather.units', 'Temperature', 'F', [('F', '°F'), ('C', '°C')]),
   S('weather.wind', 'Wind speed', 'mph', [('mph', 'mph'), ('kmh', 'km/h'), ('ms', 'm/s'), ('kn', 'knots')]),
   B('weather.auto', 'Detect location from my IP', True, 'Free IP lookup (ipwho.is, falls back to ip-api.com). No key.'),
   T('weather.city', 'City override', '', 'Type a city to use it instead of the IP location (e.g. "Orlando" or "Orlando, FL").', 'Auto'),
   S('weather.preset', 'Format', 'auto', [('auto', 'Auto — most detail that fits'), ('full', 'Full — everything'), ('standard', 'Standard'), ('short', 'Short — temp, sky, high/low'), ('compact', 'Compact'), ('minimal', 'Minimal (icon + temp)'), ('custom', 'Custom template')]),
   T('weather.template', 'Custom template', '{icon} {temp} {cond} · H{hi} L{lo} · feels {feels}', 'Tokens: {icon} {temp} {cond} {hi} {lo} {feels} {wind} {hum} {city} {rain}'),
   B('weather.showCity', 'Show city name'),
   N('weather.refreshMin', 'Refresh every', 10, 5, 60, 1, 'min'),
   B('weather.tomorrow', "Add tomorrow's high/low"),
   B('weather.rain', 'Add chance of rain today'),
   B('weather.sun', 'Add next sunrise / sunset'),
 ]),
 dict(id='pc', cat='system', label='PC stats', icon='pc', module='pc', fields=[
   B('pc.enabled', 'Show PC stats'),
   B('pc.cpu', 'CPU usage', True), B('pc.gpu', 'GPU usage', True), B('pc.ram', 'RAM usage', True),
   S('pc.ramMode', 'RAM as', 'percent', [('percent', 'Percent'), ('gb', 'Used / total GB')]),
   B('pc.vram', 'GPU memory (VRAM)'),
   B('pc.temps', 'Temperatures (where Windows/driver exposes them)'),
   T('pc.gpuName', 'GPU label', '', 'Shown in front of the GPU numbers. Empty = "GPU".'),
   S('pc.style', 'Style', 'text', [('text', 'Numbers (CPU 12%)'), ('bars', 'Bars (CPU ▰▰▱▱▱)')]),
 ]),
 dict(id='net', cat='system', label='Network ping', icon='net', module='net', fields=[
   B('net.enabled', 'Show ping'), T('net.host', 'Ping host', '1.1.1.1'), B('net.quality', 'Quality dot (🟢🟡🔴)', True),
 ]),
 dict(id='sys', cat='system', label='Uptime & battery', icon='pc', fields=[
   B('uptime.enabled', 'PC uptime'), B('battery.enabled', 'Battery level (hidden when there is no battery)'),
 ]),
 dict(id='afk', cat='system', label='AFK detection', icon='afk', module='afk', fields=[
   B('afk.enabled', 'Show AFK when idle'), N('afk.minutes', 'Idle after', 5, 1, 60, 1, 'min'), T('afk.text', 'AFK text', '💤 AFK {dur}', '{dur} = how long you have been idle. Also triggers from the VRChat AFK parameter when OSC input is on.'),
 ]),
 dict(id='focus', cat='system', label='Focused app', icon='window', module='focus', fields=[
   LEG(['chatbox', 'modules', 'focus', 'enabled'], 'bool', 'Show focused app'),
   LEG(['chatbox', 'modules', 'focus', 'template'], 'text', 'Format ({app})'),
   B('focus.playtime', 'Add playtime in the current app/game', help='Time since the focused program started.'),
   T('focus.ignore', 'Never show these apps', 'explorer, BlurSoundsPro, ShellExperienceHost, SearchHost', 'Comma separated process names.'),
 ]),
 dict(id='time', cat='time', label='Clock', icon='clock', module='time', fields=[
   LEG(['chatbox', 'modules', 'time', 'enabled'], 'bool', 'Show time'),
   LEG(['chatbox', 'modules', 'time', 'h24'], 'bool', '24-hour'),
   LEG(['chatbox', 'modules', 'time', 'showSeconds'], 'bool', 'Seconds'),
   LEG(['chatbox', 'modules', 'time', 'prefix'], 'text', 'Prefix'),
   B('time.emojiClock', 'Clock emoji follows the hour (🕐…🕛)'),
   B('time.blink', 'Blinking colon'),
 ]),
 dict(id='date', cat='time', label='Date', icon='clock', module='date', fields=[
   B('date.enabled', 'Show date'),
   S('date.format', 'Date format', 'short', [('short', 'Sun, Nov 22'), ('long', 'Sunday, November 22'), ('us', '11/22/2026'), ('eu', '22/11/2026'), ('iso', '2026-11-22'), ('day', 'Sunday')]),
 ]),
 dict(id='tz', cat='time', label='Second time zone', icon='clock', module='tz', fields=[
   B('tz.enabled', 'Show a second clock'), S('tz.zone', 'Time zone', 'Europe/London', [(z, z.replace('_', ' ')) for z in TZ]), T('tz.label', 'Label', 'UK'),
 ]),
 dict(id='countdown', cat='time', label='Countdown', icon='clock', module='countdown', fields=[
   B('countdown.enabled', 'Show countdown'), dict(id='countdown.target', type='datetime', label='Count down to', default=''),
   T('countdown.label', 'Event name', 'New Year'), T('countdown.format', 'Format', '⏳ {label} in {left}'), T('countdown.done', 'When finished', '🎉 {label}!'),
 ]),
 dict(id='stopwatch', cat='time', label='Stopwatch', icon='clock', module='stopwatch', widget='stopwatch', fields=[
   B('stopwatch.enabled', 'Show stopwatch'), T('stopwatch.format', 'Format', '⏱ {time}'),
 ]),
 dict(id='session', cat='time', label='Session timer', icon='clock', module='session', fields=[
   B('session.enabled', 'Time since I went live'), T('session.format', 'Format', '⌛ live {time}'),
 ]),
 dict(id='music', cat='music', label='Now playing', icon='media', module='nowPlaying', fields=[
   LEG(['chatbox', 'modules', 'nowPlaying', 'enabled'], 'bool', 'Show now playing'),
   S('np.preset', 'Layout', 'custom', [('custom', 'My template'), ('default', '🎵 Title ᵇʸ Artist'), ('compact', 'Title - Artist'), ('artist', 'Artist — Title'), ('title', 'Title only'), ('fancy', '「Title」 ⁻ Artist')]),
   LEG(['chatbox', 'modules', 'nowPlaying', 'template'], 'text', 'My template ({title} {artist} {album})'),
   LEG(['chatbox', 'modules', 'nowPlaying', 'progress'], 'bool', 'Show time 2:04/6:26'),
   LEG(['chatbox', 'modules', 'nowPlaying', 'showPaused'], 'bool', 'Show when paused'),
   S('np.icon', 'Icon', '🎵', [('🎵', '🎵'), ('🎧', '🎧'), ('🎶', '🎶'), ('💿', '💿'), ('🔊', '🔊'), ('', 'None')]),
   B('np.bar', 'Progress bar'),
   S('np.barStyle', 'Bar style', 'line', [('line', '▬▬▬●───'), ('heavy', '━━━╸───'), ('blocks', '▰▰▰▱▱▱'), ('dots', '●●●○○○'), ('shade', '███░░░')]),
   N('np.barLength', 'Bar length', 10, 4, 16, 1, 'chars'),
   B('np.album', 'Add album name'),
   N('np.maxTitle', 'Shorten titles longer than', 40, 10, 100, 1, 'chars'),
   B('np.source', 'Add player name (on Spotify)'),
   T('np.paused', 'Paused text', '⏸ {title}', 'Used when "Show when paused" is on.'),
 ]),
 dict(id='vrcworld', cat='vrchat', label='World & instance', icon='vr', module='vrcWorld', fields=[
   B('vrc.world', 'Show world name', help='Read from your VRChat log file (no login needed).'),
   B('vrc.instance', 'Instance type & region'),
   B('vrc.timeInWorld', 'Time in this world'),
   B('vrc.privacy', 'Hide world in private / invite instances', True),
 ]),
 dict(id='vrcplayers', cat='vrchat', label='Players', icon='vr', module='vrcPlayers', fields=[
   B('vrc.players', 'Player count'), B('vrc.joinNotice', 'Show who just joined (8 s)'),
 ]),
 dict(id='vrcosc', cat='vrchat', label='Avatar OSC (mute, heart rate)', icon='vr', module='vrcMute', fields=[
   B('vrc.mute', 'Show when my mic is muted (MuteSelf)'), T('vrc.muteText', 'Muted text', '🔇 muted'),
   B('hr.enabled', 'Heart rate from avatar parameter'), T('hr.param', 'Heart-rate parameter', '', 'Empty = auto (HR, Heartrate, HeartRateInt, BPM…).', 'auto'),
   T('hr.format', 'Heart-rate format', '❤️ {bpm} bpm'),
   N('osc.port', 'Listen for VRChat OSC on port', 9001, 1024, 65535, 1, '', 'VRChat sends avatar parameters to 9001. If another OSC app owns that port, use an OSC router.'),
 ]),
 dict(id='twitch', cat='stream', label='Twitch', icon='stream', module='twitch', fields=[
   B('twitch.enabled', 'Show Twitch status'), T('twitch.channel', 'Channel', ''),
   B('twitch.viewers', 'Viewer count', True), B('twitch.uptime', 'Stream uptime', True), B('twitch.game', 'Category / game'),
   T('twitch.offline', 'When offline show', '', 'Empty hides the line while offline.', 'hidden'),
 ]),
 dict(id='tiktok', cat='stream', label='TikTok', icon='stream', module='tiktok', fields=[
   B('tiktok.enabled', 'Show TikTok handle'), T('tiktok.handle', 'Handle', ''), T('tiktok.format', 'Format', '📱 tiktok @{handle}'),
 ]),
 dict(id='font', cat='style', label='Font & case', icon='text', fields=[
   S('style.font', 'Unicode font', 'normal', [('normal', 'Normal'), ('smallcaps', 'ꜱᴍᴀʟʟ ᴄᴀᴘꜱ'), ('superscript', 'ˢᵘᵖᵉʳˢᶜʳᶦᵖᵗ'), ('bold', '𝐁𝐨𝐥𝐝'), ('italic', '𝐼𝑡𝑎𝑙𝑖𝑐'), ('bolditalic', '𝑩𝒐𝒍𝒅 𝒊𝒕𝒂𝒍𝒊𝒄'),
     ('sansbold', '𝗦𝗮𝗻𝘀 𝗯𝗼𝗹𝗱'), ('script', '𝓢𝓬𝓻𝓲𝓹𝓽'), ('fraktur', '𝕱𝖗𝖆𝖐𝖙𝖚𝖗'), ('double', '𝔻𝕠𝕦𝕓𝕝𝕖'), ('mono', '𝙼𝚘𝚗𝚘'), ('wide', 'Ｗｉｄｅ'), ('circled', 'Ⓒⓘⓡⓒⓛⓔⓓ'), ('strike', 'S̶t̶r̶i̶k̶e̶')]),
   S('style.fontScope', 'Apply font to', 'all', [('all', 'Everything'), ('status', 'Status & messages only'), ('labels', 'Everything except music titles')]),
   S('style.case', 'Letter case', 'normal', [('normal', 'As typed'), ('upper', 'UPPERCASE'), ('lower', 'lowercase'), ('title', 'Title Case')]),
 ]),
 dict(id='layout', cat='style', label='Layout & decoration', icon='text', fields=[
   LEG(['chatbox', 'separator'], 'select', 'Separator', options=[dict(value='newline', label='New line'), dict(value=' | ', label=' | '), dict(value=' • ', label=' • '), dict(value=' ┆ ', label=' ┆ '), dict(value=' ⋆ ', label=' ⋆ '), dict(value=' ~ ', label=' ~ '), dict(value='custom', label='Custom…')]),
   T('style.customSep', 'Custom separator', ' ✧ ', 'Used when Separator is "Custom…".'),
   S('style.layout', 'Line layout', 'lines', [('lines', 'Use separator'), ('pairs', 'Two modules per line'), ('single', 'Everything on one line')]),
   S('style.border', 'Border', 'none', [('none', 'None'), ('lines', '━━━ top & bottom'), ('stars', '✦ · ✧ top & bottom'), ('cute', '⋆｡˚☁︎˚｡⋆ top & bottom'), ('arrows', '➤ before each line'), ('bullets', '• before each line')]),
   T('style.wrap', 'Wrap the whole box with', '', 'e.g. ✧ adds it at the start and end.'),
   S('style.emojiPack', 'Emoji pack', 'default', [('default', 'Default 💻🌍❤️'), ('cute', 'Cute 🌸🫧💗'), ('gamer', 'Gamer 🎮⚡🔥'), ('minimal', 'Minimal ▸'), ('none', 'No icons')]),
   B('style.randomEmoji', 'Random sparkle emoji at the end'),
   W('style.prefix', 'Per-module prefix', 'affix', {}), W('style.suffix', 'Per-module suffix', 'affix', {}),
 ]),
 dict(id='quotes', cat='style', label='Quotes & facts', icon='bubble', module='quote', fields=[
   B('quotes.enabled', 'Random quotes'), S('quotes.pack', 'Quote pack', 'all', [('all', 'All'), ('motivation', 'Motivational'), ('funny', 'Funny'), ('chill', 'Chill / vibes')]),
   N('quotes.rotateSec', 'New quote every', 60, 10, 600, 5, 's'),
   B('facts.enabled', 'Random fun facts'), N('facts.rotateSec', 'New fact every', 90, 10, 600, 5, 's'),
 ]),
 dict(id='marquee', cat='style', label='Marquee & typewriter', icon='text', module='marquee', fields=[
   B('marquee.enabled', 'Scrolling marquee line'), T('marquee.text', 'Marquee text', '✦ thanks for hanging out ✦'),
   N('marquee.width', 'Visible width', 24, 8, 60, 1, 'chars'), N('marquee.step', 'Scroll per update', 3, 1, 12, 1, 'chars'),
   B('typewriter.enabled', 'Typewriter effect for messages'), N('typewriter.step', 'Letters per update', 8, 2, 40, 1),
 ]),
 dict(id='rotation', cat='behavior', label='Pages & rotation', icon='status', fields=[
   B('pages.enabled', 'Rotate modules in pages', help='Modules set to page 1, 2 or 3 take turns; "Always" stays on every page.'),
   N('pages.seconds', 'Switch page every', 8, 3, 120, 1, 's'), W('pages.map', 'Page per module', 'pages', {}),
   W('order', 'Priority order', 'order', None, 'Top shows first. When text is too long, "Drop lowest priority" removes from the bottom.'),
   S('overflow', 'When longer than 144', 'truncate', [('truncate', 'Cut with …'), ('drop', 'Drop lowest-priority modules'), ('split', 'Split into pages')]),
 ]),
 dict(id='schedule', cat='behavior', label='Status schedule', icon='clock', fields=[
   B('sched.enabled', 'Scheduled statuses'),
   L('sched.items', 'Schedule', 'Mon-Fri 09:00-15:00 | 📚 at school\n22:30-23:59 | 😴 almost bedtime', 'One per line: [days] HH:MM-HH:MM | text. Days optional (Mon-Fri, Sat,Sun). Overrides the status rotator while active.'),
 ]),
 dict(id='presets', cat='behavior', label='Quick messages', icon='send', widget='presets', fields=[
   L('presets.items', 'Presets', 'brb 🚶\ngg wp 🏆\nlagging, one sec 🐢\nmuted, typing instead ⌨️', 'One per line. Click to send from the Chatbox page.'),
   B('presets.hotkeys', 'Hotkeys Ctrl+Shift+1…9 send presets 1–9'),
 ]),
 dict(id='filter', cat='behavior', label='Profanity filter', icon='status', fields=[
   B('filter.enabled', 'Filter swear words'), S('filter.mode', 'Mode', 'mask', [('mask', 'Mask (f***)'), ('remove', 'Remove the word'), ('block', 'Block typed messages that contain one')]),
   T('filter.words', 'Extra words', '', 'Comma separated.'),
 ]),
 dict(id='sending', cat='behavior', label='Sending', icon='bubble', fields=[
   LEG(['chatbox', 'sendIntervalSec'], 'num', 'Seconds between updates (min 1.5)', min=1.5, max=30, step=0.5),
   S('typing.mode', 'Typing indicator', 'typing', [('typing', 'While I type'), ('pulse', 'Also flash before each new update'), ('off', 'Never')]),
   B('notify.messagesOnly', 'Notification sound only for typed messages'),
   N('keepAlive', 'Re-send unchanged text every', 20, 0, 120, 5, 's', '0 = never. VRChat hides the bubble after a while without updates.'),
   B('clear.afk', 'Clear the chatbox while AFK'),
   B('clear.vrcClosed', "Pause sending while VRChat isn't running"),
   N('history.size', 'Remember last', 25, 5, 100, 5, 'messages'),
 ]),
 dict(id='profiles', cat='behavior', label='Profiles', icon='status', widget='profiles', fields=[
   W('profiles.save', 'Save & switch profiles', 'profiles'), W('profiles.export', 'Export profile to a file', 'export'), W('profiles.import', 'Import profile from a file', 'import'),
 ]),
]
new = [f for g in groups for f in g['fields'] if not f.get('legacy')]
ids = [f['id'] for f in new]; assert len(ids) == len(set(ids)), 'dup ids'
out = dict(categories=[dict(id=a, label=b) for a, b in cats], modules=[dict(id=a, label=b) for a, b in MODS], groups=groups, count=len(new))
p = os.path.join(os.path.dirname(__file__), '..', 'electron', 'cbschema.json')
json.dump(out, open(p, 'w'), ensure_ascii=False, indent=1)
print('new options:', len(new))
from collections import Counter
print(Counter(next(g['cat'] for g in groups if f in g['fields']) for f in new))
