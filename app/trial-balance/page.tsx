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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCurrentPeriod } from '@/contexts/FiscalPeriodContext'
import {
  getTrialBalanceReport,
  TrialBalanceReport,
  BS_TYPES,
  BS_TYPE_ORDER,
} from '@/lib/reports/trial-balance'
import PrintButton from '@/components/print/PrintButton'
import PDFButton from '@/components/pdf/PDFButton'

const FILTER_TYPES = BS_TYPE_ORDER

export default function TrialBalancePage() {
  const { period } = useCurrentPeriod()
  const [report, setReport] = useState<TrialBalanceReport | null>(null)
  const [subReport, setSubReport] = useState<TrialBalanceReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [subLoading, setSubLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [activeTab, setActiveTab] = useState('accounts')

  useEffect(() => {
    async function fetchData() {
      if (!period) {
        setErrorMessage('現在の会計期間が設定されていません。')
        setLoading(false)
        return
      }
      setLoading(true)
      setErrorMessage('')
      setSubReport(null)
      setActiveTab('accounts')
      try {
        const result = await getTrialBalanceReport({
          periodId: period.id,
          periodName: period.name,
          filterTypes: FILTER_TYPES,
        })
        setReport(result)
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : 'データの取得に失敗しました。')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [period])

  async function handleTabChange(tab: string) {
    setActiveTab(tab)
    if (tab === 'subsidiaries' && !subReport && period) {
      setSubLoading(true)
      try {
        const result = await getTrialBalanceReport({
          periodId: period.id,
          periodName: period.name,
          filterTypes: FILTER_TYPES,
          includeSubsidiaries: true,
        })
        setSubReport(result)
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : 'データの取得に失敗しました。')
      } finally {
        setSubLoading(false)
      }
    }
  }

  const fmt   = (n: number) => n.toLocaleString('ja-JP')
  const fmtOb = (n: number) => n !== 0 ? fmt(Math.abs(n)) : '-'

  function renderMainTable(r: TrialBalanceReport) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>コード</TableHead>
            <TableHead>勘定科目</TableHead>
            <TableHead className="text-right">期首残高</TableHead>
            <TableHead className="text-right">当期借方</TableHead>
            <TableHead className="text-right">当期貸方</TableHead>
            <TableHead className="text-right">期末残高</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {r.groups.flatMap((group) => {
            const isBsGroup = BS_TYPES.includes(group.type)
            return [
              <TableRow key={`group-${group.type}`} className="bg-muted/30 hover:bg-muted/30">
                <TableCell colSpan={6} className="font-semibold text-sm py-2">
                  {group.label}
                </TableCell>
              </TableRow>,
              ...group.rows.map((row) => (
                <TableRow key={row.accountId}>
                  <TableCell className="text-muted-foreground">{row.accountCode}</TableCell>
                  <TableCell>{row.accountName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {isBsGroup ? fmtOb(row.openingBalance) : '-'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(row.debitTotal)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(row.creditTotal)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {fmtOb(row.closingBalance)}
                  </TableCell>
                </TableRow>
              )),
              <TableRow key={`subtotal-${group.type}`} className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={2} className="text-right text-sm text-muted-foreground">小計</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {isBsGroup ? fmtOb(group.openingSubtotal) : '-'}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{fmt(group.debitSubtotal)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{fmt(group.creditSubtotal)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{fmtOb(group.closingSubtotal)}</TableCell>
              </TableRow>,
            ]
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2} className="font-bold">合計</TableCell>
            <TableCell className="text-right font-bold tabular-nums">{fmtOb(r.grandOpening)}</TableCell>
            <TableCell className="text-right font-bold tabular-nums">{fmt(r.grandDebit)}</TableCell>
            <TableCell className="text-right font-bold tabular-nums">{fmt(r.grandCredit)}</TableCell>
            <TableCell className="text-right font-bold tabular-nums">{fmtOb(r.grandClosing)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    )
  }

  function renderSubsidiaryTable(r: TrialBalanceReport) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>コード</TableHead>
            <TableHead>勘定科目</TableHead>
            <TableHead className="text-right">期首残高</TableHead>
            <TableHead className="text-right">当期借方</TableHead>
            <TableHead className="text-right">当期貸方</TableHead>
            <TableHead className="text-right">期末残高</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {r.groups.flatMap((group) => {
            const isBsGroup = BS_TYPES.includes(group.type)
            return [
              <TableRow key={`group-${group.type}`} className="bg-muted/30 hover:bg-muted/30">
                <TableCell colSpan={6} className="font-semibold text-sm py-2">
                  {group.label}
                </TableCell>
              </TableRow>,
              ...group.rows.flatMap((row) => {
                const hasChildren = row.children && row.children.length > 0
                const parentRow = (
                  <TableRow
                    key={row.accountId}
                    className={hasChildren ? 'bg-muted/20 hover:bg-muted/20' : undefined}
                  >
                    <TableCell className="text-muted-foreground">{row.accountCode}</TableCell>
                    <TableCell className={hasChildren ? 'font-medium' : undefined}>{row.accountName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {isBsGroup ? fmtOb(row.openingBalance) : '-'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(row.debitTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(row.creditTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {fmtOb(row.closingBalance)}
                    </TableCell>
                  </TableRow>
                )
                const childRows = hasChildren
                  ? (row.children ?? []).map((child) => (
                    <TableRow key={child.accountId}>
                      <TableCell className="text-muted-foreground pl-8">{child.accountCode}</TableCell>
                      <TableCell className="pl-6 text-muted-foreground">{child.accountName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {isBsGroup ? fmtOb(child.openingBalance) : '-'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(child.debitTotal)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(child.creditTotal)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtOb(child.closingBalance)}</TableCell>
                    </TableRow>
                  ))
                  : []
                return [parentRow, ...childRows]
              }),
              <TableRow key={`subtotal-${group.type}`} className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={2} className="text-right text-sm text-muted-foreground">小計</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {isBsGroup ? fmtOb(group.openingSubtotal) : '-'}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{fmt(group.debitSubtotal)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{fmt(group.creditSubtotal)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{fmtOb(group.closingSubtotal)}</TableCell>
              </TableRow>,
            ]
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2} className="font-bold">合計</TableCell>
            <TableCell className="text-right font-bold tabular-nums">{fmtOb(r.grandOpening)}</TableCell>
            <TableCell className="text-right font-bold tabular-nums">{fmt(r.grandDebit)}</TableCell>
            <TableCell className="text-right font-bold tabular-nums">{fmt(r.grandCredit)}</TableCell>
            <TableCell className="text-right font-bold tabular-nums">{fmtOb(r.grandClosing)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="print-title mb-4">
        <h2 className="text-xl font-bold">残高試算表（貸借）</h2>
        {period && <p className="text-sm mt-1">{period.name}</p>}
      </div>

      <div className="flex items-center justify-between mb-6 no-print">
        <h1 className="text-2xl font-bold">残高試算表（貸借）</h1>
        <div className="flex items-center gap-2">
          <PrintButton />
          {period && (
            <PDFButton
              href={`/api/pdf/trial-balance?periodId=${period.id}&periodName=${encodeURIComponent(period.name)}&filterTypes=bs&tab=${activeTab}`}
              filename={`残高試算表（貸借）_${period.name}.pdf`}
            />
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">読み込み中...</p>
      ) : errorMessage ? (
        <p className="text-red-500 text-sm">{errorMessage}</p>
      ) : !report || report.groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">データがありません。</p>
      ) : (
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="mb-4 no-print">
            <TabsTrigger value="accounts">科目別</TabsTrigger>
            <TabsTrigger value="subsidiaries">補助科目</TabsTrigger>
          </TabsList>
          <TabsContent value="accounts">
            {renderMainTable(report)}
          </TabsContent>
          <TabsContent value="subsidiaries">
            {subLoading ? (
              <p className="text-muted-foreground text-sm">読み込み中...</p>
            ) : subReport ? (
              renderSubsidiaryTable(subReport)
            ) : null}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
