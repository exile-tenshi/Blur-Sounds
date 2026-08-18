import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ClipKeybindService } from './clipKeybinds.js'
import type { SettingsStore } from '../settings/settingsStore.js'

/** Phrases that trigger Clip it with the current lookback/forward preset. */
export const CLIP_VOICE_PHRASES = [
  'clip it blur',
  'clip it, blur',
  'blur clip it',
  'clip blur',
  'blur clip',
  'hey blur clip it',
  'blur clip that',
  'clip that blur',
  'clip it blur sounds',
] as const

const TRIGGER_COOLDOWN_MS = 2800

export type ClipVoiceListenerState = 'off' | 'starting' | 'ready' | 'error'

/**
 * Windows speech listener (System.Speech) for Clip it voice commands.
 * Uses a synchronous Recognize() loop so PowerShell actually pumps audio events.
 */
export class ClipVoiceCommandService {
  private process: ChildProcessWithoutNullStreams | null = null
  private lastTriggerAt = 0
  private starting = false
  private stdoutBuffer = ''
  private state: ClipVoiceListenerState = 'off'
  private lastError: string | undefined
  private restartTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly settings: SettingsStore,
    private readonly keybinds: ClipKeybindService,
  ) {}

  getState(): ClipVoiceListenerState {
    return this.state
  }

  getError(): string | undefined {
    return this.lastError
  }

  refresh(): void {
    const enabled = this.settings.get().clip.voiceCommandsEnabled !== false
    if (enabled) {
      this.start()
    } else {
      this.stop()
    }
  }

  start(): void {
    if (process.platform !== 'win32') {
      this.state = 'off'
      return
    }

    if (this.process || this.starting) {
      return
    }

    this.starting = true
    this.state = 'starting'
    this.lastError = undefined
    try {
      const scriptPath = join(tmpdir(), 'blur-sounds-clip-voice.ps1')
      writeFileSync(scriptPath, buildRecognizerScript(), 'utf8')
      const child = spawn(
        'powershell.exe',
        ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      this.process = child
      this.stdoutBuffer = ''
      this.starting = false

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        this.stdoutBuffer += chunk
        const lines = this.stdoutBuffer.split(/\r?\n/)
        this.stdoutBuffer = lines.pop() ?? ''
        for (const line of lines) {
          this.handleLine(line.trim())
        }
      })

      child.stderr.setEncoding('utf8')

      child.on('exit', () => {
        this.process = null
        this.starting = false
        if (this.settings.get().clip.voiceCommandsEnabled !== false) {
          this.state = this.state === 'error' ? 'error' : 'starting'
          this.restartTimer = setTimeout(() => this.start(), 2000)
        } else {
          this.state = 'off'
        }
      })

      child.on('error', (error) => {
        this.process = null
        this.starting = false
        this.state = 'error'
        this.lastError = error instanceof Error ? error.message : 'Unable to start voice listener.'
      })
    } catch (error) {
      this.process = null
      this.starting = false
      this.state = 'error'
      this.lastError = error instanceof Error ? error.message : 'Unable to start voice listener.'
    }
  }

  stop(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = undefined
    }
    const child = this.process
    this.process = null
    this.starting = false
    this.state = 'off'
    if (!child) {
      return
    }

    try {
      child.kill()
    } catch {
      // ignore
    }
  }

  private handleLine(line: string): void {
    if (!line) {
      return
    }

    if (line === 'CLIP_VOICE_READY') {
      this.state = 'ready'
      this.lastError = undefined
      return
    }

    if (line.startsWith('CLIP_VOICE_ERROR:')) {
      this.state = 'error'
      this.lastError = line.slice('CLIP_VOICE_ERROR:'.length).trim() || 'Windows speech failed.'
      return
    }

    if (line === 'CLIP_VOICE_ERROR') {
      this.state = 'error'
      this.lastError = 'Windows speech failed. Install an English speech pack and set your real mic as the default recording device.'
      return
    }

    if (!line.startsWith('CLIP_VOICE_HIT:')) {
      return
    }

    const now = Date.now()
    if (now - this.lastTriggerAt < TRIGGER_COOLDOWN_MS) {
      return
    }

    this.lastTriggerAt = now
    this.keybinds.triggerClip('voice')
  }
}

function buildRecognizerScript(): string {
  const phrases = CLIP_VOICE_PHRASES.map((phrase) => phrase.replace(/'/g, "''")).join("','")
  return `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $recognizer = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() |
    Where-Object { $_.Culture.Name -like 'en*' } |
    Select-Object -First 1
  if ($recognizer) {
    $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($recognizer)
  } else {
    $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  }
  $choices = New-Object System.Speech.Recognition.Choices
  foreach ($phrase in @('${phrases}')) {
    [void]$choices.Add($phrase)
  }
  $builder = New-Object System.Speech.Recognition.GrammarBuilder
  if ($engine.RecognizerInfo -and $engine.RecognizerInfo.Culture) {
    $builder.Culture = $engine.RecognizerInfo.Culture
  }
  [void]$builder.Append($choices)
  $grammar = New-Object System.Speech.Recognition.Grammar($builder)
  $engine.LoadGrammar($grammar)
  $engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(20)
  $engine.BabbleTimeout = [TimeSpan]::FromSeconds(0)
  $engine.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(500)
  try { $engine.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(700) } catch {}
  $engine.SetInputToDefaultAudioDevice()
  [Console]::Out.WriteLine('CLIP_VOICE_READY')
  [Console]::Out.Flush()
  while ($true) {
    $result = $engine.Recognize()
    if ($null -eq $result -or -not $result.Text) { continue }
    if ($result.Confidence -lt 0.28) { continue }
    $text = [string]$result.Text
    [Console]::Out.WriteLine('CLIP_VOICE_HIT:' + $text)
    [Console]::Out.Flush()
  }
} catch {
  [Console]::Out.WriteLine('CLIP_VOICE_ERROR:' + $_.Exception.Message)
  [Console]::Out.Flush()
  exit 1
}
`.trim()
}
