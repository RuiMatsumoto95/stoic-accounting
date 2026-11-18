import type { IndividualPLReport } from '@/lib/reports/income-statement'
import { buildIndividualPLRows } from '@/lib/individual-statement-rows'
import { IndividualStatementDocument } from './IndividualStatementDocument'

export function IndividualPLDocument({ report, showPrev }: { report: IndividualPLReport; showPrev: boolean }) {
  return <IndividualStatementDocument title="損益計算書" periodName={report.periodName} showPrev={showPrev}
    rows={buildIndividualPLRows({ ...report.data, sections: report.sections }, { showPrev, hideZero: false })} />
}
