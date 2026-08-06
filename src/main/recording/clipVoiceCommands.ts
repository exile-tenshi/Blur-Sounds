import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ClipKeybindService } from './clipKeybinds.js'
import type { SettingsStore } from '../settings/settingsStore.js'

/** Phrases that trigger Clip it with the current lookback/forward preset. */
export const CLIP_VOICE_PHRASES = [
  'clip it blur',
  'blur clip it',
  'clip blur',
  'blur clip',
  'hey blur clip it',
  'blur clip that',
] as const

const TRIGGER_COOLDOWN_MS = 2800

/**
 * Windows speech listener (System.Speech) for Clip it voice commands.
 * Fires the same trigger path as keybinds so lookback/forward presets apply.
 */
export class ClipVoiceCommandService {
  private process: ChildProcessWithoutNullStreams | null = null
  private lastTriggerAt = 0
  private starting = false
  private stdoutBuffer = ''

  constructor(
    private readonly settings: SettingsStore,
    private readonly keybinds: ClipKeybindService,
  ) {}

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
      return
    }

    if (this.process || this.starting) {
      return
    }

    this.starting = true
    try {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', buildRecognizerScript()],
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
      child.stderr.on('data', () => {
        // Recognition warnings are noisy; ignore unless debugging.
      })

      child.on('exit', () => {
        this.process = null
        this.starting = false
        // Auto-restart if still enabled (speech engine can exit on device changes).
        if (this.settings.get().clip.voiceCommandsEnabled !== false) {
          setTimeout(() => this.start(), 1500)
        }
      })

      child.on('error', () => {
        this.process = null
        this.starting = false
      })
    } catch {
      this.process = null
      this.starting = false
    }
  }

  stop(): void {
    const child = this.process
    this.process = null
    this.starting = false
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
      return
    }

    if (line === 'CLIP_VOICE_ERROR') {
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
    this.keybinds.triggerClip()
  }
}

function buildRecognizerScript(): string {
  const phrases = CLIP_VOICE_PHRASES.map((phrase) => phrase.replace(/'/g, "''")).join("','")
  // Constrained grammar is far more reliable than free dictation for short commands.
  return `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $choices = New-Object System.Speech.Recognition.Choices
  foreach ($phrase in @('${phrases}')) {
    [void]$choices.Add($phrase)
  }
  $builder = New-Object System.Speech.Recognition.GrammarBuilder
  [void]$builder.Append($choices)
  $grammar = New-Object System.Speech.Recognition.Grammar($builder)
  $engine.LoadGrammar($grammar)
  $engine.SetInputToDefaultAudioDevice()
  $engine.add_SpeechRecognized({
    param($sender, $eventArgs)
    $text = $eventArgs.Result.Text
    if ($text) {
      [Console]::Out.WriteLine('CLIP_VOICE_HIT:' + $text)
      [Console]::Out.Flush()
    }
  })
  $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  [Console]::Out.WriteLine('CLIP_VOICE_READY')
  [Console]::Out.Flush()
  while ($true) { Start-Sleep -Seconds 3600 }
} catch {
  [Console]::Out.WriteLine('CLIP_VOICE_ERROR')
  [Console]::Out.Flush()
  exit 1
}
`.trim()
}
