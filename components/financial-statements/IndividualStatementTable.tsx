import type { StatementRow } from '@/lib/individual-statement-rows'
import { FinancialRow } from './FinancialRow'
import { SectionHeader } from './SectionHeader'

export function IndividualStatementTable({ rows, showPrev }: { rows: StatementRow[]; showPrev: boolean }) {
  return <table className="w-full border-collapse">
    <thead><tr className="border-b text-xs text-muted-foreground">
      <th className="py-2 text-left pl-3">科目</th>
      <th className="py-2 text-right pr-3 w-36">当期</th>
      {showPrev && <>
        <th className="py-2 text-right pr-3 w-36">前期</th>
        <th className="py-2 text-right pr-3 w-36">増減額</th>
        <th className="py-2 text-right pr-3 w-24">増減率</th>
      </>}
    </tr></thead>
    <tbody>{rows.map(row => row.kind === 'header'
      ? <SectionHeader key={row.key} label={row.label} colSpan={showPrev ? 5 : 2} />
      : <FinancialRow key={row.key} label={row.label} indent={row.kind === 'item' ? 1 : 0}
          amount={row.amount} prevAmount={row.prevAmount}
          changeAmount={row.prevAmount !== null ? row.amount - row.prevAmount : null}
          changeRate={row.prevAmount !== null && row.prevAmount !== 0 ? (row.amount - row.prevAmount) / Math.abs(row.prevAmount) : null}
          isSubtotal={row.kind !== 'item'} showPrev={showPrev} />)}</tbody>
  </table>
}
