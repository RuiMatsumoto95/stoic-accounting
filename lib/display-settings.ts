export type DisplaySettings = {
  showSubAccount: boolean
  showTaxClass: boolean
  textSize: 'normal' | 'large'
}

export const DEFAULT_SETTINGS: DisplaySettings = {
  showSubAccount: false,
  showTaxClass: true,
  textSize: 'normal',
}

const STORAGE_KEY = 'stoic-display-settings'

export function getDisplaySettings(): DisplaySettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveDisplaySettings(s: DisplaySettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}
