import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }))

import { getJournalReport, resolveTaxCodeLabel } from '@/lib/reports/journal'
import { supabase } from '@/lib/supabase'

const taxCodes = [
  { id: 'PROP_PURCHASE_10', short_name: '課対仕入10%', name: '課税対応仕入10%' },
  { id: 'OUT_OF_SCOPE', short_name: null, name: '対象外' },
]

describe('resolveTaxCodeLabel', () => {
  it('short_name があれば優先する', () => {
    expect(resolveTaxCodeLabel(taxCodes, 'PROP_PURCHASE_10')).toBe('課対仕入10%')
  })

  it('short_name がなければ name を使う', () => {
    expect(resolveTaxCodeLabel(taxCodes, 'OUT_OF_SCOPE')).toBe('対象外')
  })

  it('未登録の ID はそのまま返す', () => {
    expect(resolveTaxCodeLabel(taxCodes, 'UNKNOWN_TAX_ID')).toBe('UNKNOWN_TAX_ID')
  })

  it('null は null を返す', () => {
    expect(resolveTaxCodeLabel(taxCodes, null)).toBeNull()
  })
})

const from = vi.mocked(supabase.from)
const params = { periodId: 'fixture-period', periodName: '架空の会計期間' }
let taxError: { message: string } | null
let referenceNumber: number | null
let linesResult: { data: { entry_id: string }[] | null; error: { message: string } | null }
const orders: [string, unknown][] = []
const entryInCalls: [string, string[]][] = []

beforeEach(() => {
  taxError = null
  referenceNumber = null
  linesResult = { data: [], error: null }
  orders.length = 0
  entryInCalls.length = 0
  from.mockReset()
  from.mockImplementation(table => {
    const result = table === 'journal_lines' ? linesResult : {
      error: table === 'tax_codes' ? taxError : null,
      data: table === 'fiscal_periods' ? { company_id: 'fixture-company' } : table === 'tax_codes' ? taxCodes : table === 'journal_entries' ? [{
        id: 'fixture-entry', date: '2026-04-01', description: '架空の取引',
        reference_number: referenceNumber, is_opening_balance: false,
        journal_lines: [
          { line_number: 1, side: 'DEBIT', amount: 11000, tax_code: 'PROP_PURCHASE_10', accounts: null },
          { line_number: 2, side: 'CREDIT', amount: 11000, tax_code: 'OUT_OF_SCOPE', accounts: null },
        ],
      }] : [],
    }
    const query = {
      select: () => query,
      single: () => Promise.resolve(result),
      eq: () => query,
      gte: () => query,
      lte: () => query,
      in: (column: string, values: string[]) => {
        if (table === 'journal_entries') entryInCalls.push([column, values])
        return query
      },
      order: (column: string, options: unknown) => {
        if (table === 'journal_entries') orders.push([column, options])
        return query
      },
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    }
    return query as unknown as ReturnType<typeof supabase.from>
  })
})

describe('getJournalReport の税区分', () => {
  it.each([null, 7, 999999999])('PDF表示用に番号 %j を文字列またはnullへ変換する', async value => {
    referenceNumber = value
    const report = await getJournalReport(params)
    expect(report.rows[0].referenceNumber).toBe(value === null ? null : String(value))
  })
  it('取得した税区分マスタで借方・貸方の表示名を解決する', async () => {
    const report = await getJournalReport(params)
    expect(from).toHaveBeenCalledWith('tax_codes')
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({ debitTaxCode: '課対仕入10%', creditTaxCode: '対象外' })
  })

  it('画面と同じ日付→伝票番号（NULLは最後）→作成日時→IDで取得する', async () => {
    await getJournalReport(params)
    expect(orders).toEqual([
      ['date', { ascending: true }],
      ['reference_number', { ascending: true, nullsFirst: false }],
      ['created_at', { ascending: true }],
      ['id', { ascending: true }],
    ])
  })

  it('マスタの取得失敗は未登録 ID と区別して例外にする', async () => {
    taxError = { message: '税区分の取得に失敗しました' }
    await expect(getJournalReport(params)).rejects.toThrow(taxError.message)
  })
})

describe('getJournalReport の明細検索', () => {
  it('金額条件による明細の取得失敗は、そのメッセージで例外にする', async () => {
    linesResult = { data: null, error: { message: '架空の明細取得エラー' } }

    await expect(getJournalReport({ ...params, amountMin: '10000' }))
      .rejects.toThrow('架空の明細取得エラー')
  })

  it('金額条件に一致した明細の仕訳IDで絞り込み、該当仕訳を返す', async () => {
    linesResult = { data: [{ entry_id: 'fixture-entry' }], error: null }

    const report = await getJournalReport({ ...params, amountMin: '10000' })

    expect(from).toHaveBeenCalledWith('journal_lines')
    expect(entryInCalls).toEqual([['id', ['fixture-entry']]])
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({ entryId: 'fixture-entry', description: '架空の取引' })
  })
})
