import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import { buildJournalsCsv } from '@/lib/csv-export'

type Entry = Parameters<typeof buildJournalsCsv>[0][number]
type Line = Entry['journal_lines'][number]

const accounts = [
  { id: 'cash', name: '現金', parent_id: null },
  { id: 'sales', name: '売上高', parent_id: null },
  { id: 'bank', name: '普通預金', parent_id: null },
  { id: 'bank-a', name: 'テスト銀行', parent_id: 'bank' },
]
const header = '日付,伝票番号,摘要,補足,借方科目,借方補助科目,借方金額,貸方科目,貸方補助科目,貸方金額'

function line(side: 'DEBIT' | 'CREDIT', line_number: number, account_id: string, amount: number): Line {
  return { side, line_number, account_id, amount, accounts: accounts.find(account => account.id === account_id) ?? null }
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'entry-1', date: '2026-04-01', reference_number: 7,
    description: 'テスト仕訳', supplement: '請求書 A-1', is_opening_balance: false,
    journal_lines: [line('DEBIT', 1, 'cash', 1000), line('CREDIT', 2, 'sales', 1000)],
    ...overrides,
  }
}

function parse(csv: string): string[][] {
  const result = Papa.parse<string[]>(csv)
  expect(result.errors).toEqual([])
  return result.data
}

describe('buildJournalsCsv', () => {
  it.each([1, 42, 999999999])('確定番号 %j を文字列のCSV列として出力する', reference_number => {
    expect(parse(buildJournalsCsv([entry({ reference_number })], accounts))[1][1]).toBe(String(reference_number))
  })
  it('空の一覧も、補足が摘要のすぐ右にある10列の見出しを返す', () => {
    expect(buildJournalsCsv([], accounts)).toBe(header)
  })

  it('通常の仕訳を補足付きで出力する', () => {
    expect(buildJournalsCsv([entry()], accounts)).toBe(
      header + '\r\n2026/04/01,7,テスト仕訳,請求書 A-1,現金,,1000,売上高,,1000'
    )
  })

  it.each([null, ''])('補足が %j のときは空欄にする', supplement => {
    const rows = parse(buildJournalsCsv([entry({ supplement })], accounts))
    expect(rows[1]).toEqual(['2026/04/01', '7', 'テスト仕訳', '', '現金', '', '1000', '売上高', '', '1000'])
  })

  it('借方が多い複合仕訳の各表示行に、摘要・伝票番号・補足を繰り返す', () => {
    const source = entry({ journal_lines: [
      line('CREDIT', 3, 'sales', 1300), line('DEBIT', 2, 'bank-a', 300), line('DEBIT', 1, 'cash', 1000),
    ] })
    expect(parse(buildJournalsCsv([source], accounts)).slice(1)).toEqual([
      ['2026/04/01', '7', 'テスト仕訳', '請求書 A-1', '現金', '', '1000', '売上高', '', '1300'],
      ['2026/04/01', '7', 'テスト仕訳', '請求書 A-1', '普通預金', 'テスト銀行', '300', '', '', ''],
    ])
  })

  it('貸方が多い複合仕訳でも、各表示行に補足を繰り返す', () => {
    const source = entry({ journal_lines: [
      line('CREDIT', 4, 'sales', 600), line('DEBIT', 1, 'cash', 1000),
      line('CREDIT', 3, 'cash', 100), line('CREDIT', 2, 'bank-a', 300),
    ] })
    expect(parse(buildJournalsCsv([source], accounts)).slice(1)).toEqual([
      ['2026/04/01', '7', 'テスト仕訳', '請求書 A-1', '現金', '', '1000', '普通預金', 'テスト銀行', '300'],
      ['2026/04/01', '7', 'テスト仕訳', '請求書 A-1', '', '', '', '現金', '', '100'],
      ['2026/04/01', '7', 'テスト仕訳', '請求書 A-1', '', '', '', '売上高', '', '600'],
    ])
  })

  it('補足のカンマ・引用符・改行をエスケープし、1つの列として復元できる', () => {
    const supplement = '請求書, "A-1"\n確認済み'
    const csv = buildJournalsCsv([entry({ supplement })], accounts)
    expect(csv).toContain('"請求書, ""A-1""\n確認済み"')
    expect(parse(csv)).toHaveLength(2)
    expect(parse(csv)[1][3]).toBe(supplement)
  })

  it('削除済み科目の名前は空欄のまま出力する', () => {
    const source = entry({ journal_lines: [line('DEBIT', 1, 'missing', 1000), line('CREDIT', 2, 'sales', 1000)] })
    expect(parse(buildJournalsCsv([source], accounts))[1].slice(4)).toEqual(['', '', '1000', '売上高', '', '1000'])
  })

  it('明細のない期首残高仕訳も従来どおり1表示行を保つ', () => {
    const source = entry({ is_opening_balance: true, reference_number: null, journal_lines: [] })
    expect(parse(buildJournalsCsv([source], accounts)).slice(1)).toEqual([
      ['2026/04/01', '', 'テスト仕訳', '請求書 A-1', '', '', '', '', '', ''],
    ])
  })

  it('入力の明細配列を変更せず、繰り返し呼んでも同じCSVを返す', () => {
    const source = entry({ journal_lines: [line('CREDIT', 2, 'sales', 1000), line('DEBIT', 1, 'cash', 1000)] })
    const original = [...source.journal_lines]
    Object.freeze(source.journal_lines)
    expect(buildJournalsCsv([source], accounts)).toBe(buildJournalsCsv([source], accounts))
    expect(source.journal_lines).toEqual(original)
  })
})
