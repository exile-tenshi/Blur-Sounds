import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type SoundSettingsTab = 'playback' | 'recording'

export async function openWindowsSoundSettings(tab: SoundSettingsTab): Promise<void> {
  const tabIndex = tab === 'playback' ? '0' : '1'
  await execFileAsync('control.exe', ['mmsys.cpl', `,${tabIndex}`], {
    windowsHide: false,
  })
}
