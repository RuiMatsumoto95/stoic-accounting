'use client'

import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { fetchAutomaticOpeningImpact } from '@/lib/opening-balance-impact'

export default function OpeningBalanceImpactNotice({ companyId, periodId }: { companyId: string; periodId: string | null }) {
  const [result, setResult] = useState<{ periodId: string; affected: boolean; error: string } | null>(null)
  useEffect(() => {
    if (!periodId) return
    let cancelled = false
    async function load() {
      try {
        const affected = await fetchAutomaticOpeningImpact(companyId, periodId!)
        if (!cancelled) setResult({ periodId: periodId!, affected, error: '' })
      } catch (e) {
        if (!cancelled) setResult({ periodId: periodId!, affected: false, error: e instanceof Error ? e.message : '通知の取得に失敗しました' })
      }
    }
    void load()
    // 他タブでの手動設定の変更も、画面へ戻ったときに確認する。
    window.addEventListener('focus', load)
    return () => { cancelled = true; window.removeEventListener('focus', load) }
  }, [companyId, periodId])
  if (!periodId || result?.periodId !== periodId) return null
  if (result.error) return <Alert><AlertDescription>翌期への影響を確認できませんでした。{result.error}</AlertDescription></Alert>
  return result.affected ? <Alert><AlertDescription>この期の仕訳を変更すると、翌期以降の期首残高も自動で再計算されます</AlertDescription></Alert> : null
}
