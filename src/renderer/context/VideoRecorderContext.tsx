import { createContext, useContext, type ReactNode } from 'react'
import { useVideoRecorder } from '../hooks/useVideoRecorder'

type VideoRecorderApi = ReturnType<typeof useVideoRecorder>

const VideoRecorderContext = createContext<VideoRecorderApi | null>(null)

// State lives here (not in the panel) so an in-progress recording survives switching
// tabs, while the panel itself is only mounted when the Record tab is active.
export function VideoRecorderProvider({ children }: { children: ReactNode }) {
  const value = useVideoRecorder()
  return <VideoRecorderContext.Provider value={value}>{children}</VideoRecorderContext.Provider>
}

export function useVideoRecorderContext(): VideoRecorderApi {
  const value = useContext(VideoRecorderContext)
  if (!value) {
    throw new Error('useVideoRecorderContext must be used within VideoRecorderProvider')
  }
  return value
}
