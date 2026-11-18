import { supabase } from './supabase'
import { assertActiveCompany } from './company-guard'
import { translateSupabaseError } from './supabase-error-handler'

export async function createMappingRule(input: { keyword: string; account_id: string; priority: number }, companyId: string): Promise<void> {
  assertActiveCompany(companyId)
  const { error } = await supabase.from('mapping_rules').insert({ ...input, company_id: companyId })
  if (error) throw translateSupabaseError(error)
}
