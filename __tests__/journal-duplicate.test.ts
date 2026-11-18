import { describe, expect, it } from 'vitest'
import { entryToInlineDraft, isSimpleEntry } from '../lib/journal-duplicate'

const accounts = [
  { id: 'cash', parent_id: null },
  { id: 'sales', parent_id: null },
  { id: 'cash-sub', parent_id: 'cash' },
  { id: 'orphan-sub', parent_id: 'missing-parent' },
]

function makeEntry() {
  return {
    date: '2026-04-15',
    description: '売上の入金',
    supplement: '複製元の補足' as string | null,
    journal_lines: [
      { side: 'DEBIT' as const, account_id: 'cash', amount: 1234, tax_code: 'PURCHASE' as string | null, line_number: 1 },
      { side: 'CREDIT' as const, account_id: 'sales', amount: 1234, tax_code: 'SALES' as string | null, line_number: 2 },
    ],
  }
}

describe('entryToInlineDraft', () => {
  it('親科目どうしの明細・金額・税区分・補足を複製する', () => {
    expect(entryToInlineDraft(makeEntry(), accounts)).toEqual({
      date: '2026-04-15', description: '売上の入金', supplement: '複製元の補足',
      lines: [
        { side: 'DEBIT', account_id: 'cash', sub_account_id: '', amount: '1234', tax_code: 'PURCHASE' },
        { side: 'CREDIT', account_id: 'sales', sub_account_id: '', amount: '1234', tax_code: 'SALES' },
      ],
    })
  })

  it('補助科目を親科目と補助科目に分ける', () => {
    const entry = makeEntry()
    entry.journal_lines[0].account_id = 'cash-sub'
    expect(entryToInlineDraft(entry, accounts).lines[0]).toMatchObject({
      account_id: 'cash', sub_account_id: 'cash-sub',
    })
  })

  it('元の行番号が貸方→借方でも借方→貸方の順で返す', () => {
    const entry = makeEntry()
    entry.journal_lines.reverse()
    entry.journal_lines.forEach((line, index) => { line.line_number = index + 1 })
    expect(entryToInlineDraft(entry, accounts).lines.map(line => [line.side, line.account_id]))
      .toEqual([['DEBIT', 'cash'], ['CREDIT', 'sales']])
  })

  it('税区分 null は空文字にする', () => {
    const entry = makeEntry()
    entry.journal_lines.forEach(line => { line.tax_code = null })
    expect(entryToInlineDraft(entry, accounts).lines.map(line => line.tax_code)).toEqual(['', ''])
  })

  it('補足 null は空文字にする', () => {
    const entry = makeEntry()
    entry.supplement = null
    expect(entryToInlineDraft(entry, accounts).supplement).toBe('')
  })

  it('小数の金額を文字列で保持する', () => {
    const entry = makeEntry()
    entry.journal_lines.forEach(line => { line.amount = 1234.5 })
    expect(entryToInlineDraft(entry, accounts).lines.map(line => line.amount)).toEqual(['1234.5', '1234.5'])
  })

  it('科目マスタにないIDは科目と補助を空にする', () => {
    const entry = makeEntry()
    entry.journal_lines[0].account_id = 'deleted'
    expect(entryToInlineDraft(entry, accounts).lines[0]).toMatchObject({
      account_id: '', sub_account_id: '', amount: '1234', tax_code: 'PURCHASE',
    })
  })

  it('補助科目があっても親科目がマスタにない場合は科目と補助を空にする', () => {
    const entry = makeEntry()
    entry.journal_lines[0].account_id = 'orphan-sub'
    expect(entryToInlineDraft(entry, accounts).lines[0]).toMatchObject({
      account_id: '', sub_account_id: '',
    })
  })

  it('元の仕訳の日付と摘要をそのまま入れる', () => {
    const entry = makeEntry()
    entry.date = '2025-12-10'
    entry.description = '元の摘要　そのまま'
    expect(entryToInlineDraft(entry, accounts)).toMatchObject({
      date: entry.date, description: entry.description,
    })
  })

  it('借方2・貸方1の複合仕訳は例外にする', () => {
    const entry = makeEntry()
    entry.journal_lines.push({ ...entry.journal_lines[0], line_number: 3 })
    expect(() => entryToInlineDraft(entry, accounts))
      .toThrow('単純仕訳以外はインライン入力に複製できません')
  })
})

describe('isSimpleEntry', () => {
  it.each([
    { sides: ['DEBIT', 'CREDIT'], expected: true },
    { sides: ['DEBIT', 'DEBIT', 'CREDIT'], expected: false },
    { sides: ['DEBIT', 'CREDIT', 'CREDIT'], expected: false },
    { sides: ['DEBIT', 'DEBIT'], expected: false },
  ] as const)('$sides → $expected', ({ sides, expected }) => {
    expect(isSimpleEntry({ journal_lines: sides.map(side => ({ side })) })).toBe(expected)
  })
})
