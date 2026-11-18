import type { SupabaseClient } from '@supabase/supabase-js'
import { translateSupabaseError } from './supabase-error-handler'
import { isIndividualFiscalPeriod } from './company-period'
import { ERROR_CODES, NotFoundError } from './errors'
import { assertActiveCompany } from './company-guard'

export type PeriodResult = { error?: string; code?: string }
type PeriodInput = { name: string; start_date: string; end_date: string }

export type PeriodCloseCheck = { closed: boolean; errors: string[]; warnings: string[] }
export type PeriodCloseResult = { period_id: string; closed_at: string; warnings: string[] }
export type PeriodReopenResult = { period_id: string; closed_at: null }

async function periodRpc<T>(db: SupabaseClient, companyId: string, id: string, name: string, args: Record<string, string | null>): Promise<T> {
  assertActiveCompany(companyId)
  const { data: period, error: readError } = await db.from('fiscal_periods').select('id').eq('company_id', companyId).eq('id', id).single()
  if (readError && readError.code !== 'PGRST116') throw translateSupabaseError(readError)
  if (!period) throw new NotFoundError(ERROR_CODES.PERIOD_NOT_FOUND.code, ERROR_CODES.PERIOD_NOT_FOUND.message)
  assertActiveCompany(companyId)
  const { data, error } = await db.rpc(name, args)
  if (error) throw translateSupabaseError(error)
  if (data === null) throw new Error('会計期間の操作結果を取得できませんでした。再読み込みしてください')
  return data as T
}

export function getPeriodCloseCheck(db: SupabaseClient, companyId: string, id: string): Promise<PeriodCloseCheck> {
  return periodRpc(db, companyId, id, 'get_period_close_check', { p_period_id: id })
}

// 1回のRPCで1期だけを処理する。複数期を同じトランザクションへまとめない。
export function closeFiscalPeriod(db: SupabaseClient, companyId: string, id: string, memo?: string): Promise<PeriodCloseResult> {
  return periodRpc(db, companyId, id, 'close_fiscal_period', { p_period_id: id, p_memo: memo ?? null })
}

export function reopenFiscalPeriod(db: SupabaseClient, companyId: string, id: string, memo?: string): Promise<PeriodReopenResult> {
  return periodRpc(db, companyId, id, 'reopen_fiscal_period', { p_period_id: id, p_memo: memo ?? null })
}

async function validatePeriod(db: SupabaseClient, companyId: string, start: string, end: string): Promise<PeriodResult> {
  const { data, error } = await db.from('companies').select('kind').eq('id', companyId).single()
  if (error || !data) return { error: error?.message ?? '会社が見つかりません' }
  if (data.kind === 'INDIVIDUAL' && !isIndividualFiscalPeriod(start, end)) {
    return { code: 'INVALID_COMPANY', error: '個人の会計期間は同じ年の1月1日から12月31日にしてください' }
  }
  return {}
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export async function setCurrentPeriodForCompany(db: SupabaseClient, companyId: string, id: string): Promise<PeriodResult> {
  const { data: periods, error: readError } = await db.from('fiscal_periods').select('id, is_current').eq('company_id', companyId)
  if (readError) return { error: readError.message }
  if (!periods?.some(period => period.id === id)) return { error: '期間が見つかりません' }
  const original = periods.find(period => period.is_current)
  if (original?.id === id) return {}
  const { error: clearError } = await db.from('fiscal_periods').update({ is_current: false }).eq('company_id', companyId).eq('is_current', true)
  if (clearError) return { error: clearError.message }
  const { data: changed, error: setError } = await db.from('fiscal_periods').update({ is_current: true }).eq('company_id', companyId).eq('id', id).select('id')
  if (setError || !changed?.length) {
    const message = setError?.message ?? '切替先の期間が見つかりません'
    if (original) {
      const { data: restored, error: restoreError } = await db.from('fiscal_periods').update({ is_current: true }).eq('company_id', companyId).eq('id', original.id).select('id')
      // DBトランザクションではないため復元自体の失敗もありうる。黙って当期未設定にしない。
      if (restoreError || !restored?.length) return { error: `${message}。元の当期の復元にも失敗しました。再読み込みして当期を確認してください（${restoreError?.message ?? '期間が見つかりません'}）` }
    }
    return { error: message }
  }
  return {}
}

export async function createPeriodForCompany(db: SupabaseClient, companyId: string, input: PeriodInput): Promise<PeriodResult> {
  const validation = await validatePeriod(db, companyId, input.start_date, input.end_date)
  if (validation.error) return validation
  const { data: periods, error: readError } = await db.from('fiscal_periods').select('end_date').eq('company_id', companyId).order('start_date', { ascending: false })
  if (readError) return { error: readError.message }
  if (periods?.length) {
    const expected = addDays(periods[0].end_date, 1)
    if (input.start_date !== expected) return { error: `開始日は前の期の翌日（${expected}）である必要があります` }
  }
  const { error } = await db.from('fiscal_periods').insert({ ...input, company_id: companyId, is_current: false })
  if (!error) return {}
  const translated = translateSupabaseError(error)
  return { error: translated.code === 'DB_QUERY_FAILED' ? error.message : translated.message, code: translated.code }
}

export async function updatePeriodForCompany(db: SupabaseClient, companyId: string, id: string, input: PeriodInput): Promise<PeriodResult> {
  const { data: current, error: readError } = await db.from('fiscal_periods').select('start_date').eq('company_id', companyId).eq('id', id).single()
  if (readError || !current) return { error: readError?.message ?? '期間が見つかりません' }
  // 開始日は更新対象ではない。呼出元の input.start_date で検証をすり抜けさせない。
  const validation = await validatePeriod(db, companyId, current.start_date, input.end_date)
  if (validation.error) return validation
  const { data: next, error: nextError } = await db.from('fiscal_periods').select('start_date').eq('company_id', companyId).gt('start_date', current.start_date).order('start_date', { ascending: true }).limit(1)
  if (nextError) return { error: nextError.message }
  if (next?.length && input.end_date !== addDays(next[0].start_date, -1)) return { error: '終了日を変更すると次の期間と空白または重複が生じます' }
  const { data: changed, error } = await db.from('fiscal_periods').update({ name: input.name, end_date: input.end_date }).eq('company_id', companyId).eq('id', id).select('id')
  if (error) {
    const translated = translateSupabaseError(error)
    return { error: translated.code === 'DB_QUERY_FAILED' ? error.message : translated.message, code: translated.code }
  }
  return changed?.length ? {} : { error: '期間が見つかりません' }
}

export async function deletePeriodForCompany(db: SupabaseClient, companyId: string, id: string): Promise<PeriodResult> {
  const { data: periods, error: readError } = await db.from('fiscal_periods').select('id, end_date, is_current, closed_at').eq('company_id', companyId).order('end_date', { ascending: false })
  if (readError) return { error: readError.message }
  if (!periods?.length) return { error: '期間が見つかりません' }
  const target = periods.find(period => period.id === id)
  if (target?.closed_at) return { code: ERROR_CODES.PERIOD_CLOSED_FIELDS.code, error: ERROR_CODES.PERIOD_CLOSED_FIELDS.message }
  if (periods[0].id !== id) return { error: '最新の期間のみ削除できます' }
  if (periods[0].is_current) return { error: '現在の期間は削除できません' }
  const { count, error: countError } = await db.from('journal_entries').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('period_id', id)
  if (countError) return { error: countError.message }
  if (count && count > 0) return { error: 'この期間に仕訳が存在するため削除できません' }
  const { data: sets, error: setError } = await db.from('period_opening_balance_sets').select('id').eq('company_id', companyId).eq('period_id', id)
  // E-1はSQL適用前にも使う。未作成テーブルだけは従来の削除経路へ進む。
  if (setError && !['42P01', 'PGRST205'].includes(setError.code)) return { error: setError.message }
  const manualSetError = { code: ERROR_CODES.OPENING_BALANCE_MANUAL_SET_EXISTS.code, error: ERROR_CODES.OPENING_BALANCE_MANUAL_SET_EXISTS.message }
  if (sets?.length) return manualSetError
  const { data: removed, error } = await db.from('fiscal_periods').delete().eq('company_id', companyId).eq('id', id).select('id')
  if (error) {
    const translated = translateSupabaseError(error)
    return translated.code === manualSetError.code ? manualSetError : { code: translated.code, error: translated.code === 'DB_QUERY_FAILED' ? error.message : translated.message }
  }
  return removed?.length ? {} : { error: '期間が見つかりません' }
}
