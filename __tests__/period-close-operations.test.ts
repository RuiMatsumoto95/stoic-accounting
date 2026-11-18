import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { companyDb } from './helpers/company-supabase'
import { closeFiscalPeriod, reopenFiscalPeriod, getPeriodCloseCheck, deletePeriodForCompany } from '@/lib/fiscal-period-operations'
import { registerActiveCompany } from '@/lib/company-guard'
import { ERROR_CODES } from '@/lib/errors'

let fixture: ReturnType<typeof companyDb>
const rpc = vi.fn()
beforeEach(() => {
  fixture = companyDb({ fiscal_periods: [
    { id: 'p', company_id: 'a', end_date: '2025-12-31', is_current: false, closed_at: null },
    { id: 'other', company_id: 'b', end_date: '2026-12-31', is_current: false, closed_at: null },
  ] })
  Object.assign(fixture.client, { rpc })
  rpc.mockReset()
  registerActiveCompany('a')
  vi.stubGlobal('document', { cookie: 'sa_company_id=a' })
})
afterEach(() => { registerActiveCompany(null); vi.unstubAllGlobals() })

const cases = [
  { name: 'get_period_close_check', run: () => getPeriodCloseCheck(fixture.client, 'a', 'p'), args: { p_period_id: 'p' }, result: { closed: false, errors: [], warnings: ['W3: 仕訳なし'] } },
  { name: 'close_fiscal_period', run: () => closeFiscalPeriod(fixture.client, 'a', 'p', '確認メモ'), args: { p_period_id: 'p', p_memo: '確認メモ' }, result: { period_id: 'p', closed_at: '2026-11-15T00:00:00Z', warnings: ['W3: 仕訳なし'] } },
  { name: 'reopen_fiscal_period', run: () => reopenFiscalPeriod(fixture.client, 'a', 'p', '解除メモ'), args: { p_period_id: 'p', p_memo: '解除メモ' }, result: { period_id: 'p', closed_at: null } },
]
describe('期ごとのRPCラッパー', () => {
  it.each(cases)('$nameの引数と戻り値をそのまま扱い、会社を照合する', async item => {
    rpc.mockResolvedValue({ data: item.result, error: null })
    expect(await item.run()).toEqual(item.result)
    expect(rpc).toHaveBeenCalledExactlyOnceWith(item.name, item.args)
    expect(fixture.calls[0].filters).toEqual([['company_id', 'eq', 'a'], ['id', 'eq', 'p']])
  })
  it.each(cases)('$nameのP0001とDETAILを変換する', async item => {
    rpc.mockResolvedValue({ data: null, error: { name: 'PostgrestError', code: 'P0001', message: 'PERIOD_CLOSED', details: '期の補足', hint: '' } })
    await expect(item.run()).rejects.toMatchObject({ code: 'PERIOD_CLOSED', message: `${ERROR_CODES.PERIOD_CLOSED.message}（期の補足）` })
  })
  it.each([closeFiscalPeriod, reopenFiscalPeriod])('省略メモはnull、空欄は空文字で送る', async operation => {
    rpc.mockResolvedValue({ data: {}, error: null })
    await operation(fixture.client, 'a', 'p')
    expect(rpc.mock.calls[0][1]).toEqual({ p_period_id: 'p', p_memo: null })
    await operation(fixture.client, 'a', 'p', '')
    expect(rpc.mock.calls[1][1]).toEqual({ p_period_id: 'p', p_memo: '' })
  })
  it('他社・存在しない期はRPC前に拒否する', async () => {
    for (const id of ['other', 'missing']) await expect(closeFiscalPeriod(fixture.client, 'a', id)).rejects.toMatchObject({ code: 'PERIOD_NOT_FOUND' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('通信中に会社が切り替わった場合もRPC前に拒否する', async () => {
    fixture.failWith(() => { vi.stubGlobal('document', { cookie: 'sa_company_id=b' }); return undefined })
    await expect(reopenFiscalPeriod(fixture.client, 'a', 'p')).rejects.toMatchObject({ code: 'STALE_COMPANY' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('読取失敗や空のRPC結果を成功にしない', async () => {
    fixture.failWith(() => '読取失敗')
    await expect(getPeriodCloseCheck(fixture.client, 'a', 'p')).rejects.toMatchObject({ code: 'DB_QUERY_FAILED' })
    fixture.failWith(() => undefined)
    rpc.mockResolvedValue({ data: null, error: null })
    await expect(closeFiscalPeriod(fixture.client, 'a', 'p')).rejects.toThrow('操作結果')
  })
})

describe('確定済み期の削除', () => {
  it('仕訳や当期等の既存条件より先に確定済みを案内し、DELETEしない', async () => {
    fixture.tables.fiscal_periods[0].closed_at = '2026-11-15T00:00:00Z'
    expect(await deletePeriodForCompany(fixture.client, 'a', 'p')).toEqual({ code: 'PERIOD_CLOSED_FIELDS', error: ERROR_CODES.PERIOD_CLOSED_FIELDS.message })
    expect(fixture.calls).toHaveLength(1)
    expect(fixture.calls.some(call => call.operation === 'delete')).toBe(false)
  })
  it('未確定期は従来どおり削除できる', async () => {
    expect(await deletePeriodForCompany(fixture.client, 'a', 'p')).toEqual({})
    expect(fixture.tables.fiscal_periods.map(p => p.id)).toEqual(['other'])
  })
})
