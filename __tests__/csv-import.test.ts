import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', async () => {
  const { fakeSupabase } = await import('@/__tests__/helpers/fake-supabase')
  return { supabase: fakeSupabase }
})

import { parseCsvFile } from '@/lib/csv-import'
import { customRow, fakeDb, ID, resetFakeDb } from '@/__tests__/helpers/fake-supabase'

beforeEach(() => {
  resetFakeDb()
})

// 呼び出し側（CsvUploader）が見出し行を除いた配列を渡す。行番号は i + 2（見出し行を 1 行目とする）
describe('parseCsvFile（独自形式）: 正常系', () => {
  it('各列から ParsedStagingRow を作る', async () => {
    const { rows, errors, warnings } = await parseCsvFile([
      customRow({
        date: '2026/4/1',
        debit: '消耗品費',
        debitTax: '対象外',
        debitAmount: '1,100',
        credit: '現金',
        creditAmount: '1100',
        description: '文具',
      }),
    ])
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(rows).toEqual([
      {
        raw_date: '2026-04-01',
        raw_debit_account: '消耗品費',
        raw_debit_sub_account: '',
        raw_debit_tax_code: '対象外',
        raw_debit_amount: 1100,
        raw_credit_account: '現金',
        raw_credit_sub_account: '',
        raw_credit_tax_code: '',
        raw_credit_amount: 1100,
        raw_description: '文具',
        predicted_account_id: ID.supplies,
        debit_sub_account_id: null,
        debit_tax_code_id: 'OUT_OF_SCOPE',
        counter_account_id: ID.cash,
        credit_sub_account_id: null,
        credit_tax_code_id: null,
        parse_warnings: [],
        is_processed: false,
      },
    ])
  })

  it('補助科目・エイリアス・置換ルールを解決する', async () => {
    const { rows, errors } = await parseCsvFile([
      customRow({ debit: '普通預金', debitSub: 'A銀行', credit: 'ｱﾏｿﾞﾝ' }),
      customRow({ debit: 'ふつうよきん', debitSub: 'あ銀', credit: 'ショウモウヒン' }),
    ])
    expect(errors).toEqual([])
    expect(rows.map((r) => [r.predicted_account_id, r.debit_sub_account_id, r.counter_account_id])).toEqual([
      [ID.bank, ID.bankA, ID.supplies],
      [ID.bank, ID.bankA, ID.supplies],
    ])
  })

  it('摘要の全角スペース・連続空白を 1 つの半角スペースにそろえる', async () => {
    const { rows } = await parseCsvFile([customRow({ description: '　文具　　購入  ' })])
    expect(rows[0].raw_description).toBe('文具 購入')
  })

  it('片側の金額だけでも受理し、もう片側は 0 になる', async () => {
    const { rows, errors } = await parseCsvFile([customRow({ debitAmount: '1000', creditAmount: '' })])
    expect(errors).toEqual([])
    expect([rows[0].raw_debit_amount, rows[0].raw_credit_amount]).toEqual([1000, 0])
  })

  it('空の入力は何も返さない', async () => {
    expect(await parseCsvFile([])).toEqual({ rows: [], errors: [], warnings: [] })
  })
})

describe('parseCsvFile（独自形式）: エラー', () => {
  it('行番号（見出し行を 1 とする）と列名つきで返し、エラー行は rows に入れない', async () => {
    const { rows, errors } = await parseCsvFile([
      customRow({}),
      customRow({ debit: '存在しない科目' }),
      customRow({}),
    ])
    expect(rows).toHaveLength(2)
    expect(errors).toEqual([
      {
        row: 3,
        column: '借方科目',
        value: '存在しない科目',
        message: '科目が見つかりません。置換ルールを登録してください。',
      },
    ])
  })

  it.each<[string, string[], string, string]>([
    ['日付', customRow({ date: '2026.4.1' }), '日付', '日付の形式が正しくありません'],
    ['借方科目が空', customRow({ debit: '' }), '借方科目', '借方科目が空です'],
    ['貸方科目が空', customRow({ credit: '' }), '貸方科目', '貸方科目が空です'],
    ['貸方科目が未登録', customRow({ credit: '謎' }), '貸方科目', '科目が見つかりません。置換ルールを登録してください。'],
    ['借方補助科目が未登録', customRow({ debit: '普通預金', debitSub: 'Z銀行' }), '借方補助科目', '補助科目が見つかりません'],
    ['貸方補助科目が未登録', customRow({ credit: '普通預金', creditSub: 'Z銀行' }), '貸方補助科目', '補助科目が見つかりません'],
    ['借方税区分が未登録', customRow({ debitTax: '謎区分' }), '借方税区分', '税区分が見つかりません'],
    ['貸方税区分が未登録', customRow({ creditTax: '謎区分' }), '貸方税区分', '税区分が見つかりません'],
  ])('%s', async (_label, row, column, message) => {
    const { rows, errors } = await parseCsvFile([row])
    expect(rows).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ row: 2, column, message })
  })

  it('補助科目は、指定した親の配下にあるものだけが対象', async () => {
    // A銀行は普通預金の補助科目。現金の補助としては見つからない
    const { errors } = await parseCsvFile([customRow({ debit: '現金', debitSub: 'A銀行' })])
    expect(errors.map((e) => e.column)).toEqual(['借方補助科目'])
  })

  it('金額は parseCsvAmount の判定とメッセージをそのまま返す（借方・貸方とも）', async () => {
    const { errors } = await parseCsvFile([customRow({ debitAmount: '1e3', creditAmount: '100.5' })])
    expect(errors).toEqual([
      {
        row: 2,
        column: '借方金額',
        value: '1e3',
        message: '金額の形式が正しくありません（半角数字のみ・13桁まで）',
      },
      {
        row: 2,
        column: '貸方金額',
        value: '100.5',
        message: '小数点以下は指定できません（整数円のみ）',
      },
    ])
  })

  it('借方・貸方がともに 0（または空）ならエラー', async () => {
    const { rows, errors } = await parseCsvFile([customRow({ debitAmount: '', creditAmount: '0' })])
    expect(rows).toEqual([])
    expect(errors).toEqual([
      {
        row: 2,
        column: '借方金額',
        value: '0',
        message: '借方金額・貸方金額のどちらかに0より大きい値が必要です',
      },
    ])
  })

  it('1 行に複数の問題があれば、すべて集めて返す', async () => {
    const { errors } = await parseCsvFile([customRow({ date: '不正', debit: '', debitAmount: '1e3' })])
    expect(errors.map((e) => e.column)).toEqual(['日付', '借方金額', '借方科目'])
  })

  it('正常行と異常行が混在しても、行ごとに独立して判定する', async () => {
    const { rows, errors } = await parseCsvFile([
      customRow({ description: '1' }),
      customRow({ date: '不正', description: '2' }),
      customRow({ description: '3' }),
      customRow({ credit: '謎', description: '4' }),
    ])
    expect(rows.map((r) => r.raw_description)).toEqual(['1', '3'])
    expect(errors.map((e) => e.row)).toEqual([3, 5])
  })
})

describe('parseCsvFile（独自形式）: [現行挙動・要改善]', () => {
  it('借方と貸方の金額が違っても、パーサーは受理する（借貸一致は本登録の RPC が拒否する）', async () => {
    const { rows, errors } = await parseCsvFile([customRow({ debitAmount: '1000', creditAmount: '2000' })])
    expect(errors).toEqual([])
    expect([rows[0].raw_debit_amount, rows[0].raw_credit_amount]).toEqual([1000, 2000])
  })

  it('暦として存在しない日付も受理する（2026/2/30 → 2026-02-30。本登録の RPC が INVALID_DATE で拒否する）', async () => {
    const { rows, errors } = await parseCsvFile([customRow({ date: '2026/2/30' })])
    expect(errors).toEqual([])
    expect(rows[0].raw_date).toBe('2026-02-30')
  })
})

describe('テスト間の独立性', () => {
  it('(1) 偽 DB を書き換える', async () => {
    fakeDb.tables.accounts = []
    const { errors } = await parseCsvFile([customRow({})])
    expect(errors.map((e) => e.column)).toEqual(['借方科目', '貸方科目'])
  })

  it('(2) 直前のテストの変更が残っていない', async () => {
    const { rows, errors } = await parseCsvFile([customRow({})])
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
  })
})
