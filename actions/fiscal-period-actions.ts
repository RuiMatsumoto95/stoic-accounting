'use server'
import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { assertServerCompany } from '@/lib/company-server'
import { isAppError } from '@/lib/errors'
import { createPeriodForCompany, deletePeriodForCompany, setCurrentPeriodForCompany, updatePeriodForCompany, type PeriodResult } from '@/lib/fiscal-period-operations'

// 既存の独立クライアントを維持。すべての操作は下の照合を経て会社内に限定する。
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

async function run(companyId: string, operation: () => Promise<PeriodResult>): Promise<PeriodResult> {
  try {
    await assertServerCompany(companyId)
    const result = await operation()
    if (!result.error) revalidatePath('/settings')
    return result
  } catch (error) {
    return { error: error instanceof Error ? error.message : '会計期間の操作に失敗しました', code: isAppError(error) ? error.code : undefined }
  }
}

export async function setCurrentPeriod(companyId: string, id: string): Promise<PeriodResult> {
  return run(companyId, () => setCurrentPeriodForCompany(supabase, companyId, id))
}

export async function createPeriod(companyId: string, data: { name: string; start_date: string; end_date: string }): Promise<PeriodResult> {
  return run(companyId, () => createPeriodForCompany(supabase, companyId, data))
}

export async function updatePeriod(companyId: string, id: string, data: { name: string; start_date: string; end_date: string }): Promise<PeriodResult> {
  return run(companyId, () => updatePeriodForCompany(supabase, companyId, id, data))
}

export async function deletePeriod(companyId: string, id: string): Promise<PeriodResult> {
  return run(companyId, () => deletePeriodForCompany(supabase, companyId, id))
}
