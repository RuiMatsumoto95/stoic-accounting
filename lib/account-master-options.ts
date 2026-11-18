import type { Company } from './company'

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'
type Option = Readonly<{ value: string; label: string }>

const CORPORATE_PL: Partial<Record<AccountType, readonly Option[]>> = {
  REVENUE: [
    { value: 'REVENUE', label: '営業収益' },
    { value: 'NON_OP_INCOME', label: '営業外収益' },
    { value: 'EXTRA_INCOME', label: '特別利益' },
  ],
  EXPENSE: [
    { value: 'COGS', label: '売上原価' },
    { value: 'SGA', label: '販売費及び一般管理費' },
    { value: 'NON_OP_EXPENSE', label: '営業外費用' },
    { value: 'EXTRA_LOSS', label: '特別損失' },
    { value: 'TAX', label: '法人税等' },
  ],
}

const INDIVIDUAL_PL: Partial<Record<AccountType, readonly Option[]>> = {
  REVENUE: [
    { value: 'REVENUE', label: '収入金額' },
    { value: 'RESERVE_REVERSAL', label: '繰戻額等' },
  ],
  EXPENSE: [
    { value: 'COGS', label: '売上原価' },
    { value: 'SGA', label: '経費' },
    { value: 'RESERVE_PROVISION', label: '繰入額等' },
  ],
}

const CORPORATE_BS: Partial<Record<AccountType, readonly Option[]>> = {
  ASSET: [
    { value: 'CURRENT_ASSETS', label: '流動資産' },
    { value: 'FIXED_ASSETS', label: '固定資産' },
    { value: 'DEFERRED_ASSETS', label: '繰延資産' },
  ],
  LIABILITY: [
    { value: 'CURRENT_LIABILITIES', label: '流動負債' },
    { value: 'FIXED_LIABILITIES', label: '固定負債' },
  ],
  EQUITY: [{ value: 'EQUITY', label: '純資産' }],
}

const INDIVIDUAL_BS: Partial<Record<AccountType, readonly Option[]>> = {
  ASSET: [...CORPORATE_BS.ASSET!, { value: 'OWNER_DRAWINGS', label: '事業主貸' }],
  LIABILITY: [...CORPORATE_BS.LIABILITY!, { value: 'OWNER_CONTRIBUTIONS', label: '事業主借' }],
  EQUITY: [{ value: 'EQUITY', label: '元入金' }],
}

export function getPlCategoryOptions(kind: Company['kind'], type: AccountType | ''): readonly Option[] {
  return (kind === 'INDIVIDUAL' ? INDIVIDUAL_PL : CORPORATE_PL)[type as AccountType] ?? []
}

export function getBsCategoryOptions(kind: Company['kind'], type: AccountType | ''): readonly Option[] {
  return (kind === 'INDIVIDUAL' ? INDIVIDUAL_BS : CORPORATE_BS)[type as AccountType] ?? []
}

export function getCategoryLabel(kind: Company['kind'], type: AccountType, pl: string | null, bs: string | null): string {
  return getPlCategoryOptions(kind, type).find(option => option.value === pl)?.label
    ?? getBsCategoryOptions(kind, type).find(option => option.value === bs)?.label ?? ''
}

// 種別を変えた際は、新しい種別で選択できる区分だけを残す。
export function retainValidCategories(kind: Company['kind'], type: AccountType | '', pl: string, bs: string) {
  return {
    pl_category: getPlCategoryOptions(kind, type).some(option => option.value === pl) ? pl : '',
    bs_category: getBsCategoryOptions(kind, type).some(option => option.value === bs) ? bs : '',
  }
}

// 'none' はフォーム専用。DB の NONE（対象外）とは別の値。
export const TAX_CODE_OPTIONS = [
  { value: 'none', label: '設定なし' },
  { value: 'NONE', label: '対象外' },
  { value: 'SALES', label: '課税売上' },
  { value: 'SALES_RETURN', label: '売上返還' },
  { value: 'PURCHASE', label: '課税仕入' },
  { value: 'PURCHASE_RETURN', label: '仕入返還' },
  { value: 'NON_TAXABLE_SALES', label: '非課税売上' },
] as const

export function taxCodeToForm(value: string | null): string {
  return value ?? 'none'
}

export function taxCodeFromForm(value: string): string | null {
  if (value === '' || value === 'none') return null
  if (!TAX_CODE_OPTIONS.some(option => option.value === value)) throw new Error('既定の税区分を選択してください')
  return value
}

export function getTaxCodeLabel(value: string | null): string {
  return TAX_CODE_OPTIONS.find(option => option.value === taxCodeToForm(value))?.label ?? ''
}
