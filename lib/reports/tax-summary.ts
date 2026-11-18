import { getReportPeriod } from './scope'
import { supabase } from '@/lib/supabase'
import { TaxCode } from '@/lib/tax-codes'

export interface TaxSummaryReport {
  periodName: string
  startDate: string
  endDate: string
  rows: { label: string; debit: number; credit: number }[]
  grandDebit: number
  grandCredit: number
}

export async function getTaxSummaryReport(
  {
    periodId,
    periodName,
    startDate,
    endDate,
  }: {
    periodId: string
    periodName: string
    startDate: string
    endDate: string
  },
  taxCodes: TaxCode[]
): Promise<TaxSummaryReport> {
  const period = await getReportPeriod(periodId)
  periodName = period.name
  const { data: entries, error: entriesError } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('period_id', periodId)
    .gte('date', startDate)
    .lte('date', endDate)

  if (entriesError) throw new Error(entriesError.message)

  const entryIds = (entries ?? []).map((e) => e.id)

  type RawLine = { tax_code: string | null; side: string; amount: number }
  let lines: RawLine[] = []

  if (entryIds.length > 0) {
    const { data: linesData, error: linesError } = await supabase
      .from('journal_lines')
      .select('tax_code, side, amount')
      .in('entry_id', entryIds)

    if (linesError) throw new Error(linesError.message)
    lines = linesData ?? []
  }

  // tax_code + side ごとに集計
  const map = new Map<string, { tax_code: string | null; side: string; total_amount: number }>()
  for (const line of lines) {
    const key = `${line.tax_code ?? ''}__${line.side}`
    const existing = map.get(key)
    if (existing) {
      existing.total_amount += Number(line.amount)
    } else {
      map.set(key, {
        tax_code: line.tax_code,
        side: line.side,
        total_amount: Number(line.amount),
      })
    }
  }

  const rawData = Array.from(map.values())

  const rows = taxCodes.map(({ id, name }) => {
    const debit = rawData
      .filter((r) => r.tax_code === id && r.side === 'DEBIT')
      .reduce((s, r) => s + r.total_amount, 0)
    const credit = rawData
      .filter((r) => r.tax_code === id && r.side === 'CREDIT')
      .reduce((s, r) => s + r.total_amount, 0)
    return { label: name, debit, credit }
  })

  const grandDebit = rows.reduce((s, r) => s + r.debit, 0)
  const grandCredit = rows.reduce((s, r) => s + r.credit, 0)

  return { periodName, startDate, endDate, rows, grandDebit, grandCredit }
}
