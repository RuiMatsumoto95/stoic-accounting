'use client'

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type Props = {
  rows: { label: string; debit: number; credit: number }[]
  grandDebit: number
  grandCredit: number
  loading: boolean
}

export default function TaxSummaryTable({ rows, grandDebit, grandCredit, loading }: Props) {
  const fmt = (n: number) => n.toLocaleString('ja-JP')

  if (loading) {
    return <p className="text-muted-foreground text-sm">読み込み中...</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>税区分</TableHead>
          <TableHead className="text-right">借方金額合計</TableHead>
          <TableHead className="text-right">貸方金額合計</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ label, debit, credit }) => (
          <TableRow key={label}>
            <TableCell>{label}</TableCell>
            <TableCell className="text-right">{fmt(debit)}</TableCell>
            <TableCell className="text-right">{fmt(credit)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="font-bold">合計</TableCell>
          <TableCell className="text-right font-bold">{fmt(grandDebit)}</TableCell>
          <TableCell className="text-right font-bold">{fmt(grandCredit)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}
