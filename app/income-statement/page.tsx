'use client'

import { useCompany } from '@/contexts/CompanyContext'

import { useEffect, useState } from 'react'
import { useCurrentPeriod } from '@/contexts/FiscalPeriodContext'
import { getPreviousPeriod } from '@/lib/balance-calculator'
import { getPLData, getIndividualPLData, PLResult, IndividualPLResult } from '@/lib/financial-statements'
import { IndividualPLTable } from '@/components/financial-statements/IndividualPLTable'
import { PLTable } from '@/components/financial-statements/PLTable'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { FiscalPeriod } from '@/lib/fiscal-period'
import PrintButton from '@/components/print/PrintButton'
import PDFButton from '@/components/pdf/PDFButton'

export default function IncomeStatementPage() {
  const { period } = useCurrentPeriod()
  const company = useCompany()
  const [plData, setPlData] = useState<PLResult | IndividualPLResult | null>(null)
  const [prevPeriod, setPrevPeriod] = useState<FiscalPeriod | null>(null)
  const [showPrev, setShowPrev] = useState(false)
  const [hideZeroAccounts, setHideZeroAccounts] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!period) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const prev = await getPreviousPeriod(period.id)
        if (cancelled) return
        setPrevPeriod(prev)
        const data = await (company.kind === 'INDIVIDUAL' ? getIndividualPLData : getPLData)(period.id, prev?.id ?? null)
        if (!cancelled) setPlData(data)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '読み込みに失敗しました')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [period, company.id, company.kind])

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* 印刷時のみ表示するタイトル */}
      <div className="print-title mb-4">
        <h2 className="text-xl font-bold">損益計算書</h2>
        {period && <p className="text-sm mt-1">{period.name}</p>}
      </div>

      {/* 画面表示用ヘッダー（印刷時は非表示） */}
      <div className="flex items-center justify-between mb-2 no-print">
        <h1 className="text-2xl font-bold">損益計算書</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="hide-zero"
              checked={hideZeroAccounts}
              onCheckedChange={setHideZeroAccounts}
            />
            <Label htmlFor="hide-zero" className="cursor-pointer">ゼロ残高科目を隠す</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="show-prev"
              checked={showPrev}
              onCheckedChange={setShowPrev}
              disabled={prevPeriod === null}
            />
            <Label htmlFor="show-prev" className="cursor-pointer">前期比較</Label>
          </div>
          <PrintButton />
          {period && (
            <PDFButton
              href={`/api/pdf/income-statement?periodId=${period.id}&periodName=${encodeURIComponent(period.name)}&showPrev=${showPrev && prevPeriod !== null}&hideZero=${hideZeroAccounts}&prevPeriodId=${prevPeriod?.id ?? ''}`}
              filename={`損益計算書_${period.name}.pdf`}
            />
          )}
        </div>
      </div>
      {period && (
        <p className="text-sm text-muted-foreground mb-4 no-print">{period.name}</p>
      )}
      {loading && <p className="text-muted-foreground">読み込み中...</p>}
      {error && <p className="text-red-600">{error}</p>}
      {!loading && !error && plData && (
        company.kind === 'INDIVIDUAL' && 'kind' in plData
            ? <IndividualPLTable data={plData} showPrev={showPrev && prevPeriod !== null} hideZero={hideZeroAccounts} />
            : !('kind' in plData) && <PLTable data={plData} showPrev={showPrev && prevPeriod !== null} hideZero={hideZeroAccounts} />
      )}
    </div>
  )
}
