import type { IndividualBSResult } from '@/lib/individual-financial-statements'
import { buildIndividualBSRows } from '@/lib/individual-statement-rows'
import { IndividualStatementTable } from './IndividualStatementTable'

export function IndividualBSTable({ data, showPrev, hideZero }: { data: IndividualBSResult; showPrev: boolean; hideZero: boolean }) {
  return <IndividualStatementTable rows={buildIndividualBSRows(data, { showPrev, hideZero })} showPrev={showPrev} />
}
