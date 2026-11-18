import { describe, expect, it, vi } from 'vitest'
import { hasUnsavedCompanyInput, registerDirtyChecker, switchCompany } from '@/lib/company-dirty'

describe('会社切替の手順', () => {
  function actions() {
    return { confirm: vi.fn(() => true), setActive: vi.fn(async () => {}), broadcast: vi.fn(), navigate: vi.fn() }
  }
  it('未保存があれば確認し、cookie → 他タブ通知 → クエリなしの /journals', async () => {
    const unregister = registerDirtyChecker(() => true)
    try {
      const calls: string[] = []
      await switchCompany('b', {
        confirm: () => { calls.push('confirm'); return true },
        setActive: async id => { calls.push(`cookie:${id}`) },
        broadcast: id => { calls.push(`broadcast:${id}`) }, navigate: path => { calls.push(path) },
      })
      expect(calls).toEqual(['confirm', 'cookie:b', 'broadcast:b', '/journals'])
    } finally { unregister() }
  })
  it('取消時は書き込みも遷移もしない。解除した検知は残らない', async () => {
    const unregister = registerDirtyChecker(() => true)
    try {
      const steps = actions()
      steps.confirm.mockReturnValue(false)
      expect(await switchCompany('b', steps)).toBe(false)
      expect(steps.setActive).not.toHaveBeenCalled()
      expect(steps.broadcast).not.toHaveBeenCalled()
      expect(steps.navigate).not.toHaveBeenCalled()
    } finally { unregister() }
    expect(hasUnsavedCompanyInput()).toBe(false)
  })
  it('入力がなければ確認不要。保存失敗時は通知・遷移しない', async () => {
    const steps = actions()
    steps.setActive.mockRejectedValue(new Error('切替失敗'))
    await expect(switchCompany('b', steps)).rejects.toThrow('切替失敗')
    expect(steps.confirm).not.toHaveBeenCalled()
    expect(steps.broadcast).not.toHaveBeenCalled()
    expect(steps.navigate).not.toHaveBeenCalled()
  })
  it('複数フォームのどれかに未保存があれば検知する', () => {
    const removeClean = registerDirtyChecker(() => false)
    const removeDirty = registerDirtyChecker(() => true)
    try { expect(hasUnsavedCompanyInput()).toBe(true) } finally { removeClean(); removeDirty() }
  })
})
