import { describe, expect, it } from 'vitest'
import { resolveYayoiTaxCode } from '@/lib/yayoi-tax'
import type { TaxMethod } from '@/lib/tax-codes'

// 弥生の実際の出力（実サンプル）と、弥生公式の税区分一覧にある表記を対象にする。
// 移し先の ID は tax_codes（2026-11-02 時点のマスタ）にあるもの。

describe('resolveYayoiTaxCode: 事業者タイプに関係なく決まる区分', () => {
  it.each<[string, string]>([
    ['対象外', 'OUT_OF_SCOPE'],
    ['非課税売上', 'NON_TAXABLE_SALES'],
    ['非課売上', 'NON_TAXABLE_SALES'],
    ['非課税仕入', 'NON_TAXABLE_PURCHASE'],
    ['非課仕入', 'NON_TAXABLE_PURCHASE'],
    ['輸出売上', 'EXPORT_SALES'],
    ['対外売上', 'OUT_OF_SCOPE_SALES'],
    ['対象外仕入', 'OUT_OF_SCOPE_PURCHASE'],
  ])('「%s」 → %s', (text, expected) => {
    for (const method of ['EXEMPT', 'SIMPLE', 'STANDARD_INDIVIDUAL', 'STANDARD_PROPORTIONAL'] as TaxMethod[]) {
      expect(resolveYayoiTaxCode(text, method)).toEqual({ id: expected })
    }
  })

  it('空欄は null（警告なし）', () => {
    expect(resolveYayoiTaxCode('', 'SIMPLE')).toEqual({ id: null })
    expect(resolveYayoiTaxCode('  ', 'SIMPLE')).toEqual({ id: null })
  })
})

describe('resolveYayoiTaxCode: 本則課税', () => {
  it.each<[TaxMethod, string, string]>([
    // 実サンプルの表記（「適格」つき）
    ['STANDARD_PROPORTIONAL', '課対仕入込10%適格', 'PROP_PURCHASE_10'],
    ['STANDARD_INDIVIDUAL', '課対仕入込10%適格', 'INDIV_PURCHASE_TAXABLE_10'],
    ['STANDARD_PROPORTIONAL', '課対仕入内軽減8%', 'PROP_PURCHASE_8K'],
    ['STANDARD_INDIVIDUAL', '課対仕入込軽減8%', 'INDIV_PURCHASE_TAXABLE_8K'],
    ['STANDARD_PROPORTIONAL', '課税売上込10%', 'PROP_SALES_10'],
    ['STANDARD_INDIVIDUAL', '課税売上内軽減8%', 'INDIV_SALES_8K'],
    ['STANDARD_PROPORTIONAL', '課対仕返込10%', 'PROP_PURCHASE_RETURN_10'],
    ['STANDARD_INDIVIDUAL', '課対仕返内軽減8%', 'INDIV_PURCHASE_TAXABLE_RETURN_8K'],
    ['STANDARD_PROPORTIONAL', '課税売返込10%', 'PROP_SALES_RETURN_10'],
    ['STANDARD_INDIVIDUAL', '課税売返内軽減8%', 'INDIV_SALES_RETURN_8K'],
    // 個別対応方式にだけある区分
    ['STANDARD_INDIVIDUAL', '非対仕入込10%', 'INDIV_PURCHASE_NONTAXABLE_10'],
    ['STANDARD_INDIVIDUAL', '非対仕返込軽減8%', 'INDIV_PURCHASE_NONTAXABLE_RETURN_8K'],
    ['STANDARD_INDIVIDUAL', '共対仕入込10%', 'INDIV_PURCHASE_COMMON_10'],
    ['STANDARD_INDIVIDUAL', '共対仕返込軽減8%', 'INDIV_PURCHASE_COMMON_RETURN_8K'],
  ])('事業者タイプ %s: 「%s」 → %s', (method, text, expected) => {
    expect(resolveYayoiTaxCode(text, method)).toEqual({ id: expected })
  })

  it('旧表記（課税仕入・課税売上8%軽・全角）も同じ区分に変換する', () => {
    expect(resolveYayoiTaxCode('課税仕入', 'STANDARD_PROPORTIONAL')).toEqual({ id: 'PROP_PURCHASE_10' })
    expect(resolveYayoiTaxCode('課税仕入１０％', 'STANDARD_PROPORTIONAL')).toEqual({ id: 'PROP_PURCHASE_10' })
    expect(resolveYayoiTaxCode('課税売上8%軽', 'STANDARD_PROPORTIONAL')).toEqual({ id: 'PROP_SALES_8K' })
    expect(resolveYayoiTaxCode('課税売上8%軽減', 'SIMPLE')).toEqual({ id: 'SIMPLE_SALES_8K' })
    expect(resolveYayoiTaxCode('課税対応仕入8%（軽）', 'STANDARD_INDIVIDUAL')).toEqual({ id: 'INDIV_PURCHASE_TAXABLE_8K' })
  })
})

describe('resolveYayoiTaxCode: 簡易課税', () => {
  it.each<[string, string]>([
    // 実サンプル（簡易課税）の表記
    ['課税売上込五10%', 'SIMPLE_S5_10'],
    ['課税売上込一軽減8%', 'SIMPLE_S1_8K'],
    ['課税売上内六10%', 'SIMPLE_S6_10'],
    // 事業区分のない表記は区分なしの簡易課税売上
    ['課税売上込10%', 'SIMPLE_SALES_10'],
    ['課税売上込軽減8%', 'SIMPLE_SALES_8K'],
    // 返還は区分別のコードが無いため、事業区分を見ない
    ['課税売返込三10%', 'SIMPLE_SALES_RETURN_10'],
    ['課税売返込軽減8%', 'SIMPLE_SALES_RETURN_8K'],
  ])('「%s」 → %s', (text, expected) => {
    expect(resolveYayoiTaxCode(text, 'SIMPLE')).toEqual({ id: expected })
  })

  it('仕入は、tax_codes に簡易課税用の区分が無いため警告なしで空にする', () => {
    for (const text of ['課対仕入込10%適格', '課対仕返込10%', '非対仕入込10%', '共対仕入込軽減8%']) {
      expect(resolveYayoiTaxCode(text, 'SIMPLE')).toEqual({ id: null })
    }
  })
})

describe('resolveYayoiTaxCode: 対応づけられない場合は「対象外」で登録し、警告を返す', () => {
  it('未知の表記', () => {
    expect(resolveYayoiTaxCode('謎区分', 'STANDARD_PROPORTIONAL')).toEqual({
      id: 'OUT_OF_SCOPE',
      warning: '税区分「謎区分」に対応する区分が見つからないため「対象外」で登録しました',
    })
  })

  it.each(['課税売上込8%', '課税売上込5%', '課対仕入込8%', '貸倒', '不明', '有価譲渡', '課対輸本7.8%'])(
    'DB に無い税率・区分「%s」',
    (text) => {
      const r = resolveYayoiTaxCode(text, 'STANDARD_PROPORTIONAL')
      expect(r.id).toBe('OUT_OF_SCOPE')
      expect(r.warning).toContain('対象外')
    },
  )

  it('一覧にない接尾辞が付くと対応づけられない（「適格」だけ除く）', () => {
    expect(resolveYayoiTaxCode('課対仕入込10%適格', 'STANDARD_PROPORTIONAL').warning).toBeUndefined()
    expect(resolveYayoiTaxCode('課対仕入込10%控80', 'STANDARD_PROPORTIONAL').id).toBe('OUT_OF_SCOPE')
  })

  it('免税事業者の課税区分、本則（一括比例）の非課税対応・共通対応', () => {
    expect(resolveYayoiTaxCode('課対仕入込10%', 'EXEMPT')).toMatchObject({ id: 'OUT_OF_SCOPE' })
    expect(resolveYayoiTaxCode('課税売上込10%', 'EXEMPT').warning).toContain('事業者タイプ')
    expect(resolveYayoiTaxCode('非対仕入込10%', 'STANDARD_PROPORTIONAL')).toMatchObject({ id: 'OUT_OF_SCOPE' })
    expect(resolveYayoiTaxCode('共対仕入込10%', 'STANDARD_PROPORTIONAL').warning).toContain('事業者タイプ')
  })
})

describe('resolveYayoiTaxCode: 外税・別記', () => {
  it.each(['課対仕入外10%', '課対仕入別10%'])('「%s」は区分を対応づけたうえで警告を返す', (text) => {
    const r = resolveYayoiTaxCode(text, 'STANDARD_PROPORTIONAL')
    expect(r.id).toBe('PROP_PURCHASE_10')
    expect(r.warning).toContain('外税・別記')
  })

  it('内税・込税には警告を付けない', () => {
    expect(resolveYayoiTaxCode('課対仕入内10%', 'STANDARD_PROPORTIONAL').warning).toBeUndefined()
    expect(resolveYayoiTaxCode('課対仕入込10%', 'STANDARD_PROPORTIONAL').warning).toBeUndefined()
  })
})
