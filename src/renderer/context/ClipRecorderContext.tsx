import { createContext, useContext, type ReactNode } from 'react'
import { useClipRecorder } from '../hooks/useClipRecorder'

type ClipRecorderApi = ReturnType<typeof useClipRecorder>

const ClipRecorderContext = createContext<ClipRecorderApi | null>(null)

export function ClipRecorderProvider({ children }: { children: ReactNode }) {
  const value = useClipRecorder()
  return <ClipRecorderContext.Provider value={value}>{children}</ClipRecorderContext.Provider>
}

export function useClipRecorderContext(): ClipRecorderApi {
  const value = useContext(ClipRecorderContext)
  if (!value) {
    throw new Error('useClipRecorderContext must be used within ClipRecorderProvider')
  }
  return value
}
