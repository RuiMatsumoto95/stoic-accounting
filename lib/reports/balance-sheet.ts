import { getBSData, getIndividualBSData, type BSResult, type BSSection, type IndividualBSResult } from '@/lib/financial-statements'
import { getPLReport } from './income-statement'

export interface BSReport {
  kind: 'CORPORATION'
  periodName: string
  data: BSResult
  sections: BSSection[]
}
export interface IndividualBSReport {
  kind: 'INDIVIDUAL'
  periodName: string
  data: IndividualBSResult
  sections: IndividualBSResult['sections']
}

export async function getBSReport(options: {
  periodId: string; periodName: string; prevPeriodId: string | null; showPrev: boolean; hideZero: boolean
}): Promise<BSReport | IndividualBSReport> {
  // PL が期から会社・区分を確定し、前期との会社整合も確認する。
  const pl = await getPLReport(options)
  const { periodId, prevPeriodId, showPrev, hideZero } = options
  const visible = (item: { amount: number; prev_amount: number | null }) =>
    !hideZero || item.amount !== 0 || (showPrev && (item.prev_amount ?? 0) !== 0)
  if (pl.kind === 'INDIVIDUAL') {
    const data = await getIndividualBSData(periodId, prevPeriodId, pl.data.incomeBeforeDeduction, pl.data.prev?.incomeBeforeDeduction ?? null)
    return { kind: pl.kind, periodName: pl.periodName, data, sections: data.sections.map(section => ({ ...section, items: section.items.filter(visible) })) }
  }
  const data = await getBSData(periodId, prevPeriodId, pl.data.netIncome, pl.data.prev?.netIncome ?? null)
  return { kind: pl.kind, periodName: pl.periodName, data, sections: data.sections.map(section => ({ ...section, items: section.items.filter(visible) })) }
}
