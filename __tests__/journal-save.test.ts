import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PostgrestError } from '@supabase/supabase-js'

// lib/supabase.ts は import 時に createClient(env) を実行するため、テストでは差し替える
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))
// このファイルはRPC引数・戻り値の既存契約を検証する。対象会社の照会は別テストで実DB形状のfakeを使う。
vi.mock('@/lib/company-scope', () => ({
  getCompanyIdByPeriod: async () => 'fixture-company',
  getCompanyIdByEntry: async () => 'fixture-company',
}))

import { amountToRpcString, createJournalEntry, updateJournalEntry, importStagingEntries, type SaveLineInput } from '@/lib/journal-save'
import { supabase } from '@/lib/supabase'
import { ERROR_CODES, ValidationError } from '@/lib/errors'

describe('仕訳保存RPC: 補足の引数', () => {
  const rpc = vi.mocked(supabase.rpc)
  const fields = {
    companyId: 'fixture-company',
    date: '2026-04-01',
    description: 'テスト仕訳',
    referenceNumber: 7,
    lines: [
      { side: 'DEBIT', account_id: 'cash-id', amount: 1000, tax_code: '' },
      { side: 'CREDIT', account_id: 'sales-id', amount: '1000', tax_code: 'OUT_OF_SCOPE' },
    ] satisfies SaveLineInput[],
  }
  const expectedFields = {
    p_date: fields.date,
    p_description: fields.description,
    p_reference_number: fields.referenceNumber,
    p_lines: [
      { side: 'DEBIT', account_id: 'cash-id', amount: '1000.00', tax_code: null },
      { side: 'CREDIT', account_id: 'sales-id', amount: '1000', tax_code: 'OUT_OF_SCOPE' },
    ],
  }
  const cases: [string, { supplement?: string | null }, string | null][] = [
    ['省略', {}, null],
    ['undefined', { supplement: undefined }, null],
    ['NULL', { supplement: null }, null],
    ['空文字（削除）', { supplement: '' }, ''],
    ['補足あり', { supplement: ' 請求書 No. A-1 ' }, ' 請求書 No. A-1 '],
  ]

  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValue({ data: { id: 'entry-id', reference_number: 7 }, error: null, count: null, status: 200, statusText: 'OK', success: true })
  })

  it.each(cases)('新規: %s', async (_label, supplementFields, expected) => {
    const id = await createJournalEntry({ ...fields, ...supplementFields, periodId: 'period-id' })

    expect(id).toEqual({ id: 'entry-id', referenceNumber: 7 })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('create_journal_entry', {
      ...expectedFields,
      p_period_id: 'period-id',
      p_supplement: expected,
    })
  })

  it.each(cases)('更新: %s', async (_label, supplementFields, expected) => {
    await updateJournalEntry({ ...fields, ...supplementFields, entryId: 'entry-id' })

    expect(rpc).toHaveBeenCalledExactlyOnceWith('update_journal_entry', {
      ...expectedFields,
      p_entry_id: 'entry-id',
      p_supplement: expected,
    })
  })
})

describe('伝票番号のRPC契約', () => {
  const rpc = vi.mocked(supabase.rpc)
  const fields = { companyId: 'fixture-company', date: '2026-04-01', description: '採番テスト', lines: [] }
  const response = (data: unknown) => ({ data, error: null, count: null, status: 200, statusText: 'OK', success: true as const })

  beforeEach(() => rpc.mockReset())

  it.each([null, undefined, 7, 999999999])('新規・更新の番号 %j を数値またはnullで送信する', async referenceNumber => {
    rpc.mockResolvedValue(response({ id: 'entry-id', reference_number: 42 }))
    const created = await createJournalEntry({ ...fields, referenceNumber, periodId: 'period-id' })
    expect(created).toEqual({ id: 'entry-id', referenceNumber: 42 })
    expect(rpc).toHaveBeenLastCalledWith('create_journal_entry', expect.objectContaining({ p_reference_number: referenceNumber ?? null }))
    await updateJournalEntry({ ...fields, referenceNumber, entryId: 'entry-id' })
    expect(rpc).toHaveBeenLastCalledWith('update_journal_entry', expect.objectContaining({ p_reference_number: referenceNumber ?? null }))
  })

  it.each([
    null, undefined, 'entry-id', [], {}, { id: 123, reference_number: 7 },
    { id: '', reference_number: 7 }, { id: 'entry-id' },
    { id: 'entry-id', reference_number: null }, { id: 'entry-id', reference_number: '7' },
    { id: 'entry-id', reference_number: 0 }, { id: 'entry-id', reference_number: -1 },
    { id: 'entry-id', reference_number: 1.5 }, { id: 'entry-id', reference_number: 1000000000 },
    { id: 'entry-id', reference_number: NaN }, { id: 'entry-id', reference_number: Infinity },
  ])('不正な新規RPC戻り値 %j を例外にする', async data => {
    rpc.mockResolvedValue(response(data))
    await expect(createJournalEntry({ ...fields, periodId: 'period-id' })).rejects.toThrow('戻り値が不正')
  })

  it('DBエラーを戻り値エラーで上書きしない', async () => {
    rpc.mockResolvedValue({ ...response(null), data: null, success: false, error: new PostgrestError({ code: 'P0001', message: 'DUPLICATE_REFERENCE_NUMBER', details: '7 は使用済み', hint: '' }) })
    await expect(createJournalEntry({ ...fields, periodId: 'period-id' })).rejects.toMatchObject({ code: 'DUPLICATE_REFERENCE_NUMBER' })
  })

  it('CSV本登録の配列順・引数・件数の契約は不変', async () => {
    rpc.mockResolvedValue(response(3))
    expect(await importStagingEntries('period-id', ['c', 'a', 'b'], 'fixture-company')).toBe(3)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('import_staging_entries', { p_period_id: 'period-id', p_staging_ids: ['c', 'a', 'b'] })
  })
})

describe('amountToRpcString: number', () => {
  it.each<[number, string]>([
    [1, '1.00'],
    [1000, '1000.00'],
    [1234.5, '1234.50'],
    [12.34, '12.34'],
    [0.01, '0.01'],
    [9999999999999, '9999999999999.00'],
  ])('%j → %j', (input, expected) => {
    expect(amountToRpcString(input, 1)).toBe(expected)
  })

  it.each<[string, number]>([
    ['0', 0],
    ['負数', -1],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['1e13（14桁）', 1e13],
    ['小数第3位 0.001', 0.001],
    ['丸めが必要 1.005', 1.005],
    ['浮動小数誤差 0.1+0.2', 0.1 + 0.2],
  ])('拒否: %s', (_label, input) => {
    expect(() => amountToRpcString(input, 1)).toThrow(ValidationError)
  })
})

describe('amountToRpcString: string', () => {
  it.each<[string, string]>([
    ['1000', '1000'],
    ['1000.5', '1000.5'],
    ['12.34', '12.34'],
    [' 12.5 ', '12.5'],
    ['9999999999999.99', '9999999999999.99'],
  ])('%j → %j', (input, expected) => {
    expect(amountToRpcString(input, 1)).toBe(expected)
  })

  it.each<string>([
    '', '0', '0.00', '-1', '1,000', '1.234', '１２', '1e3', '12.', '.5', '10000000000000',
  ])('拒否: %j', (input) => {
    expect(() => amountToRpcString(input, 1)).toThrow(ValidationError)
  })
})

describe('amountToRpcString: エラー内容', () => {
  it('行番号とエラーコードを含む', () => {
    try {
      amountToRpcString('abc', 3)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError)
      const err = e as ValidationError
      expect(err.code).toBe(ERROR_CODES.INVALID_JOURNAL_LINES.code)
      expect(err.message).toContain('3行目')
    }
  })
})
