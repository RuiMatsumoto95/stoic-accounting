'use client'

import { useEffect, useState } from 'react'
import { useCompany } from '@/contexts/CompanyContext'
import { getAllPeriods, type FiscalPeriod } from '@/lib/fiscal-period'
import OpeningBalanceEditor from '@/components/opening-balances/OpeningBalanceEditor'
import PeriodClosedNotice from '@/components/PeriodClosedNotice'
import { isPeriodClosed } from '@/lib/period-close-state'

export default function OpeningBalancesPage() {
  const company = useCompany()
  const [periods, setPeriods] = useState<FiscalPeriod[]>([])
  const [periodId, setPeriodId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const list = await getAllPeriods(company.id)
        if (cancelled) return
        setPeriods(list)
        setPeriodId(list.find(period => period.is_current)?.id ?? list[0]?.id ?? '')
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : '会計期間を取得できませんでした') }
      finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [company.id])
  const selected = periods.find(period => period.id === periodId)
  return <div className="max-w-7xl mx-auto p-6 space-y-5">
    <h1 className="text-2xl font-bold">期首残高</h1>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {loading ? <p>会計期間を読み込み中です</p> : periods.length === 0 ? <p>会計期間がありません。設定画面で会計期間を作成してください。</p> : <>
      <label className="block text-sm">会計期間
        <select className="block mt-1 border rounded px-3 py-2 bg-background" value={periodId} disabled={busy} onChange={event => {
          if (dirty && !window.confirm('未保存の入力があります。破棄して会計期間を切り替えますか？')) return
          setDirty(false)
          setPeriodId(event.target.value)
        }}>
          {periods.map(period => <option key={period.id} value={period.id}>{period.name}{period.is_current ? '（当期）' : ''}</option>)}
        </select>
      </label>
      <PeriodClosedNotice period={selected} />
      {selected && <OpeningBalanceEditor key={selected.id} companyId={company.id} periodId={selected.id}
        readOnly={isPeriodClosed(selected)}
        isFirstPeriod={!periods.some(period => period.start_date < selected.start_date)} onDirtyChange={setDirty} onBusyChange={setBusy} />}
    </>}
  </div>
}
