import type { AppSectionId } from '../../shared/appSettings'
import { SIDEBAR_SECTIONS } from './sectionIds'

function SectionIcon({ id }: { id: AppSectionId }) {
  switch (id) {
    case 'mixer':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 4h3v16H4V4zm6.5 4h3v12h-3V8zM17 2h3v18h-3V2z"
          />
        </svg>
      )
    case 'noise':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 3a3 3 0 0 1 3 3v6a3 3 0 1 1-6 0V6a3 3 0 0 1 3-3zm7 9a1 1 0 1 1 2 0 9 9 0 0 1-8 8.94V23h-2v-2.06A9 9 0 0 1 3 12a1 1 0 1 1 2 0 7 7 0 1 0 14 0z"
          />
        </svg>
      )
    case 'clips':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 5a2 2 0 0 1 2-2h7l2 2h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5zm8 3.5v7l5-3.5-5-3.5z"
          />
        </svg>
      )
    case 'record':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M3 5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3.5l3.3-2.3a1 1 0 0 1 1.7.8v10a1 1 0 0 1-1.7.8L18 15.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm7 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"
          />
        </svg>
      )
    case 'editor':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 4h16a1 1 0 0 1 1 1v3H3V5a1 1 0 0 1 1-1zm-1 6h6v10H4a1 1 0 0 1-1-1V10zm8 0h10v9a1 1 0 0 1-1 1h-9V10zM6 2h2v4H6V2zm10 0h2v4h-2V2z"
          />
        </svg>
      )
    case 'setup':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 12.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L1.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L1.83 14.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.6.22l2.39-.96c.5.4 1.05.72 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.23.1.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM11 15.5A3.5 3.5 0 1 1 11 8.5a3.5 3.5 0 0 1 0 7z"
          />
        </svg>
      )
    default:
      return null
  }
}

interface SidebarNavProps {
  activeSection: AppSectionId
  onSelect: (section: AppSectionId) => void
  brandLogoUrl: string
}

export function SidebarNav({ activeSection, onSelect, brandLogoUrl }: SidebarNavProps) {
  return (
    <aside className="sidebar-rail" aria-label="Sections">
      <button
        type="button"
        className="sidebar-brand"
        onClick={() => onSelect('mixer')}
        title="Blur Sounds"
      >
        <img src={brandLogoUrl} alt="Blur Sounds" />
      </button>

      <nav className="sidebar-nav">
        {SIDEBAR_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`sidebar-item${activeSection === section.id ? ' active' : ''}`}
            onClick={() => onSelect(section.id)}
            title={`${section.label} — ${section.hint}`}
          >
            <span className="sidebar-item-icon">
              <SectionIcon id={section.id} />
            </span>
            <span className="sidebar-item-label">{section.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  )
}
