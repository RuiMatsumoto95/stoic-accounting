import { beforeEach, describe, expect, it, vi } from 'vitest'
import { companyDb } from './helpers/company-supabase'
import { AccountingError, ERROR_CODES, ValidationError } from '@/lib/errors'
import { translateSupabaseError as translate } from '@/lib/supabase-error-handler'
import { PostgrestError, type SupabaseClient } from '@supabase/supabase-js'

let fixture: ReturnType<typeof companyDb>
const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => fixture.client.from(table), rpc: (...args: unknown[]) => rpc(...args) } }))
import { getOpeningBalancesByType } from '@/lib/balance-calculator'
import { getBSData, getIndividualBSData } from '@/lib/financial-statements'
import { deletePeriodForCompany } from '@/lib/fiscal-period-operations'

const failure = (message: string, code = 'P0001', details = '') => ({ name: 'PostgrestError', code, message, details, hint: '' })
const translateSupabaseError = (error: ReturnType<typeof failure>) => translate(new PostgrestError(error))
beforeEach(() => {
  rpc.mockReset()
  fixture = companyDb({ fiscal_periods: [{ id: 'p', company_id: 'a', end_date: '2026-12-31', is_current: false }] })
})
describe('期首残高のエラー', () => {
  it.each(['OPENING_BALANCE_UNBALANCED', 'OPENING_BALANCE_INVALID_LINES', 'OPENING_BALANCE_INVALID_ACCOUNT', 'OPENING_BASE_UNDETERMINED', 'CARRY_FORWARD_NOT_SET', 'REFERENCE_NOT_FOUND_OR_OTHER_COMPANY'] as const)('%s の翻訳と種別', code => {
    const result = translateSupabaseError(failure(code, 'P0001', '日本語の補足'))
    expect(result).toBeInstanceOf(code === 'OPENING_BASE_UNDETERMINED' ? AccountingError : ValidationError)
    expect(result).toMatchObject({ code, message: `${ERROR_CODES[code].message}（日本語の補足）` })
    expect(translateSupabaseError(failure(code)).message).toBe(ERROR_CODES[code].message)
  })
  it.each(['message', 'details'] as const)('23503の制約名を%sから優先判定する', field => {
    for (const [constraint, code] of [['period_opening_balance_sets_period_fkey', 'OPENING_BALANCE_MANUAL_SET_EXISTS'], ['period_opening_balance_lines_account_fkey', 'OPENING_BALANCE_ACCOUNT_IN_USE']] as const) {
      expect(translateSupabaseError({ ...failure('', '23503'), [field]: constraint })).toMatchObject({ code, message: ERROR_CODES[code].message })
    }
    expect(translateSupabaseError(failure('unknown', '23503')).code).toBe('ACCOUNT_NOT_FOUND')
  })
  it.each(['CARRY_FORWARD_NOT_SET', 'OPENING_BASE_UNDETERMINED'])('RPC %s をゼロにせず全BS取得経路で伝播する', async code => {
    rpc.mockResolvedValue({ data: null, error: failure(code) })
    for (const request of [() => getOpeningBalancesByType('p', ['ASSET']), () => getBSData('p', null, 0, null), () => getIndividualBSData('p', null, 0, null)]) {
      await expect(request()).rejects.toMatchObject({ code, message: ERROR_CODES[code as keyof typeof ERROR_CODES].message })
    }
  })
  it('科目の取得失敗も翻訳して投げる', async () => {
    rpc.mockResolvedValue({ data: [{ account_id: 'cash', balance: 10 }], error: null })
    fixture.failWith(call => call.table === 'accounts' ? 'failed' : undefined)
    await expect(getOpeningBalancesByType('p', ['ASSET'])).rejects.toMatchObject({ code: 'DB_QUERY_FAILED' })
  })
  it('手動設定のある期を拒否し、他社のヘッダーは無視する', async () => {
    fixture.tables.period_opening_balance_sets = [{ id: 'b-set', company_id: 'b', period_id: 'p' }]
    expect(await deletePeriodForCompany(fixture.client, 'a', 'p')).toEqual({})
    fixture.tables.fiscal_periods = [{ id: 'p', company_id: 'a', is_current: false }]
    fixture.tables.period_opening_balance_sets.push({ id: 'a-set', company_id: 'a', period_id: 'p' })
    expect(await deletePeriodForCompany(fixture.client, 'a', 'p')).toEqual({ code: 'OPENING_BALANCE_MANUAL_SET_EXISTS', error: ERROR_CODES.OPENING_BALANCE_MANUAL_SET_EXISTS.message })
  })
  it('削除直前の競合で23503になっても日本語を返す', async () => {
    const db = { from: (table: string) => table === 'fiscal_periods' ? {
      select: () => fixture.client.from(table).select(),
      delete: () => { const q = { eq: () => q, select: async () => ({ data: null, error: failure('period_opening_balance_sets_period_fkey', '23503') }) }; return q },
    } : fixture.client.from(table) } as unknown as SupabaseClient
    expect(await deletePeriodForCompany(db, 'a', 'p')).toEqual({ code: 'OPENING_BALANCE_MANUAL_SET_EXISTS', error: ERROR_CODES.OPENING_BALANCE_MANUAL_SET_EXISTS.message })
  })
  it.each(['42P01', 'PGRST205'])('SQL適用前のテーブル未作成%sでも既存の期の削除が可能', async code => {
    const db = { from: (table: string) => {
      if (table !== 'period_opening_balance_sets') return fixture.client.from(table)
      const query = { select: () => query, eq: () => query, then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: null, error: failure('missing table', code) }).then(resolve) }
      return query
    } } as unknown as SupabaseClient
    expect(await deletePeriodForCompany(db, 'a', 'p')).toEqual({})
  })
})
