'use client'

import { useState, useEffect } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useCurrentPeriod } from '@/contexts/FiscalPeriodContext'
import PrintButton from '@/components/print/PrintButton'
import PDFButton from '@/components/pdf/PDFButton'
import {
  getSubsidiaryBalanceReport,
  TYPE_LABELS,
  type SubsidiaryBalanceGroup,
} from '@/lib/reports/subsidiary-balance'

export default function SubsidiaryBalancePage() {
  const { period } = useCurrentPeriod()
  const [groups, setGroups] = useState<SubsidiaryBalanceGroup[]>([])
  const [grandOpening, setGrandOpening] = useState(0)
  const [grandDebit, setGrandDebit] = useState(0)
  const [grandCredit, setGrandCredit] = useState(0)
  const [grandClosing, setGrandClosing] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      if (!period) { setLoading(false); return }
      setLoading(true)
    setErrorMessage('')
      try {
        const report = await getSubsidiaryBalanceReport({ periodId: period.id, periodName: period.name })
        setGroups(report.groups)
        setGrandOpening(report.grandOpening)
        setGrandDebit(report.grandDebit)
        setGrandCredit(report.grandCredit)
        setGrandClosing(report.grandClosing)
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : 'データの取得に失敗しました。')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [period])

  const fmt = (n: number) => n.toLocaleString('ja-JP')
  const fmtOb = (n: number) => n !== 0 ? fmt(Math.abs(n)) : '-'

  const buildPdfHref = (): string => {
    if (!period) return ''
    const p = new URLSearchParams()
    p.set('periodId', period.id)
    p.set('periodName', period.name)
    return `/api/pdf/subsidiary-balance?${p.toString()}`
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* 印刷時のみ表示するタイトル */}
      <div className="print-title mb-4">
        <h2 className="text-xl font-bold">補助残高一覧表</h2>
        {period && <p className="text-sm mt-1">{period.name}</p>}
      </div>

      {/* 画面表示用ヘッダー（印刷時は非表示） */}
      <div className="flex items-center justify-between mb-6 no-print">
        <h1 className="text-2xl font-bold">補助残高一覧表</h1>
        <div className="flex items-center gap-2">
          <PrintButton />
          {period && (
            <PDFButton
              href={buildPdfHref()}
              filename={`補助残高一覧表_${period.name}.pdf`}
            />
          )}
        </div>
      </div>

      {errorMessage ? (
        <p role="alert" className="text-destructive">{errorMessage}</p>
      ) : loading ? (
        <p className="text-muted-foreground text-sm">読み込み中...</p>
      ) : groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">データがありません。</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>親科目</TableHead>
              <TableHead>補助科目名</TableHead>
              <TableHead className="text-right">期首残高</TableHead>
              <TableHead className="text-right">当期借方</TableHead>
              <TableHead className="text-right">当期貸方</TableHead>
              <TableHead className="text-right">期末残高</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.flatMap((group) => [
              <TableRow key={`group-${group.parentId}`} className="bg-muted/30 hover:bg-muted/30">
                <TableCell colSpan={6} className="font-semibold text-sm py-2">
                  {group.parentName}（{TYPE_LABELS[group.parentType]}）
                </TableCell>
              </TableRow>,
              ...group.rows.map((row) => (
                <TableRow key={row.accountId}>
                  <TableCell className="text-muted-foreground">{row.parentAccountName}</TableCell>
                  <TableCell>{row.accountName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {group.isBs ? fmtOb(row.openingBalance) : '-'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(row.debitTotal)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(row.creditTotal)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{fmtOb(row.closingBalance)}</TableCell>
                </TableRow>
              )),
              <TableRow key={`subtotal-${group.parentId}`} className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={2} className="text-right text-sm text-muted-foreground">
                  小計
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {group.isBs ? fmtOb(group.openingSubtotal) : '-'}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{fmt(group.debitSubtotal)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{fmt(group.creditSubtotal)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{fmtOb(group.closingSubtotal)}</TableCell>
              </TableRow>,
            ])}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} className="font-bold">合計</TableCell>
              <TableCell className="text-right font-bold tabular-nums">{fmtOb(grandOpening)}</TableCell>
              <TableCell className="text-right font-bold tabular-nums">{fmt(grandDebit)}</TableCell>
              <TableCell className="text-right font-bold tabular-nums">{fmt(grandCredit)}</TableCell>
              <TableCell className="text-right text-muted-foreground">—</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </div>
  )
}
