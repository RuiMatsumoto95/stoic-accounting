'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import TaxSummaryTable from '@/components/tax-summary/TaxSummaryTable'
import { useCurrentPeriod } from '@/contexts/FiscalPeriodContext'
import PrintButton from '@/components/print/PrintButton'
import PDFButton from '@/components/pdf/PDFButton'
import { getTaxSummaryReport } from '@/lib/reports/tax-summary'
import { getAllTaxCodes, TaxCode } from '@/lib/tax-codes'

export default function TaxSummaryPage() {
  const { period } = useCurrentPeriod()
  const [startDate, setStartDate] = useState('2024-01-01')
  const [endDate, setEndDate] = useState('2024-12-31')
  const [rows, setRows] = useState<{ label: string; debit: number; credit: number }[]>([])
  const [grandDebit, setGrandDebit] = useState(0)
  const [grandCredit, setGrandCredit] = useState(0)
  const [loading, setLoading] = useState(true)
  const [allTaxCodes, setAllTaxCodes] = useState<TaxCode[]>([])

  useEffect(() => {
    getAllTaxCodes().then(setAllTaxCodes).catch(console.error)
  }, [])

  async function fetchData(start: string, end: string) {
    if (!period) { setLoading(false); return }
    setLoading(true)
    try {
      const report = await getTaxSummaryReport(
        {
          periodId: period.id,
          periodName: period.name,
          startDate: start,
          endDate: end,
        },
        allTaxCodes
      )
      setRows(report.rows)
      setGrandDebit(report.grandDebit)
      setGrandCredit(report.grandCredit)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData(startDate, endDate)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  function handleSearch() {
    fetchData(startDate, endDate)
  }

  const pdfHref = period
    ? `/api/pdf/tax-summary?periodId=${period.id}&periodName=${encodeURIComponent(period.name)}&startDate=${startDate}&endDate=${endDate}`
    : ''

  return (
    <div className="max-w-3xl mx-auto p-6">
      {/* 印刷時のみ表示するタイトル・集計期間 */}
      <div className="print-title mb-4">
        <h2 className="text-xl font-bold">消費税集計表</h2>
        {period && <p className="text-sm mt-1">{period.name}</p>}
      </div>
      <div className="print-only text-sm text-muted-foreground mb-4">
        集計期間：{startDate} 〜 {endDate}
      </div>

      {/* 画面表示用ヘッダー（印刷時は非表示） */}
      <div className="flex items-center justify-between mb-6 no-print">
        <h1 className="text-2xl font-bold">消費税集計表</h1>
        <div className="flex items-center gap-2">
          <PrintButton />
          {period && (
            <PDFButton
              href={pdfHref}
              filename={`消費税集計表_${period.name}_${startDate}_${endDate}.pdf`}
            />
          )}
        </div>
      </div>

      <div className="flex items-end gap-4 mb-6 no-print">
        <div className="grid gap-1.5">
          <Label htmlFor="start-date">開始日</Label>
          <Input
            id="start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="end-date">終了日</Label>
          <Input
            id="end-date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-40"
          />
        </div>
        <Button onClick={handleSearch}>表示</Button>
      </div>

      <TaxSummaryTable rows={rows} grandDebit={grandDebit} grandCredit={grandCredit} loading={loading} />
    </div>
  )
}
