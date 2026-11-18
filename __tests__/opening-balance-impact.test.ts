import { beforeEach, describe, expect, it, vi } from 'vitest'
import { companyDb } from './helpers/company-supabase'

let fixture: ReturnType<typeof companyDb>
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => fixture.client.from(table) } }))
import { hasAutomaticOpeningImpact, fetchAutomaticOpeningImpact } from '@/lib/opening-balance-impact'

const current = { id: 'p1', company_id: 'a', start_date: '2025-01-01', end_date: '2025-12-31' }
const next = { id: 'p2', company_id: 'a', start_date: '2026-01-01', end_date: '2026-12-31' }
const third = { id: 'p3', company_id: 'a', start_date: '2027-01-01', end_date: '2027-12-31' }
beforeEach(() => { fixture = companyDb({ fiscal_periods: [current, next, third] }) })
describe('翌期の自動繰越への影響', () => {
  it('当期なし・後の期なしでは通知しない', () => {
    expect(hasAutomaticOpeningImpact('a', 'missing', [current, next], [])).toBe(false)
    expect(hasAutomaticOpeningImpact('a', 'p1', [current], [])).toBe(false)
    expect(hasAutomaticOpeningImpact('a', 'p3', [current, next, third], [])).toBe(false)
  })
  it('直後の期に手動設定がなければ通知する', () => {
    expect(hasAutomaticOpeningImpact('a', 'p1', [third, next, current], [])).toBe(true)
    expect(hasAutomaticOpeningImpact('a', 'p1', [current, next, third], [{ company_id: 'a', period_id: 'p3' }])).toBe(true)
  })
  it('直後の期に手動設定があれば、それ以降に自動の期があっても通知しない', () => {
    expect(hasAutomaticOpeningImpact('a', 'p1', [current, next, third], [{ company_id: 'a', period_id: 'p2' }])).toBe(false)
  })
  it('不連続なら後の期のうち開始日が最小の期を見る', () => {
    const gap = { ...next, start_date: '2026-04-01' }
    expect(hasAutomaticOpeningImpact('a', 'p1', [third, gap, current], [])).toBe(true)
    expect(hasAutomaticOpeningImpact('a', 'p1', [third, gap, current], [{ company_id: 'a', period_id: 'p2' }])).toBe(false)
  })
  it('終了日の翌日に開始する期を優先する（閏年・重複期間）', () => {
    const leap = { ...current, end_date: '2024-02-28', start_date: '2024-01-01' }
    const overlapping = { ...third, start_date: '2024-02-01' }
    const following = { ...next, start_date: '2024-02-29' }
    expect(hasAutomaticOpeningImpact('a', 'p1', [leap, overlapping, following], [{ company_id: 'a', period_id: 'p3' }])).toBe(true)
    expect(hasAutomaticOpeningImpact('a', 'p1', [leap, overlapping, following], [{ company_id: 'a', period_id: 'p2' }])).toBe(false)
  })
  it('別会社の期とヘッダーは混ざらない', () => {
    expect(hasAutomaticOpeningImpact('a', 'p1', [current, { ...next, company_id: 'b' }], [])).toBe(false)
    expect(hasAutomaticOpeningImpact('a', 'p1', [current, next], [{ company_id: 'b', period_id: 'p2' }])).toBe(true)
    expect(hasAutomaticOpeningImpact('b', 'p1', [current, next], [])).toBe(false)
  })
  it('取得は会社で絞り、他社の手動設定を含めない', async () => {
    fixture.tables.period_opening_balance_sets = [{ company_id: 'b', period_id: 'p2' }]
    expect(await fetchAutomaticOpeningImpact('a', 'p1')).toBe(true)
    const calls = fixture.calls.filter(call => call.table === 'period_opening_balance_sets')
    expect(calls[0].filters).toContainEqual(['company_id', 'eq', 'a'])
    await expect(fetchAutomaticOpeningImpact('b', 'p1')).rejects.toMatchObject({ code: 'COMPANY_MISMATCH' })
  })
  it('取得失敗を「通知なし」に変えない', async () => {
    fixture.failWith(call => call.table === 'period_opening_balance_sets' ? 'failed' : undefined)
    await expect(fetchAutomaticOpeningImpact('a', 'p1')).rejects.toMatchObject({ code: 'DB_QUERY_FAILED' })
  })
  it('1000期を超えても直後の手動設定を読み落とさない', async () => {
    fixture.tables.period_opening_balance_sets = [
      ...Array.from({ length: 1001 }, (_, i) => ({ company_id: 'a', period_id: `a-${i}` })),
      { company_id: 'a', period_id: 'p2' },
    ]
    expect(await fetchAutomaticOpeningImpact('a', 'p1')).toBe(false)
    expect(fixture.calls.filter(call => call.table === 'period_opening_balance_sets')).toHaveLength(2)
  })
})
