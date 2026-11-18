import type { SupabaseClient } from '@supabase/supabase-js'
import { translateSupabaseError } from './supabase-error-handler'
import { ValidationError, ERROR_CODES } from './errors'
import type { Company } from './company'
import { isIndividualFiscalPeriod } from './company-period'

export type CompanyInput = {
  name: string
  kind: Company['kind']
  taxMethod: Company['tax_method']
  startDate: string
  endDate: string
}

export async function createCompanyWithDb(db: SupabaseClient, input: CompanyInput): Promise<string> {
  const name = input.name.trim()
  if (!name || (input.kind === 'INDIVIDUAL' && !isIndividualFiscalPeriod(input.startDate, input.endDate))) {
    throw new ValidationError('INVALID_COMPANY', !name ? '会社名を入力してください' : '個人の会計期間は同じ年の1月1日から12月31日にしてください')
  }
  const { data, error } = await db.rpc('create_company', {
    p_name: name, p_kind: input.kind, p_tax_method: input.taxMethod,
    p_start_date: input.startDate, p_end_date: input.endDate,
  })
  if (error) throw translateSupabaseError(error)
  if (!data || typeof data.company_id !== 'string') throw new Error('作成した会社のIDを取得できませんでした。会社一覧を再読み込みしてください')
  return data.company_id
}

export async function setCompanyArchivedWithDb(db: SupabaseClient, companyId: string, archived: boolean, cookieId: string | null): Promise<void> {
  if (archived && companyId === cookieId) throw new ValidationError('INVALID_COMPANY', '選択中の会社はアーカイブできません。先に別の会社へ切り替えてください')
  // アーカイブは選択候補を隠すだけでアクセス制御ではない。会社名も引き続き使用中。
  const { data, error } = await db.from('companies').update({ is_archived: archived }).eq('id', companyId).select('id').single()
  if (error) throw translateSupabaseError(error)
  if (!data) throw new ValidationError(ERROR_CODES.INVALID_COMPANY.code, '会社が見つかりません')
}
