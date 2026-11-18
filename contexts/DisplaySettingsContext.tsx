'use client'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  DisplaySettings,
  getDisplaySettings,
  saveDisplaySettings,
} from '@/lib/display-settings'

type ContextValue = [DisplaySettings, (s: DisplaySettings) => void]

const DisplaySettingsContext = createContext<ContextValue | undefined>(undefined)

export function DisplaySettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    setSettings(getDisplaySettings())
  }, [])

  const update = useCallback((s: DisplaySettings) => {
    saveDisplaySettings(s)
    setSettings(s)
  }, [])

  return (
    <DisplaySettingsContext.Provider value={[settings, update]}>
      {children}
    </DisplaySettingsContext.Provider>
  )
}

export function useDisplaySettings(): ContextValue {
  const ctx = useContext(DisplaySettingsContext)
  if (!ctx) throw new Error('useDisplaySettings must be used within DisplaySettingsProvider')
  return ctx
}
