import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', async () => {
  const { fakeSupabase } = await import('@/__tests__/helpers/fake-supabase')
  return { supabase: fakeSupabase }
})

import {
  lookupAccount,
  lookupSubAccount,
  lookupTaxCode,
  normalizeDate,
  type ImportAccountRow,
} from '@/lib/csv-import'

describe('normalizeDate', () => {
  it.each<[string, string]>([
    ['2026-04-01', '2026-04-01'],
    ['2026/04/01', '2026-04-01'],
    ['2026/4/1', '2026-04-01'],
    ['20260401', '2026-04-01'],
    ['  2026/4/1  ', '2026-04-01'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeDate(input)).toBe(expected)
  })

  it.each<string>(['', '2026.4.1', '26/4/1', '2026-4-1', '2026/04', '202604011', '令和8年4月1日', 'abc'])(
    '形式外は null: %j',
    (input) => {
      expect(normalizeDate(input)).toBeNull()
    },
  )
})

// 弥生の出力 CSV の和暦表記（元号記号.年/月/日）。年は元号ごとの差で西暦にする
describe('normalizeDate: 和暦', () => {
  it.each<[string, string]>([
    ['R.08/04/01', '2026-04-01'],
    ['R.1/5/1', '2019-05-01'],
    ['H.30/04/01', '2018-04-01'],
    ['H.31/04/30', '2019-04-30'],
    ['S.64/01/07', '1989-01-07'],
    ['S.25/12/31', '1950-12-31'],
    ['T.15/12/25', '1926-12-25'],
    ['M.45/07/30', '1912-07-30'],
    ['r.08/04/01', '2026-04-01'],
    ['  R.08/04/01  ', '2026-04-01'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeDate(input)).toBe(expected)
  })

  it.each<string>(['R.00/04/01', 'X.08/04/01', 'R08/04/01', 'R.08/04', 'R.008/04/01', 'R.08-04-01', '令和8/4/1'])(
    '和暦として読めなければ null: %j',
    (input) => {
      expect(normalizeDate(input)).toBeNull()
    },
  )

  it('元号の境界は検証しない（令和元年4月30日 = R.01/04/30 も変換する。別課題）', () => {
    expect(normalizeDate('R.01/04/30')).toBe('2019-04-30')
  })
})

describe('normalizeDate: [現行挙動・要改善] 暦として正しいかは検証しない', () => {
  // 不正な日付はここでは弾かれず、本登録の RPC（import_staging_entries）が INVALID_DATE で拒否する
  it.each<[string, string]>([
    ['2026/2/30', '2026-02-30'],
    ['2026-13-45', '2026-13-45'],
    ['20260000', '2026-00-00'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeDate(input)).toBe(expected)
  })
})

const accounts: ImportAccountRow[] = [
  { id: '1', name: '旅費', parent_id: null, account_aliases: [] },
  { id: '2', name: '交通費', parent_id: null, account_aliases: [{ normalized_alias: 'りょひ' }, { normalized_alias: 'ちょうど' }] },
  { id: '3', name: '消耗品費', parent_id: null, account_aliases: [{ normalized_alias: 'しょうもうひん' }, { normalized_alias: 'cash' }] },
]

describe('lookupAccount', () => {
  it('名前の完全一致を返す', () => {
    expect(lookupAccount('旅費', accounts, [])).toBe('1')
  })

  it('エイリアス（正規化済み）で一致する', () => {
    expect(lookupAccount('りょひ', accounts, [])).toBe('2')
  })

  it('優先順位: 名前 > エイリアス > 置換ルール', () => {
    // 置換ルールが「旅費」を別の科目に向けていても、名前一致が先に勝つ
    expect(lookupAccount('旅費', accounts, [{ keyword: '旅費', account_id: '2' }])).toBe('1')
    // エイリアスと置換ルールが競合したら、エイリアスが勝つ
    expect(lookupAccount('ちょうど', accounts, [{ keyword: 'ちょうど', account_id: '1' }])).toBe('2')
    // どちらにも無ければ置換ルール
    expect(lookupAccount('出張', accounts, [{ keyword: '出張', account_id: '1' }])).toBe('1')
  })

  it.each<[string, string]>([
    ['ｼｮｳﾓｳﾋﾝ', '半角カナ'],
    ['ショウモウヒン', '全角カタカナ'],
    ['しょうもうひん', 'ひらがな'],
    ['　しょうもうひん　', '前後の空白'],
    ['ＣＡＳＨ', '全角英字（小文字化）'],
    ['Cash', '大文字小文字'],
  ])('表記ゆれを吸収して一致する: %j（%s）', (input) => {
    expect(lookupAccount(input, accounts, [])).toBe('3')
  })

  it('置換ルールのキーワードも正規化して照合する', () => {
    expect(lookupAccount('アマゾン', accounts, [{ keyword: 'ｱﾏｿﾞﾝ', account_id: '3' }])).toBe('3')
  })

  it('見つからなければ null', () => {
    expect(lookupAccount('存在しない科目', accounts, [])).toBeNull()
  })
})

describe('lookupSubAccount', () => {
  const subs: ImportAccountRow[] = [
    { id: 'p1', name: '普通預金', parent_id: null, account_aliases: [] },
    { id: 'p2', name: '定期預金', parent_id: null, account_aliases: [] },
    { id: 's1', name: 'A銀行', parent_id: 'p1', account_aliases: [{ normalized_alias: 'えーぎんこう' }] },
  ]

  it('指定した親の配下だけを名前で探す', () => {
    expect(lookupSubAccount('A銀行', 'p1', subs, [])).toBe('s1')
    expect(lookupSubAccount('A銀行', 'p2', subs, [])).toBeNull()
  })

  it('置換ルールは、対象が同じ親の補助科目のときだけ有効', () => {
    const rules = [{ keyword: 'あ銀', account_id: 's1' }]
    expect(lookupSubAccount('あ銀', 'p1', subs, rules)).toBe('s1')
    expect(lookupSubAccount('あ銀', 'p2', subs, rules)).toBeNull()
  })

  it('[現行挙動] 補助科目のエイリアスは見ない（lookupAccount とは異なる）', () => {
    expect(lookupSubAccount('えーぎんこう', 'p1', subs, [])).toBeNull()
  })
})

describe('lookupTaxCode', () => {
  const taxCodes = [
    { id: 'PROP_PURCHASE_10', name: '課税仕入10%', short_name: '仕入10' },
    { id: 'OUT_OF_SCOPE', name: '対象外', short_name: null },
  ]

  it.each<[string, string]>([
    ['PROP_PURCHASE_10', 'PROP_PURCHASE_10'],
    ['prop_purchase_10', 'PROP_PURCHASE_10'],
    ['課税仕入10%', 'PROP_PURCHASE_10'],
    ['課税仕入１０％', 'PROP_PURCHASE_10'],
    ['仕入10', 'PROP_PURCHASE_10'],
    ['対象外', 'OUT_OF_SCOPE'],
  ])('%j → %j', (input, expected) => {
    expect(lookupTaxCode(input, taxCodes)).toBe(expected)
  })

  it('見つからなければ null', () => {
    expect(lookupTaxCode('不明な区分', taxCodes)).toBeNull()
  })
})
