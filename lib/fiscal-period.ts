import { supabase } from './supabase'

export type FiscalPeriod = {
  id: string
  name: string
  start_date: string
  end_date: string
  is_current: boolean
  closed_at: string | null
}

export async function getCurrentPeriod(companyId: string): Promise<FiscalPeriod> {
  const { data, error } = await supabase
    .from('fiscal_periods')
    .select('*')
    .eq('is_current', true)
    .eq('company_id', companyId)
    .single()
  if (error || !data) throw new Error('現在期を取得できませんでした')
  return data as FiscalPeriod
}

export async function getAllPeriods(companyId: string): Promise<FiscalPeriod[]> {
  const { data, error } = await supabase
    .from('fiscal_periods')
    .select('*')
    .eq('company_id', companyId)
    .order('start_date', { ascending: false })
  if (error) throw new Error('会計期間を取得できませんでした')
  return (data ?? []) as FiscalPeriod[]
}

// 月(1-12)がその期のどの年に属するかを返す
export function resolveYearFromMonth(month: number, period: FiscalPeriod): number {
  const startMonth = new Date(period.start_date).getMonth() + 1
  const startYear = new Date(period.start_date).getFullYear()
  if (startMonth === 1) return startYear
  return month >= startMonth ? startYear : startYear + 1
}

// 終了日から期名を自動生成（例: "2026-03-31" → "2026年3月期"）
export function generatePeriodName(_startDate: string, endDate: string): string {
  const d = new Date(endDate)
  return `${d.getFullYear()}年${d.getMonth() + 1}月期`
}
