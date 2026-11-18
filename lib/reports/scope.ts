import { supabase } from '@/lib/supabase'
import { getCompanyIdByPeriod } from '@/lib/company-scope'
import { ERROR_CODES, NotFoundError, ValidationError, isAppError } from '@/lib/errors'
import type { Company } from '@/lib/company'

/** 取得済みの所属情報だけで判断し、cookie や URL の会社指定は使わない。 */
export function assertSameReportCompany(companyId: string, otherCompanyId: string): void {
  if (companyId !== otherCompanyId) {
    throw new ValidationError(ERROR_CODES.COMPANY_MISMATCH.code, ERROR_CODES.COMPANY_MISMATCH.message)
  }
}

export function assertReportAccount(companyId: string, account: { company_id: string } | null): void {
  if (!account || account.company_id !== companyId) {
    throw new NotFoundError(ERROR_CODES.ACCOUNT_NOT_FOUND.code, ERROR_CODES.ACCOUNT_NOT_FOUND.message)
  }
}

export async function validateComparisonPeriod(periodId: string, prevPeriodId: string | null): Promise<string> {
  const companyId = await getCompanyIdByPeriod(periodId)
  if (prevPeriodId) assertSameReportCompany(companyId, await getCompanyIdByPeriod(prevPeriodId))
  return companyId
}

export async function getReportPeriod(periodId: string) {
  const { data, error } = await supabase.from('fiscal_periods')
    .select('id, company_id, name, start_date, end_date').eq('id', periodId).single()
  if (error && error.code !== 'PGRST116') throw error
  if (!data) throw new NotFoundError(ERROR_CODES.PERIOD_NOT_FOUND.code, ERROR_CODES.PERIOD_NOT_FOUND.message)
  return data as { id: string; company_id: string; name: string; start_date: string; end_date: string }
}

export async function getReportCompanyKind(companyId: string): Promise<Company['kind']> {
  const { data, error } = await supabase.from('companies').select('kind').eq('id', companyId).single()
  if (error) throw error
  if (data?.kind !== 'INDIVIDUAL' && data?.kind !== 'CORPORATION') throw new Error('会社の区分を取得できませんでした')
  return data.kind
}

export async function validateReportAccount(periodId: string, accountId: string) {
  const companyId = await getCompanyIdByPeriod(periodId)
  const { data, error } = await supabase.from('accounts').select('company_id').eq('id', accountId).eq('company_id', companyId).single()
  if (error && error.code !== 'PGRST116') throw error
  assertReportAccount(companyId, data)
}

export function reportErrorStatus(error: unknown): number {
  return isAppError(error) ? error.httpStatus : 500
}
