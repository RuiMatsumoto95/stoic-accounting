import { assertActiveCompany } from './company-guard'
import { supabase } from '@/lib/supabase'

export type TaxCode = {
  id: string
  name: string
  short_name: string | null
  tax_type: 'SALES' | 'PURCHASE' | 'BOTH' | 'NONE'
  rate: number | null
  applies_to: string[]
  is_current: boolean
  sort_order: number
}

export type TaxMethod = 'EXEMPT' | 'SIMPLE' | 'STANDARD_INDIVIDUAL' | 'STANDARD_PROPORTIONAL'

export const TAX_METHOD_LABELS: Record<TaxMethod, string> = {
  EXEMPT: '免税事業者',
  SIMPLE: '簡易課税事業者',
  STANDARD_INDIVIDUAL: '本則課税（個別対応方式）',
  STANDARD_PROPORTIONAL: '本則課税（一括比例配分方式）',
}

export async function getTaxMethod(companyId: string): Promise<TaxMethod> {
  const { data, error } = await supabase
    .from('companies')
    .select('tax_method')
    .eq('id', companyId)
    .single()

  if (error || !data) return 'EXEMPT'
  return (data.tax_method as TaxMethod) ?? 'EXEMPT'
}

export async function getAllTaxCodes(): Promise<TaxCode[]> {
  const { data, error } = await supabase
    .from('tax_codes')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as TaxCode[]
}

export function filterTaxCodes(
  allCodes: TaxCode[],
  method: TaxMethod,
  side?: 'SALES' | 'PURCHASE' | 'BOTH',
  includeLegacy = false
): TaxCode[] {
  return allCodes
    .filter((code) => {
      if (!includeLegacy && !code.is_current) return false
      const appliesToAll = code.applies_to.includes('ALL')
      if (!appliesToAll && !code.applies_to.includes(method)) return false
      if (side !== undefined) {
        if (code.tax_type !== 'BOTH' && code.tax_type !== side) return false
      }
      return true
    })
    .sort((a, b) => a.sort_order - b.sort_order)
}

export async function updateTaxMethod(companyId: string, method: TaxMethod): Promise<void> {
  assertActiveCompany(companyId)
  const { data, error } = await supabase
    .from('companies')
    .update({ tax_method: method })
    .eq('id', companyId)
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('会社が見つかりません')
}
