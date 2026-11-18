import { beforeEach, describe, expect, it, vi } from 'vitest'
import { companyDb } from './helpers/company-supabase'

let fixture: ReturnType<typeof companyDb>
const rpc = vi.fn()
const active = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => fixture.client.from(table), rpc: (...args: unknown[]) => rpc(...args) } }))
vi.mock('@/lib/company-guard', () => ({ assertActiveCompany: (id: string) => active(id) }))
import { buildOpeningRows, eligibleOpeningAccounts, parseOpeningAmount, convertOpeningBalance, openingInputValues, buildOpeningLines,
  openingTotals, openingDifferences, openingSaveDecision, centsToAmount, fetchOpeningBalanceState, saveOpeningBalances, clearOpeningBalances, type OpeningAccount } from '@/lib/opening-balances'

const account = (id: string, code: string, type = 'ASSET', category: string | null = 'CURRENT_ASSETS', parent: string | null = null): OpeningAccount => ({ id, code, type, bs_category: category, parent_id: parent, name: id })
const accounts = [account('bank-sub', '999', 'ASSET', 'CURRENT_ASSETS', 'bank'), account('bank', '110'), account('cash', '100'),
  account('capital', '400', 'EQUITY', 'EQUITY'), account('draw', '200', 'ASSET', 'OWNER_DRAWINGS'), account('contrib', '300', 'LIABILITY', 'OWNER_CONTRIBUTIONS'),
  account('sales', '500', 'REVENUE', 'EQUITY'), account('no-category', '9999', 'ASSET', null)]
beforeEach(() => {
  rpc.mockReset(); active.mockReset()
  fixture = companyDb({ fiscal_periods: [{ id: 'p', company_id: 'a' }, { id: 'other', company_id: 'b' }],
    companies: [{ id: 'a', kind: 'INDIVIDUAL', carry_forward_account_id: 'capital' }],
    accounts: [...accounts.map(a => ({ ...a, company_id: 'a' })), { ...account('other-cash', '101'), company_id: 'b' }],
  })
})

describe('期首残高の純粋関数', () => {
  it('個人の事業主貸借・PL・区分なしを除外し、親の直下に補助を並べる', () => {
    expect(eligibleOpeningAccounts(accounts, 'INDIVIDUAL').map(a => a.id)).toEqual(['bank-sub', 'bank', 'cash', 'capital'])
    const groups = buildOpeningRows(accounts, 'INDIVIDUAL')
    expect(groups.map(g => g.label)).toEqual(['流動資産', '元入金'])
    expect(groups[0].rows.map(a => [a.id, a.depth])).toEqual([['cash', 0], ['bank', 0], ['bank-sub', 1]])
    expect(buildOpeningRows(accounts, 'CORPORATION').at(-1)?.label).toBe('純資産')
    expect(eligibleOpeningAccounts(accounts, 'CORPORATION').map(a => a.id)).toContain('capital')
    expect(buildOpeningRows([], 'CORPORATION')).toEqual([])
  })
  it.each([['', '0.00'], [' ', '0.00'], ['１２，３４５．６７', '12345.67'], ['-1,234.50', '-1234.50'], ['9999999999999.99', '9999999999999.99'], ['-9999999999999.99', '-9999999999999.99'], ['-0', '0.00']])('入力 %s → %s', (text, value) => {
    expect(parseOpeningAmount(text)).toMatchObject({ ok: true, value })
  })
  it.each(['0.001', '1.000', '10000000000000', '-10000000000000', 'a', '1e3', 'NaN', 'Infinity', '1-2', '+2', '1.'])('不正入力 %s を丸めず拒否する', text => {
    expect(parseOpeningAmount(text).ok).toBe(false)
  })
  it.each(['ASSET', 'LIABILITY', 'EQUITY'])('%sの符号を往復変換する', type => {
    const display = convertOpeningBalance('-1234.56', type)
    expect(display).toBe(type === 'ASSET' ? '-1234.56' : '1234.56')
    expect(convertOpeningBalance(display, type)).toBe('-1234.56')
  })
  it('入力初期値・行ごとの検証・ゼロ除去・保存用文字列を作る', () => {
    const usable = eligibleOpeningAccounts(accounts, 'INDIVIDUAL')
    expect(openingInputValues(usable, [{ account_id: 'capital', balance: '-50' }])).toMatchObject({ cash: '0.00', capital: '50.00' })
    expect(buildOpeningLines(usable, { cash: '1.234', capital: 'a' })).toMatchObject({ valid: false, errors: { cash: expect.any(String), capital: expect.any(String) } })
    expect(buildOpeningLines(usable, { cash: '１，０００.０１', capital: '1000.01', bank: '-0' })).toEqual({ valid: true, errors: {}, lines: [{ account_id: 'cash', balance: '1000.01' }, { account_id: 'capital', balance: '-1000.01' }] })
  })
  it('銭単位で貸借を集計し、最大値が多数でも精度を落とさない', () => {
    const lines = Array.from({ length: 100 }, () => ({ account_id: 'cash', balance: '9999999999999.99' }))
    expect(openingTotals(lines).debit).toBe('999999999999999.00')
    expect(openingTotals([{ account_id: 'cash', balance: '0.30' }, { account_id: 'a', balance: '-0.1' }, { account_id: 'b', balance: '-0.2' }])).toEqual({ debit: '0.30', credit: '0.30', difference: '0.00', balanced: true })
    expect(openingTotals([{ account_id: 'cash', balance: '-0.01' }]).difference).toBe('-0.01')
    expect(centsToAmount(BigInt(0))).toBe('0.00')
  })
  it('両方の科目集合から差と件数を数える（導出値だけの科目も含む）', () => {
    const result = openingDifferences([{ account_id: 'a', balance: '1.01' }, { account_id: 'c', balance: '-5' }], [{ account_id: 'a', balance: '1.00' }, { account_id: 'b', balance: '-2' }, { account_id: 'c', balance: '-5' }])
    expect(result.count).toBe(2)
    expect([...result.byAccount]).toEqual([['a', '0.01'], ['c', '0.00'], ['b', '2.00']])
  })
  it('保存前は入力不正を優先し、差額ゼロは直送・非ゼロは確認する', () => {
    expect(openingSaveDecision(false, [])).toBe('invalid')
    expect(openingSaveDecision(true, [])).toBe('save')
    expect(openingSaveDecision(true, [{ account_id: 'cash', balance: '0.01' }])).toBe('confirm')
  })
})

describe('期首残高の取得・RPC', () => {
  const input = { companyId: 'a', periodId: 'p', lines: [{ account_id: 'cash', balance: '1.20' }, { account_id: 'capital', balance: '-1.20' }, { account_id: 'bank', balance: '0' }], memo: 'メモ', autoBalance: false }
  const saved = { period_id: 'p', line_count: 2, auto_balanced: false, adjustment: 0 }
  it('期から会社を決定し、手動ヘッダー・明細・導出・繰越先名を取得する', async () => {
    fixture.tables.period_opening_balance_sets = [{ id: 'set', company_id: 'a', period_id: 'p', memo: '開始残高' }, { id: 'other-set', company_id: 'b', period_id: 'p' }]
    fixture.tables.period_opening_balance_lines = [{ company_id: 'a', period_id: 'p', account_id: 'cash', balance: '20.10' }, { company_id: 'b', period_id: 'p', account_id: 'cash', balance: '999' }]
    rpc.mockResolvedValue({ data: [{ account_id: 'cash', balance: 10 }], error: null })
    const state = await fetchOpeningBalanceState('p')
    expect(state).toMatchObject({ companyId: 'a', kind: 'INDIVIDUAL', carryForwardAccountName: 'capital', manualSet: { id: 'set', memo: '開始残高' }, manualLines: [{ account_id: 'cash', balance: '20.10' }], derivedLines: [{ account_id: 'cash', balance: '10.00' }] })
    expect(state.accounts.map(a => a.id)).not.toContain('other-cash')
    expect(state.accounts.map(a => a.id)).not.toContain('draw')
    expect(rpc).toHaveBeenCalledWith('get_derived_opening_balances_for_period', { target_period_id: 'p' })
  })
  it('空の手動設定と未設定を区別する', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    expect((await fetchOpeningBalanceState('p')).manualSet).toBeNull()
    fixture.tables.period_opening_balance_sets = [{ id: 'empty', company_id: 'a', period_id: 'p', memo: null }]
    expect((await fetchOpeningBalanceState('p')).manualSet?.id).toBe('empty')
  })
  it.each(['save', 'clear'])('%sは別会社の期をRPC前に拒否する', async mode => {
    await expect(mode === 'save' ? saveOpeningBalances({ ...input, periodId: 'other' }) : clearOpeningBalances({ companyId: 'a', periodId: 'other' })).rejects.toMatchObject({ code: 'COMPANY_MISMATCH' })
    expect(rpc).not.toHaveBeenCalled()
    expect(active.mock.calls).toEqual([['a']])
  })
  it('取得でもアクティブ会社不一致ならRPCを呼ばない', async () => {
    active.mockImplementation(() => { throw new Error('stale') })
    await expect(fetchOpeningBalanceState('other')).rejects.toThrow('stale')
    expect(rpc).not.toHaveBeenCalled()
  })
  it('保存は二度の会社確認後に、ゼロ除去・金額文字列・booleanを送る', async () => {
    rpc.mockImplementation(async () => { expect(active.mock.calls).toEqual([['a'], ['a']]); return { data: saved, error: null } })
    await saveOpeningBalances(input)
    expect(rpc).toHaveBeenCalledWith('save_period_opening_balances', { p_period_id: 'p', p_lines: input.lines.slice(0, 2), p_memo: 'メモ', p_auto_balance: false })
  })
  it('全額ゼロと自動集計trueを送れる', async () => {
    rpc.mockResolvedValue({ data: { ...saved, line_count: 0, auto_balanced: true }, error: null })
    await saveOpeningBalances({ ...input, lines: [], memo: null, autoBalance: true })
    expect(rpc).toHaveBeenCalledWith('save_period_opening_balances', { p_period_id: 'p', p_lines: [], p_memo: null, p_auto_balance: true })
  })
  it('解除は二度の会社確認後にRPCだけで書き込む', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await clearOpeningBalances(input)
    expect(active.mock.calls).toEqual([['a'], ['a']])
    expect(rpc).toHaveBeenCalledWith('clear_period_opening_balances', { p_period_id: 'p' })
    expect(fixture.calls.every(call => call.operation === 'read')).toBe(true)
  })
  it.each(['save', 'clear', 'fetch'])('%s のRPC失敗を翻訳する', async mode => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'CARRY_FORWARD_NOT_SET', details: '補足' } })
    await expect(mode === 'save' ? saveOpeningBalances(input) : mode === 'clear' ? clearOpeningBalances(input) : fetchOpeningBalanceState('p')).rejects.toMatchObject({ code: 'CARRY_FORWARD_NOT_SET', message: expect.stringContaining('繰越先の科目が設定されていません') })
  })
  it.each([null, {}, { period_id: 'other', line_count: 2, auto_balanced: false, adjustment: 0 }, { period_id: 'p', line_count: 1.1, auto_balanced: false, adjustment: 0 }, { period_id: 'p', line_count: -1, auto_balanced: false, adjustment: 0 }, { period_id: 'p', line_count: 1, auto_balanced: 'false', adjustment: 0 }, { period_id: 'p', line_count: 1, auto_balanced: false, adjustment: 'NaN' }])('不正な保存戻り値%jを拒否する', async data => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(saveOpeningBalances(input)).rejects.toThrow('戻り値が不正')
  })
  it('解除の不正な戻り値と取得の不正な残高を拒否する', async () => {
    rpc.mockResolvedValue({ data: {}, error: null })
    await expect(clearOpeningBalances(input)).rejects.toThrow('戻り値が不正')
    rpc.mockResolvedValue({ data: [{ account_id: 'cash', balance: '0.001' }], error: null })
    await expect(fetchOpeningBalanceState('p')).rejects.toThrow('取得結果が不正')
  })
})
