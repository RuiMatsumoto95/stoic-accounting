import { supabase } from './supabase'
import { getCompanyIdByPeriod } from './company-scope'
import { ConflictError, ERROR_CODES } from './errors'
import { translateSupabaseError } from './supabase-error-handler'
import { readAllPages } from './report-pagination'

export type ImpactPeriod = { id: string; company_id: string; start_date: string; end_date: string }
export type OpeningSetReference = { company_id: string; period_id: string }

export function hasAutomaticOpeningImpact(companyId: string, periodId: string, periods: readonly ImpactPeriod[], sets: readonly OpeningSetReference[]): boolean {
  const companyPeriods = periods.filter(period => period.company_id === companyId)
  const current = companyPeriods.find(period => period.id === periodId)
  if (!current) return false
  const later = companyPeriods.filter(period => period.start_date > current.start_date)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id))
  const tomorrow = new Date(`${current.end_date}T00:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const next = later.find(period => period.start_date === tomorrow.toISOString().slice(0, 10)) ?? later[0]
  return !!next && !sets.some(set => set.company_id === companyId && set.period_id === next.id)
}

export async function fetchAutomaticOpeningImpact(companyId: string, periodId: string): Promise<boolean> {
  if (companyId !== await getCompanyIdByPeriod(periodId)) throw new ConflictError(ERROR_CODES.COMPANY_MISMATCH.code, ERROR_CODES.COMPANY_MISMATCH.message)
  const [periods, sets] = await Promise.all([
    readAllPages<ImpactPeriod>(async (from, to) => {
      const result = await supabase.from('fiscal_periods').select('id, company_id, start_date, end_date').eq('company_id', companyId).order('start_date').order('id').range(from, to)
      if (result.error) throw translateSupabaseError(result.error)
      return result
    }),
    readAllPages<OpeningSetReference>(async (from, to) => {
      const result = await supabase.from('period_opening_balance_sets').select('company_id, period_id').eq('company_id', companyId).order('period_id').range(from, to)
      if (result.error) throw translateSupabaseError(result.error)
      return result
    }),
  ])
  return hasAutomaticOpeningImpact(companyId, periodId, periods, sets)
}
