import type { AppSectionId } from '../../shared/appSettings'

export interface SidebarSection {
  id: AppSectionId
  label: string
  hint: string
}

export const SIDEBAR_SECTIONS: SidebarSection[] = [
  { id: 'mixer', label: 'Mixer', hint: 'Route mic and apps' },
  { id: 'noise', label: 'Noise', hint: 'Suppression editor' },
  { id: 'clips', label: 'Clips', hint: 'Instant replay' },
  { id: 'record', label: 'Record', hint: 'Screen / game capture' },
  { id: 'editor', label: 'Editor', hint: 'Trim, grade, export' },
  { id: 'setup', label: 'Setup', hint: 'Hi-Fi Cable' },
]
