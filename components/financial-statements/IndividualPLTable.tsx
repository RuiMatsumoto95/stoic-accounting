import type { IndividualPLResult } from '@/lib/individual-financial-statements'
import { buildIndividualPLRows } from '@/lib/individual-statement-rows'
import { IndividualStatementTable } from './IndividualStatementTable'

export function IndividualPLTable({ data, showPrev, hideZero }: { data: IndividualPLResult; showPrev: boolean; hideZero: boolean }) {
  return <IndividualStatementTable rows={buildIndividualPLRows(data, { showPrev, hideZero })} showPrev={showPrev} />
}
