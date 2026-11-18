import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  getPlCategoryOptions, getBsCategoryOptions, getCategoryLabel, retainValidCategories,
  TAX_CODE_OPTIONS, taxCodeFromForm, taxCodeToForm, getTaxCodeLabel, type AccountType,
} from '@/lib/account-master-options'

const corporate = {
  REVENUE: [['REVENUE', '営業収益'], ['NON_OP_INCOME', '営業外収益'], ['EXTRA_INCOME', '特別利益']],
  EXPENSE: [['COGS', '売上原価'], ['SGA', '販売費及び一般管理費'], ['NON_OP_EXPENSE', '営業外費用'], ['EXTRA_LOSS', '特別損失'], ['TAX', '法人税等']],
  ASSET: [['CURRENT_ASSETS', '流動資産'], ['FIXED_ASSETS', '固定資産'], ['DEFERRED_ASSETS', '繰延資産']],
  LIABILITY: [['CURRENT_LIABILITIES', '流動負債'], ['FIXED_LIABILITIES', '固定負債']],
  EQUITY: [['EQUITY', '純資産']],
}
const individual = {
  REVENUE: [['REVENUE', '収入金額'], ['RESERVE_REVERSAL', '繰戻額等']],
  EXPENSE: [['COGS', '売上原価'], ['SGA', '経費'], ['RESERVE_PROVISION', '繰入額等']],
  ASSET: [...corporate.ASSET, ['OWNER_DRAWINGS', '事業主貸']],
  LIABILITY: [...corporate.LIABILITY, ['OWNER_CONTRIBUTIONS', '事業主借']],
  EQUITY: [['EQUITY', '元入金']],
}
const types = Object.keys(corporate) as AccountType[]

describe.each(['CORPORATION', 'INDIVIDUAL'] as const)('%sの財務諸表区分', kind => {
  it.each(types)('%sで選べる値・表示名・一覧ラベルが完全に一致する', type => {
    const expected = (kind === 'CORPORATION' ? corporate : individual)[type]
    const isPl = type === 'REVENUE' || type === 'EXPENSE'
    const pl = getPlCategoryOptions(kind, type)
    const bs = getBsCategoryOptions(kind, type)
    expect((isPl ? pl : bs).map(option => [option.value, option.label])).toEqual(expected)
    expect(isPl ? bs : pl).toEqual([])
    for (const [value, label] of expected) {
      expect(getCategoryLabel(kind, type, isPl ? value : null, isPl ? null : value)).toBe(label)
    }
  })
  // 同じPL内・BS内の種別変更でも、旧種別の区分を残さない。
  for (const from of types) for (const to of types) {
    it(`${from}→${to}で新しい種別の区分だけを残す`, () => {
      for (const option of [...getPlCategoryOptions(kind, from), ...getBsCategoryOptions(kind, from)]) {
        const valid = retainValidCategories(kind, to, option.value, option.value)
        expect(valid.pl_category).toBe(getPlCategoryOptions(kind, to).some(item => item.value === option.value) ? option.value : '')
        expect(valid.bs_category).toBe(getBsCategoryOptions(kind, to).some(item => item.value === option.value) ? option.value : '')
      }
    })
  }
})

it('未選択・不正な区分や他社区分を選択済みにしない', () => {
  expect(getPlCategoryOptions('INDIVIDUAL', '')).toEqual([])
  expect(getBsCategoryOptions('CORPORATION', '')).toEqual([])
  expect(retainValidCategories('INDIVIDUAL', 'REVENUE', 'NON_OP_INCOME', 'OWNER_DRAWINGS')).toEqual({ pl_category: '', bs_category: '' })
  expect(retainValidCategories('CORPORATION', 'ASSET', '', 'OWNER_DRAWINGS')).toEqual({ pl_category: '', bs_category: '' })
})

describe('既定の税区分', () => {
  const expected = [
    [null, '設定なし'], ['NONE', '対象外'], ['SALES', '課税売上'], ['SALES_RETURN', '売上返還'],
    ['PURCHASE', '課税仕入'], ['PURCHASE_RETURN', '仕入返還'], ['NON_TAXABLE_SALES', '非課税売上'],
  ] as const
  it('保存値がDB CHECKの6グループ＋NULLだけで、ラベルも一致する', () => {
    expect(TAX_CODE_OPTIONS.map(option => [taxCodeFromForm(option.value), option.label])).toEqual(expected)
    expect(taxCodeFromForm('')).toBeNull()
  })
  it('選択肢の保存値がschema.sqlのCHECK定義とも一致する', () => {
    const schema = readFileSync('supabase/schema.sql', 'utf8')
    const constraint = schema.split('\n').find(line => line.includes('CONSTRAINT accounts_default_tax_code_check'))!
    const checkValues = [...constraint.matchAll(/'([^']+)'::text/g)].map(match => match[1])
    expect(TAX_CODE_OPTIONS.slice(1).map(option => option.value)).toEqual(checkValues)
  })
  it.each(expected)('既存科目の %s をフォームと一覧に表示し、保存しても同じ値になる', (value, label) => {
    expect(taxCodeFromForm(taxCodeToForm(value))).toBe(value)
    expect(getTaxCodeLabel(value)).toBe(label)
  })
  it.each(['課税10%', '課税8%', '非課税', '不課税', '免税', 'OUT_OF_SCOPE'])('旧値・tax_codes.idの %s は保存しない', value => {
    expect(() => taxCodeFromForm(value)).toThrow('既定の税区分')
  })
})
