import { describe, expect, it } from 'vitest'
import type { FiscalPeriod } from '@/lib/fiscal-period'
import { getPeriodCloseActions, isPeriodClosed } from '@/lib/period-close-state'

const period = (year: number, closed = false, current = false): FiscalPeriod => ({ id: String(year), name: `${year}年`,
  start_date: `${year}-01-01`, end_date: `${year}-12-31`, is_current: current, closed_at: closed ? '2026-11-15T00:00:00Z' : null })

describe('期の確定状態とボタンの理由（純関数）', () => {
  it('closed_atのnull・日時と未取得を判定する', () => {
    expect(isPeriodClosed(period(2025))).toBe(false)
    expect(isPeriodClosed(period(2025, true))).toBe(true)
    expect(isPeriodClosed(null)).toBe(false)
    expect(isPeriodClosed(undefined)).toBe(false)
  })
  it('最初の未確定期は前期なしで確定できる', () => {
    const p = period(2025)
    expect(getPeriodCloseActions(p, [period(2026), p]).close).toEqual({ enabled: true, reason: null })
  })
  it.each([false, true])('前の期が未確定なら当期=%sでも確定できず理由を返す', current => {
    const p = period(2026, false, current)
    expect(getPeriodCloseActions(p, [p, period(2025)]).close).toEqual({ enabled: false, reason: '前の期を先に確定してください' })
  })
  it.each([false, true])('前の期が確定済みなら当期=%sでも確定できる', current => {
    const p = period(2026, false, current)
    expect(getPeriodCloseActions(p, [p, period(2025, true)]).close.enabled).toBe(true)
  })
  it('次の期が確定済みなら解除できず理由を返す', () => {
    const p = period(2025, true)
    expect(getPeriodCloseActions(p, [period(2026, true), p]).reopen).toEqual({ enabled: false, reason: '次の期を先に解除してください' })
  })
  it('次の期が未確定なら解除できる', () => {
    const p = period(2025, true)
    expect(getPeriodCloseActions(p, [period(2026), p]).reopen.enabled).toBe(true)
  })
  it('最後の期は次期なしで解除できる', () => {
    const p = period(2026, true)
    expect(getPeriodCloseActions(p, [period(2025, true), p]).reopen.enabled).toBe(true)
  })
  it('1期だけの当期も確定でき、確定済みなら解除できる', () => {
    const p = period(2025, false, true), closed = period(2025, true, true)
    expect(getPeriodCloseActions(p, [p]).close.enabled).toBe(true)
    expect(getPeriodCloseActions(closed, [closed]).reopen.enabled).toBe(true)
  })
  it('既に確定・未確定の逆操作と一覧にない期は無効にする', () => {
    const p = period(2025), closed = period(2025, true)
    expect(getPeriodCloseActions(p, [p]).reopen.reason).toBe('この期は確定されていません')
    expect(getPeriodCloseActions(closed, [closed]).close.reason).toBe('この期は既に確定されています')
    expect(getPeriodCloseActions(p, []).close.reason).toBe('会計期間が見つかりません')
  })
  it('入力配列を変更せず、最も近い前後の期で判定する', () => {
    const periods = [period(2027), period(2025, true), period(2026)]
    const before = structuredClone(periods)
    expect(getPeriodCloseActions(periods[2], periods).close.enabled).toBe(true)
    expect(periods).toEqual(before)
  })
})
