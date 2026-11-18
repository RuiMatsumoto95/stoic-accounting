import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', async () => {
  const { fakeSupabase } = await import('@/__tests__/helpers/fake-supabase')
  return { supabase: fakeSupabase }
})

import { parseYayoiCsvFile } from '@/lib/csv-import-yayoi'
import { ID, resetFakeDb, setTaxMethod, yayoiRow } from '@/__tests__/helpers/fake-supabase'
import type { TaxMethod } from '@/lib/tax-codes'
import { registerActiveCompany } from '@/lib/company-guard'

beforeEach(() => {
  resetFakeDb()
  registerActiveCompany('fixture-company')
})
afterEach(() => registerActiveCompany(null))

// 弥生の出力 CSV には見出し行がないため、行番号は先頭のデータ行を 1 行目として数える（第2引数で起点を変えられる）
describe('parseYayoiCsvFile: 正常系（識別フラグ 2000）', () => {
  it('弥生の列位置（D/E/F/H/I/K/L/N/O/Q）から読み取る', async () => {
    const { rows, errors, warnings } = await parseYayoiCsvFile([
      yayoiRow({
        date: '2026/4/1',
        debit: '消耗品費',
        debitTax: '課税仕入',
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
        raw_debit_tax_code: '課税仕入',
        raw_debit_amount: 1100,
        raw_credit_account: '現金',
        raw_credit_sub_account: '',
        raw_credit_tax_code: '',
        raw_credit_amount: 1100,
        raw_description: '文具',
        predicted_account_id: ID.supplies,
        debit_sub_account_id: null,
        debit_tax_code_id: 'PROP_PURCHASE_10',
        counter_account_id: ID.cash,
        credit_sub_account_id: null,
        credit_tax_code_id: null,
        parse_warnings: [],
        is_processed: false,
      },
    ])
  })

  it('補助科目・エイリアス・置換ルールを解決する', async () => {
    const { rows, errors } = await parseYayoiCsvFile([
      yayoiRow({ debit: '普通預金', debitSub: 'A銀行', credit: 'ｱﾏｿﾞﾝ' }),
      yayoiRow({ debit: 'ふつうよきん', debitSub: 'あ銀', credit: 'ショウモウヒン' }),
    ])
    expect(errors).toEqual([])
    expect(rows.map((r) => [r.predicted_account_id, r.debit_sub_account_id, r.counter_account_id])).toEqual([
      [ID.bank, ID.bankA, ID.supplies],
      [ID.bank, ID.bankA, ID.supplies],
    ])
  })

  it('識別フラグの前後の空白は無視する', async () => {
    const { rows } = await parseYayoiCsvFile([yayoiRow({ flag: ' 2000 ' })])
    expect(rows).toHaveLength(1)
  })

  it('[現行挙動] 摘要は trim のみ（独自形式のように内部の空白は正規化しない）', async () => {
    const { rows } = await parseYayoiCsvFile([yayoiRow({ description: '　文具　　購入  ' })])
    expect(rows[0].raw_description).toBe('文具　　購入')
  })

  it('空の入力は何も返さない', async () => {
    expect(await parseYayoiCsvFile([])).toEqual({ rows: [], errors: [], warnings: [] })
  })
})

describe('parseYayoiCsvFile: 実際の出力形式（25列・和暦）と行番号', () => {
  it('25列の行（末尾の列が無い）と和暦の日付を読める', async () => {
    const data = [
      yayoiRow({ date: 'R.08/04/01', debit: '現金', credit: '売上高', debitTax: '対象外', creditTax: '対象外', description: '1月売上入金' }),
      yayoiRow({ flag: '2110', date: 'R.08/04/01' }),
      yayoiRow({ flag: '2101', date: 'R.08/04/01' }),
      yayoiRow({ date: 'R.08/04/01', debit: '消耗品費', credit: '普通預金', creditSub: 'A銀行', description: '事務用品購入' }),
    ].map((r) => r.slice(0, 25))
    expect(data[0]).toHaveLength(25)

    const { rows, errors, warnings } = await parseYayoiCsvFile(data)
    expect(errors).toEqual([])
    expect(rows.map((r) => [r.raw_date, r.raw_description, r.debit_tax_code_id])).toEqual([
      ['2026-04-01', '1月売上入金', 'OUT_OF_SCOPE'],
      ['2026-04-01', '事務用品購入', null],
    ])
    expect(warnings.map((w) => w.row)).toEqual([2, 3])
  })

  it('第2引数で行番号の起点を変えられる（見出し行を除いて渡す場合は 2）', async () => {
    const { errors } = await parseYayoiCsvFile([yayoiRow({ date: '不正' })], 2)
    expect(errors.map((e) => e.row)).toEqual([2])
  })
})

describe('parseYayoiCsvFile: 複合仕訳', () => {
  it.each(['2110', '2100', '2101'])('識別フラグ %s は警告を出してスキップする（行番号つき）', async (flag) => {
    const { rows, errors, warnings } = await parseYayoiCsvFile([yayoiRow({}), yayoiRow({ flag })])
    expect(rows).toHaveLength(1)
    expect(errors).toEqual([])
    expect(warnings).toEqual([{ row: 2, message: '複合仕訳のためスキップしました' }])
  })
})

describe('parseYayoiCsvFile: 税区分の変換', () => {
  it.each<[TaxMethod, string, string | null]>([
    ['STANDARD_PROPORTIONAL', '課税仕入', 'PROP_PURCHASE_10'],
    ['STANDARD_INDIVIDUAL', '課税仕入', 'INDIV_PURCHASE_TAXABLE_10'],
    ['STANDARD_PROPORTIONAL', '課税仕入8%軽', 'PROP_PURCHASE_8K'],
    ['STANDARD_PROPORTIONAL', '課税売上', 'PROP_SALES_10'],
    ['SIMPLE', '課税売上', 'SIMPLE_SALES_10'],
    ['SIMPLE', '課税売上8%軽減', 'SIMPLE_SALES_8K'],
    ['EXEMPT', '非課税仕入', 'NON_TAXABLE_PURCHASE'],
    ['EXEMPT', '対象外', 'OUT_OF_SCOPE'],
    // 全角・半角の表記ゆれは正規化して照合する
    ['STANDARD_PROPORTIONAL', '課税仕入１０％', 'PROP_PURCHASE_10'],
  ])('事業者タイプ %s: 「%s」 → %s', async (method, text, expected) => {
    setTaxMethod(method)
    const { rows, warnings } = await parseYayoiCsvFile([yayoiRow({ debitTax: text })])
    expect(warnings).toEqual([])
    expect(rows[0].debit_tax_code_id).toBe(expected)
  })

  // 簡易課税の tax_codes には仕入側の区分が無いため、仕入は警告なしで空にする
  it('簡易課税の「課税仕入」は、警告なしで税区分を空にする', async () => {
    setTaxMethod('SIMPLE')
    const { rows, warnings } = await parseYayoiCsvFile([yayoiRow({ debitTax: '課税仕入', creditTax: '課税仕入8%軽' })])
    expect(warnings).toEqual([])
    expect([rows[0].debit_tax_code_id, rows[0].credit_tax_code_id]).toEqual([null, null])
  })

  it('事業者タイプが取得できなければ免税事業者（EXEMPT）として扱う', async () => {
    setTaxMethod(null)
    const { rows, warnings } = await parseYayoiCsvFile([yayoiRow({ debitTax: '課税仕入' })])
    expect(rows[0].debit_tax_code_id).toBe('OUT_OF_SCOPE')
    expect(warnings).toHaveLength(1)
  })

  it('空欄は警告なしで null', async () => {
    const { rows, warnings } = await parseYayoiCsvFile([yayoiRow({ debitTax: '', creditTax: '' })])
    expect(warnings).toEqual([])
    expect([rows[0].debit_tax_code_id, rows[0].credit_tax_code_id]).toEqual([null, null])
    expect(rows[0].parse_warnings).toEqual([])
  })

  it('特定できない税区分は「対象外」で登録し、warnings と parse_warnings の両方に残す', async () => {
    const { rows, errors, warnings } = await parseYayoiCsvFile([
      yayoiRow({ debitTax: '謎区分', creditTax: '別の謎' }),
    ])
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
    expect([rows[0].debit_tax_code_id, rows[0].credit_tax_code_id]).toEqual(['OUT_OF_SCOPE', 'OUT_OF_SCOPE'])
    expect(warnings).toEqual([
      { row: 1, column: '借方税区分', value: '謎区分', message: '税区分「謎区分」に対応する区分が見つからないため「対象外」で登録しました' },
      { row: 1, column: '貸方税区分', value: '別の謎', message: '税区分「別の謎」に対応する区分が見つからないため「対象外」で登録しました' },
    ])
    expect(rows[0].parse_warnings).toEqual([
      '借方税区分「謎区分」：税区分「謎区分」に対応する区分が見つからないため「対象外」で登録しました',
      '貸方税区分「別の謎」：税区分「別の謎」に対応する区分が見つからないため「対象外」で登録しました',
    ])
  })

  it('事業者タイプに対応する区分が無い税区分（免税事業者の「課税仕入」）も「対象外」で登録し、警告を残す', async () => {
    setTaxMethod('EXEMPT')
    const { rows, warnings } = await parseYayoiCsvFile([yayoiRow({ debitTax: '課税仕入' })])
    expect(rows[0].debit_tax_code_id).toBe('OUT_OF_SCOPE')
    expect(warnings.map((w) => w.column)).toEqual(['借方税区分'])
  })
})

describe('parseYayoiCsvFile: エラー', () => {
  it.each<[string, string[], string, string]>([
    ['日付', yayoiRow({ date: '2026.4.1' }), '取引日付', '日付の形式が正しくありません'],
    ['借方科目が空', yayoiRow({ debit: '' }), '借方勘定科目', '借方科目が空です'],
    ['貸方科目が空', yayoiRow({ credit: '' }), '貸方勘定科目', '貸方科目が空です'],
    ['借方科目が未登録', yayoiRow({ debit: '謎' }), '借方勘定科目', '科目が見つかりません。置換ルールを登録してください。'],
    ['貸方科目が未登録', yayoiRow({ credit: '謎' }), '貸方勘定科目', '科目が見つかりません。置換ルールを登録してください。'],
    ['借方補助科目が未登録', yayoiRow({ debit: '普通預金', debitSub: 'Z銀行' }), '借方補助科目', '補助科目が見つかりません'],
    ['貸方補助科目が未登録', yayoiRow({ credit: '普通預金', creditSub: 'Z銀行' }), '貸方補助科目', '補助科目が見つかりません'],
  ])('%s', async (_label, row, column, message) => {
    const { rows, errors } = await parseYayoiCsvFile([row])
    expect(rows).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ row: 1, column, message })
  })

  it('金額は parseCsvAmount の判定とメッセージをそのまま返す', async () => {
    const { errors } = await parseYayoiCsvFile([yayoiRow({ debitAmount: '0x10', creditAmount: '100.004' })])
    expect(errors).toEqual([
      {
        row: 1,
        column: '借方金額',
        value: '0x10',
        message: '金額の形式が正しくありません（半角数字のみ・13桁まで）',
      },
      {
        row: 1,
        column: '貸方金額',
        value: '100.004',
        message: '小数点以下は指定できません（整数円のみ）',
      },
    ])
  })

  it('借方・貸方がともに 0 ならエラー', async () => {
    const { errors } = await parseYayoiCsvFile([yayoiRow({ debitAmount: '0', creditAmount: '' })])
    expect(errors).toEqual([
      {
        row: 1,
        column: '借方金額',
        value: '0',
        message: '借方金額・貸方金額のどちらかに0より大きい値が必要です',
      },
    ])
  })

  it('正常行・複合仕訳・異常行が混在しても、行ごとに独立して判定する', async () => {
    const { rows, errors, warnings } = await parseYayoiCsvFile([
      yayoiRow({ description: '1' }),
      yayoiRow({ flag: '2110' }),
      yayoiRow({ date: '不正', description: '3' }),
      yayoiRow({ description: '4' }),
    ])
    expect(rows.map((r) => r.raw_description)).toEqual(['1', '4'])
    expect(errors.map((e) => [e.row, e.column])).toEqual([[3, '取引日付']])
    expect(warnings).toEqual([{ row: 2, message: '複合仕訳のためスキップしました' }])
  })
})

describe('parseYayoiCsvFile: 識別フラグの扱い', () => {
  it('2111（1行の伝票データ）は、2000 と同じ列構成で取り込む', async () => {
    const { rows, errors, warnings } = await parseYayoiCsvFile([
      yayoiRow({ flag: '2111', debit: '消耗品費', credit: '現金', debitAmount: '33', creditAmount: '33', description: '伝票テスト' }),
    ])
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(rows.map((r) => [r.raw_debit_account, r.raw_credit_account, r.raw_debit_amount, r.raw_description])).toEqual([
      ['消耗品費', '現金', 33, '伝票テスト'],
    ])
  })

  it('未知の識別フラグは、行番号つきの警告を出してスキップする', async () => {
    const { rows, errors, warnings } = await parseYayoiCsvFile([
      yayoiRow({ flag: '9999' }),
      yayoiRow({ flag: '' }),
      yayoiRow({ flag: '識別フラグ' }),
    ])
    expect([rows, errors]).toEqual([[], []])
    expect(warnings).toEqual([
      { row: 1, column: '識別フラグ', value: '9999', message: '未対応の識別フラグのためスキップしました' },
      { row: 2, column: '識別フラグ', value: '', message: '未対応の識別フラグのためスキップしました' },
      { row: 3, column: '識別フラグ', value: '識別フラグ', message: '未対応の識別フラグのためスキップしました' },
    ])
  })

  it('取り込める行（2000・2111）と無視した行が混在しても、無視した行は警告で分かる', async () => {
    const { rows, errors, warnings } = await parseYayoiCsvFile([
      yayoiRow({ description: '1' }),
      yayoiRow({ flag: '2111', description: '2' }),
      yayoiRow({ flag: '9999', description: '3' }),
      yayoiRow({ description: '4' }),
    ])
    expect(rows.map((r) => r.raw_description)).toEqual(['1', '2', '4'])
    expect(errors).toEqual([])
    expect(warnings.map((w) => [w.row, w.value])).toEqual([[3, '9999']])
  })

  it('和暦の日付（R.08/04/01）を西暦に変換する', async () => {
    const { rows, errors } = await parseYayoiCsvFile([yayoiRow({ date: 'R.08/04/01' })])
    expect(errors).toEqual([])
    expect(rows[0].raw_date).toBe('2026-04-01')
  })

  it('暦として存在しない日付も受理する（2026/2/30 → 2026-02-30。本登録の RPC が拒否する）', async () => {
    const { rows, errors } = await parseYayoiCsvFile([yayoiRow({ date: '2026/2/30' })])
    expect(errors).toEqual([])
    expect(rows[0].raw_date).toBe('2026-02-30')
  })

  it('借方と貸方の金額が違っても受理する（借貸一致は本登録の RPC が拒否する）', async () => {
    const { rows, errors } = await parseYayoiCsvFile([yayoiRow({ debitAmount: '1000', creditAmount: '2000' })])
    expect(errors).toEqual([])
    expect([rows[0].raw_debit_amount, rows[0].raw_credit_amount]).toEqual([1000, 2000])
  })
})

describe('テスト間の独立性', () => {
  it('(1) 事業者タイプを変更する', async () => {
    setTaxMethod('STANDARD_INDIVIDUAL')
    const { rows } = await parseYayoiCsvFile([yayoiRow({ debitTax: '課税仕入' })])
    expect(rows[0].debit_tax_code_id).toBe('INDIV_PURCHASE_TAXABLE_10')
  })

  it('(2) 直前のテストの変更が残っていない（初期値は STANDARD_PROPORTIONAL）', async () => {
    const { rows } = await parseYayoiCsvFile([yayoiRow({ debitTax: '課税仕入' })])
    expect(rows[0].debit_tax_code_id).toBe('PROP_PURCHASE_10')
  })
})
