'use server'

import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'
import { COMPANY_COOKIE_NAME, COMPANY_COOKIE_OPTIONS } from '@/lib/company-cookie'
import { getCompanyCookieId, assertServerCompany } from '@/lib/company-server'
import { createCompanyWithDb, setCompanyArchivedWithDb, type CompanyInput } from '@/lib/company-operations'
import { isAppError } from '@/lib/errors'

export async function setActiveCompany(companyId: string): Promise<void> {
  const { data, error } = await supabase.from('companies').select('id, is_archived').eq('id', companyId).single()
  if (error || !data) throw new Error('会社が見つかりません')
  if (data.is_archived) throw new Error('アーカイブ済みの会社は選択できません。設定または会社の選択画面で戻してください')
  // 会社IDは秘密ではない。この cookie はアクセス制御には使わない。
  ;(await cookies()).set(COMPANY_COOKIE_NAME, companyId, COMPANY_COOKIE_OPTIONS)
}

// 利用者向けエラーは返り値にする（本番の Server Action は例外の詳細を隠すため）。
type CompanyActionResult = { companyId?: string; error?: string; code?: string }
function failure(error: unknown): CompanyActionResult {
  return { error: error instanceof Error ? error.message : '会社の操作に失敗しました', code: isAppError(error) ? error.code : undefined }
}

export async function trySetActiveCompany(companyId: string): Promise<CompanyActionResult> {
  try {
    await setActiveCompany(companyId)
    return {}
  } catch (error) { return failure(error) }
}

export async function createCompany(input: CompanyInput, expectedCompanyId?: string): Promise<CompanyActionResult> {
  try {
    if (expectedCompanyId) await assertServerCompany(expectedCompanyId)
    return { companyId: await createCompanyWithDb(supabase, input) }
  } catch (error) { return failure(error) }
}

export async function archiveCompany(companyId: string): Promise<CompanyActionResult> {
  try {
    await setCompanyArchivedWithDb(supabase, companyId, true, await getCompanyCookieId())
    return {}
  } catch (error) { return failure(error) }
}

export async function unarchiveCompany(companyId: string): Promise<CompanyActionResult> {
  try {
    await setCompanyArchivedWithDb(supabase, companyId, false, await getCompanyCookieId())
    return {}
  } catch (error) { return failure(error) }
}
