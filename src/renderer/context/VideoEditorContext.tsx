import { createContext, useContext, type ReactNode } from 'react'
import { useVideoEditor, type UseVideoEditor } from '../hooks/useVideoEditor'

const VideoEditorContext = createContext<UseVideoEditor | null>(null)

// The editor project, timeline, and undo/redo stack live here so they persist across
// tab switches, while the preview render loop stays in the panel (mounted only when active).
export function VideoEditorProvider({ children }: { children: ReactNode }) {
  const value = useVideoEditor()
  return <VideoEditorContext.Provider value={value}>{children}</VideoEditorContext.Provider>
}

export function useVideoEditorContext(): UseVideoEditor {
  const value = useContext(VideoEditorContext)
  if (!value) {
    throw new Error('useVideoEditorContext must be used within VideoEditorProvider')
  }
  return value
}
