'use client'

import { useCompany } from '@/contexts/CompanyContext'

import { useEffect, useState } from 'react'
import { useCurrentPeriod } from '@/contexts/FiscalPeriodContext'
import { getPreviousPeriod } from '@/lib/balance-calculator'
import { getPLData, getBSData, getIndividualPLData, getIndividualBSData, BSResult, IndividualBSResult } from '@/lib/financial-statements'
import { IndividualBSTable } from '@/components/financial-statements/IndividualBSTable'
import { BSTable } from '@/components/financial-statements/BSTable'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { FiscalPeriod } from '@/lib/fiscal-period'
import PrintButton from '@/components/print/PrintButton'
import PDFButton from '@/components/pdf/PDFButton'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function BalanceSheetPage() {
  const { period } = useCurrentPeriod()
  const company = useCompany()
  const [bsData, setBsData] = useState<BSResult | IndividualBSResult | null>(null)
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
        const data = await (async () => {
          if (company.kind === 'INDIVIDUAL') {
            const pl = await getIndividualPLData(period.id, prev?.id ?? null)
            return getIndividualBSData(period.id, prev?.id ?? null, pl.incomeBeforeDeduction, pl.prev?.incomeBeforeDeduction ?? null)
          }
          const pl = await getPLData(period.id, prev?.id ?? null)
          return getBSData(period.id, prev?.id ?? null, pl.netIncome, pl.prev?.netIncome ?? null)
        })()
        if (!cancelled) setBsData(data)
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
        <h2 className="text-xl font-bold">貸借対照表</h2>
        {period && <p className="text-sm mt-1">{period.name}</p>}
      </div>

      {/* 画面表示用ヘッダー（印刷時は非表示） */}
      <div className="flex items-center justify-between mb-2 no-print">
        <h1 className="text-2xl font-bold">貸借対照表</h1>
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
              href={`/api/pdf/balance-sheet?periodId=${period.id}&periodName=${encodeURIComponent(period.name)}&showPrev=${showPrev && prevPeriod !== null}&hideZero=${hideZeroAccounts}&prevPeriodId=${prevPeriod?.id ?? ''}`}
              filename={`貸借対照表_${period.name}.pdf`}
            />
          )}
        </div>
      </div>
      {period && (
        <p className="text-sm text-muted-foreground mb-4 no-print">{period.name}</p>
      )}
      {loading && <p className="text-muted-foreground">読み込み中...</p>}
      {error && <p className="text-red-600">{error}</p>}
      {!loading && !error && bsData && (
        <>
          {bsData.totalAssets !== bsData.totalLiabilitiesAndEquity &&
            !(bsData.totalAssets === 0 && bsData.totalLiabilitiesAndEquity === 0) && (
            <Alert variant="destructive" className="mb-4 no-print">
              <AlertDescription>
                資産合計と負債純資産合計が一致しません（差額: ¥{Math.abs(bsData.totalAssets - bsData.totalLiabilitiesAndEquity).toLocaleString('ja-JP')}）
              </AlertDescription>
            </Alert>
          )}
          {company.kind === 'INDIVIDUAL' && 'kind' in bsData
            ? <IndividualBSTable data={bsData} showPrev={showPrev && prevPeriod !== null} hideZero={hideZeroAccounts} />
            : !('kind' in bsData) && <BSTable data={bsData} showPrev={showPrev && prevPeriod !== null} hideZero={hideZeroAccounts} />}
        </>
      )}
    </div>
  )
}
