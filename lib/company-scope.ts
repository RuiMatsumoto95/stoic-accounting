import { supabase } from './supabase'
import { ERROR_CODES, NotFoundError } from './errors'

// 帳票は cookie ではなく対象の期から会社を確定する。会社IDの cookie は認可ではない。
export async function getCompanyIdByPeriod(periodId: string): Promise<string> {
  const { data, error } = await supabase.from('fiscal_periods').select('company_id').eq('id', periodId).single()
  if (error?.code === 'PGRST116') throw new NotFoundError(ERROR_CODES.PERIOD_NOT_FOUND.code, ERROR_CODES.PERIOD_NOT_FOUND.message)
  if (error) throw error
  if (!data?.company_id) throw new NotFoundError(ERROR_CODES.PERIOD_NOT_FOUND.code, ERROR_CODES.PERIOD_NOT_FOUND.message)
  return data.company_id as string
}

export async function getCompanyIdByEntry(entryId: string): Promise<string> {
  const { data, error } = await supabase.from('journal_entries').select('company_id').eq('id', entryId).single()
  if (error?.code === 'PGRST116') throw new NotFoundError(ERROR_CODES.ENTRY_NOT_FOUND.code, ERROR_CODES.ENTRY_NOT_FOUND.message)
  if (error) throw error
  if (!data?.company_id) throw new NotFoundError(ERROR_CODES.ENTRY_NOT_FOUND.code, ERROR_CODES.ENTRY_NOT_FOUND.message)
  return data.company_id as string
}
