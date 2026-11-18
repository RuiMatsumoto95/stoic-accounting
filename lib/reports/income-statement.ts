import { getPLData, getIndividualPLData, type PLResult, type PLSection, type IndividualPLResult } from '@/lib/financial-statements'
import { getReportCompanyKind, getReportPeriod, validateComparisonPeriod } from './scope'

export interface PLReport {
  kind: 'CORPORATION'
  periodName: string
  data: PLResult
  sections: PLSection[]
}
export interface IndividualPLReport {
  kind: 'INDIVIDUAL'
  periodName: string
  data: IndividualPLResult
  sections: IndividualPLResult['sections']
}

export async function getPLReport({ periodId, prevPeriodId, showPrev, hideZero }: {
  periodId: string; periodName: string; prevPeriodId: string | null; showPrev: boolean; hideZero: boolean
}): Promise<PLReport | IndividualPLReport> {
  const companyId = await validateComparisonPeriod(periodId, prevPeriodId)
  const period = await getReportPeriod(periodId)
  const kind = await getReportCompanyKind(companyId)
  const visible = (item: { amount: number; prev_amount: number | null }) =>
    !hideZero || item.amount !== 0 || (showPrev && (item.prev_amount ?? 0) !== 0)
  if (kind === 'INDIVIDUAL') {
    const data = await getIndividualPLData(periodId, prevPeriodId)
    return { kind, periodName: period.name, data, sections: data.sections.map(section => ({ ...section, items: section.items.filter(visible) })) }
  }
  const data = await getPLData(periodId, prevPeriodId)
  return { kind, periodName: period.name, data, sections: data.sections.map(section => ({ ...section, items: section.items.filter(visible) })) }
}
