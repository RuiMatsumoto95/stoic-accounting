import { describe, expect, it, vi } from 'vitest'
import { PostgrestError, type SupabaseClient } from '@supabase/supabase-js'
import { createPeriodForCompany, updatePeriodForCompany, deletePeriodForCompany } from '@/lib/fiscal-period-operations'
import { ERROR_CODES } from '@/lib/errors'

type Result = { data: unknown; error: PostgrestError | null; count?: number }
function scriptedDb(results: Result[]) {
  const from = vi.fn(() => {
    const result = results.shift()
    const query = { select: () => query, eq: () => query, order: () => query, gt: () => query, limit: () => query,
      insert: () => query, update: () => query, delete: () => query, single: () => query,
      then: (resolve: (result: Result | undefined) => unknown) => Promise.resolve(result).then(resolve) }
    return query
  })
  return { client: { from } as unknown as SupabaseClient, from }
}
const ok = (data: unknown, count?: number): Result => ({ data, count, error: null })
const failed = (code: string): Result => ({ data: null, error: new PostgrestError({ code: 'P0001', message: code, details: '年度の確定状態を確認してください', hint: '' }) })
const input = { name: '変更した期名', start_date: '2026-01-01', end_date: '2026-12-31' }

describe('会計期間のDBガードと競合エラー', () => {
  it('追加でPERIOD_OVERLAPS_CLOSEDを日本語にする', async () => {
    const db = scriptedDb([ok({ kind: 'CORPORATION' }), ok([]), failed('PERIOD_OVERLAPS_CLOSED')])
    expect(await createPeriodForCompany(db.client, 'a', input)).toEqual({ code: 'PERIOD_OVERLAPS_CLOSED', error: `${ERROR_CODES.PERIOD_OVERLAPS_CLOSED.message}（年度の確定状態を確認してください）` })
  })
  it.each(['PERIOD_CLOSED_FIELDS', 'PERIOD_OVERLAPS_CLOSED'] as const)('日付変更で%sを日本語にする', async code => {
    const db = scriptedDb([ok({ start_date: input.start_date }), ok({ kind: 'CORPORATION' }), ok([]), failed(code)])
    expect(await updatePeriodForCompany(db.client, 'a', 'p', input)).toEqual({ code, error: `${ERROR_CODES[code].message}（年度の確定状態を確認してください）` })
  })
  it('事前確認では未確定でも、DELETE時の確定拒否を日本語で返す', async () => {
    const db = scriptedDb([ok([{ id: 'p', end_date: input.end_date, is_current: false, closed_at: null }]), ok([], 0), ok([]), failed('PERIOD_CLOSED_FIELDS')])
    expect(await deletePeriodForCompany(db.client, 'a', 'p')).toEqual({ code: 'PERIOD_CLOSED_FIELDS', error: `${ERROR_CODES.PERIOD_CLOSED_FIELDS.message}（年度の確定状態を確認してください）` })
  })
})
