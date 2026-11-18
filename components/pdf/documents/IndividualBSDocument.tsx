import type { IndividualBSReport } from '@/lib/reports/balance-sheet'
import { buildIndividualBSRows } from '@/lib/individual-statement-rows'
import { IndividualStatementDocument } from './IndividualStatementDocument'

export function IndividualBSDocument({ report, showPrev }: { report: IndividualBSReport; showPrev: boolean }) {
  return <IndividualStatementDocument title="貸借対照表" periodName={report.periodName} showPrev={showPrev}
    rows={buildIndividualBSRows({ ...report.data, sections: report.sections }, { showPrev, hideZero: false })} />
}
