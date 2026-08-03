import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AudioApplication, AudioDevice } from '../../shared/audioTypes.js'

const execFileAsync = promisify(execFile)

function detectDeviceKind(name: string, instanceId: string): AudioDevice['kind'] {
  if (instanceId.includes('{0.0.1.')) {
    return 'input'
  }

  if (instanceId.includes('{0.0.0.')) {
    return 'output'
  }

  const lower = name.toLowerCase()

  if (/cable output|voicemeeter out/i.test(lower)) {
    return 'input'
  }

  if (/cable input|voicemeeter input|voicemeeter aux input|voicemeeter vaio3 input|voicemeeter in [ab]?\d/i.test(
    lower,
  )) {
    return 'output'
  }

  return lower.includes('microphone') || lower.includes('line in') ? 'input' : 'output'
}

function createBindableDeviceId(kind: AudioDevice['kind'], name: string): string {
  return `${kind}::${name}`
}

const sanitizeJsonTextHelper = `
function Sanitize-JsonText([string]$value) {
  if ($null -eq $value) { return $null }
  return [regex]::Replace($value, '[\\x00-\\x1F]', ' ').Trim()
}
`

const deviceScript = `
${sanitizeJsonTextHelper}
$devices = @()
try {
  $rawDevices = Get-PnpDevice -Class AudioEndpoint -ErrorAction SilentlyContinue |
    Where-Object { $_.Status -ne 'Removed' } |
    Select-Object FriendlyName, InstanceId, Status

  foreach ($device in $rawDevices) {
    $name = Sanitize-JsonText([string]$device.FriendlyName)

    $devices += [PSCustomObject]@{
      id = Sanitize-JsonText([string]$device.InstanceId)
      name = $name
      isAvailable = ([string]$device.Status -eq "OK")
      isDefault = $false
    }
  }
} catch {
  $fallback = Get-CimInstance Win32_SoundDevice | Select-Object Name, DeviceID, Status
  foreach ($device in $fallback) {
    $name = Sanitize-JsonText([string]$device.Name)

    $devices += [PSCustomObject]@{
      id = Sanitize-JsonText([string]$device.DeviceID)
      name = $name
      isAvailable = ([string]$device.Status -eq "OK")
      isDefault = $false
    }
  }
}

$devices | ConvertTo-Json -Depth 4 -Compress
`

const applicationScript = `
${sanitizeJsonTextHelper}
$excludedProcessNames = @(
  'Idle', 'System', 'Registry', 'smss', 'csrss', 'wininit', 'services', 'lsass', 'svchost',
  'dllhost', 'conhost', 'RuntimeBroker', 'SearchHost', 'StartMenuExperienceHost',
  'ShellExperienceHost', 'WidgetService', 'TextInputHost', 'dwm', 'fontdrvhost', 'sihost',
  'taskhostw', 'audiodg', 'WmiPrvSE', 'spoolsv', 'ctfmon', 'ApplicationFrameHost',
  'SystemSettings', 'LockApp', 'explorer', 'PhoneExperienceHost', 'SecurityHealthSystray',
  'SecurityHealthService', 'OneDrive', 'backgroundTaskHost', 'GameBar', 'GameBarFTServer'
)

$knownAudioProcessNames = @(
  'Spotify', 'Discord', 'chrome', 'msedge', 'firefox', 'opera', 'brave', 'vivaldi', 'arc',
  'Slack', 'Teams', 'Zoom', 'vlc', 'Steam', 'obs64', 'obs32', 'Cursor', 'Code',
  'AppleMusic', 'iTunes', 'foobar2000', 'AIMP', 'MusicBee', 'deemix', 'TIDAL', 'Plex',
  'Overwolf', 'Battle.net', 'EpicGamesLauncher', 'EADesktop', 'GalaxyClient'
)

$processes = Get-Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.SessionId -ge 1 -and
    $_.Id -gt 4 -and
    $excludedProcessNames -notcontains $_.ProcessName -and
    (
      $_.MainWindowTitle -or
      ($knownAudioProcessNames -contains $_.ProcessName)
    )
  } |
  Sort-Object @{
    Expression = {
      if ($knownAudioProcessNames -contains $_.ProcessName) { 0 }
      elseif ($_.MainWindowTitle) { 1 }
      else { 2 }
    }
  }, ProcessName |
  Select-Object -First 200

$apps = foreach ($process in $processes) {
  $pathValue = $null
  try {
    $pathValue = Sanitize-JsonText([string]$process.Path)
  } catch {
    $pathValue = $null
  }

  $displayName = if ($process.MainWindowTitle) {
    [string]$process.MainWindowTitle
  } else {
    [string]$process.ProcessName
  }

  [PSCustomObject]@{
    id = [string]$process.Id
    processId = [int]$process.Id
    processName = Sanitize-JsonText([string]$process.ProcessName)
    displayName = Sanitize-JsonText($displayName)
    executablePath = $pathValue
    hasVisibleWindow = [bool]$process.MainWindowTitle
  }
}

$apps | ConvertTo-Json -Depth 4 -Compress
`

function sanitizeJsonForParse(json: string): string {
  const withoutBom = json.charCodeAt(0) === 0xfeff ? json.slice(1) : json
  let result = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < withoutBom.length; index += 1) {
    const char = withoutBom[index]
    const code = char.charCodeAt(0)

    if (escaped) {
      result += char
      escaped = false
      continue
    }

    if (char === '\\' && inString) {
      result += char
      escaped = true
      continue
    }

    if (char === '"') {
      inString = !inString
      result += char
      continue
    }

    if (inString && code < 32) {
      if (char === '\t') {
        result += '\\t'
      } else if (char === '\n') {
        result += '\\n'
      } else if (char === '\r') {
        result += '\\r'
      }
      continue
    }

    result += char
  }

  return result
}

function parseJsonArray<T>(stdout: string): T[] {
  const trimmed = stdout.trim()

  if (!trimmed) {
    return []
  }

  const parsed = JSON.parse(sanitizeJsonForParse(trimmed)) as T | T[]
  return Array.isArray(parsed) ? parsed : [parsed]
}

async function runPowerShellJson<T>(script: string): Promise<T[]> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 4,
      },
    )

    return parseJsonArray<T>(stdout)
  } catch (error) {
    console.warn('PowerShell audio query failed:', error)
    return []
  }
}

function dedupeDevices<T extends { id: string }>(devices: T[]): T[] {
  const unique = new Map<string, T>()

  for (const device of devices) {
    if (!unique.has(device.id)) {
      unique.set(device.id, device)
    }
  }

  return [...unique.values()]
}

let cachedDevices: AudioDevice[] | undefined
let cachedDevicesAt = 0
let cachedDevicesInFlight: Promise<AudioDevice[]> | undefined
const DEVICE_CACHE_TTL_MS = 5000

export async function listAudioDevices(): Promise<AudioDevice[]> {
  const now = Date.now()
  if (cachedDevices && now - cachedDevicesAt < DEVICE_CACHE_TTL_MS) {
    return cachedDevices
  }

  if (cachedDevicesInFlight) {
    return cachedDevicesInFlight
  }

  cachedDevicesInFlight = (async () => {
    const devices = dedupeDevices(
      await runPowerShellJson<Omit<AudioDevice, 'kind'>>(deviceScript),
    ).map((device) => ({
      ...device,
      kind: detectDeviceKind(device.name, device.id),
    }))

    const firstInput = devices.find((device) => device.kind === 'input')
    const firstOutput = devices.find((device) => device.kind === 'output')

    const next = devices.map((device) => ({
      ...device,
      id: createBindableDeviceId(device.kind, device.name),
      isDefault:
        device.id === firstInput?.id && device.kind === 'input'
          ? true
          : device.id === firstOutput?.id && device.kind === 'output',
    }))
    cachedDevices = next
    cachedDevicesAt = Date.now()
    return next
  })().finally(() => {
    cachedDevicesInFlight = undefined
  })

  return cachedDevicesInFlight
}

let cachedApplications: AudioApplication[] | undefined
let cachedApplicationsAt = 0
let cachedApplicationsInFlight: Promise<AudioApplication[]> | undefined
const APPLICATION_CACHE_TTL_MS = 3000

export async function listActiveApplications(): Promise<AudioApplication[]> {
  const now = Date.now()
  if (cachedApplications && now - cachedApplicationsAt < APPLICATION_CACHE_TTL_MS) {
    return cachedApplications
  }

  if (cachedApplicationsInFlight) {
    return cachedApplicationsInFlight
  }

  cachedApplicationsInFlight = runPowerShellJson<AudioApplication>(applicationScript)
    .then((applications) => {
      cachedApplications = applications
      cachedApplicationsAt = Date.now()
      return applications
    })
    .finally(() => {
      cachedApplicationsInFlight = undefined
    })

  return cachedApplicationsInFlight
}
