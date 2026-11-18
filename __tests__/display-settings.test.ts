import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, getDisplaySettings, saveDisplaySettings } from '@/lib/display-settings'

describe('仕訳日記帳の文字サイズ設定', () => {
  const storage = { getItem: vi.fn(), setItem: vi.fn() }

  beforeEach(() => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', storage)
    storage.getItem.mockReset()
    storage.setItem.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('サーバー側では標準サイズと既定の税区分ONを返す', () => {
    vi.stubGlobal('window', undefined)
    expect(getDisplaySettings()).toEqual({ showSubAccount: false, showTaxClass: true, textSize: 'normal' })
    expect(storage.getItem).not.toHaveBeenCalled()
  })

  it('保存済み設定がなければ標準サイズを返す', () => {
    storage.getItem.mockReturnValue(null)
    expect(getDisplaySettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('旧設定のON/OFFを保ち、欠けている文字サイズだけ標準で補う', () => {
    storage.getItem.mockReturnValue(JSON.stringify({ showSubAccount: true, showTaxClass: false }))
    expect(getDisplaySettings()).toEqual({ showSubAccount: true, showTaxClass: false, textSize: 'normal' })
    expect(storage.getItem).toHaveBeenCalledWith('stoic-display-settings')
  })

  it('保存された大サイズを復元する', () => {
    storage.getItem.mockReturnValue(JSON.stringify({ ...DEFAULT_SETTINGS, textSize: 'large' }))
    expect(getDisplaySettings().textSize).toBe('large')
  })

  it('既存のlocalStorageキーに文字サイズも保存する', () => {
    const settings = { ...DEFAULT_SETTINGS, textSize: 'large' as const }
    saveDisplaySettings(settings)
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith('stoic-display-settings', JSON.stringify(settings))
  })

  it('壊れたJSONでは標準サイズを含む既定値へ戻る', () => {
    storage.getItem.mockReturnValue('{invalid')
    expect(getDisplaySettings()).toEqual(DEFAULT_SETTINGS)
  })
})
