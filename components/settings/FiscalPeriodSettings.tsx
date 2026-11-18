'use client'
import { useCompany } from '@/contexts/CompanyContext'
import { useState, useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FiscalPeriod, getAllPeriods } from '@/lib/fiscal-period'
import { deletePeriod, setCurrentPeriod } from '@/actions/fiscal-period-actions'
import { useCurrentPeriod } from '@/contexts/FiscalPeriodContext'
import { useToast } from '@/lib/toast'
import FiscalPeriodModal from './FiscalPeriodModal'
import { supabase } from '@/lib/supabase'
import { closeFiscalPeriod, reopenFiscalPeriod, getPeriodCloseCheck, type PeriodCloseCheck } from '@/lib/fiscal-period-operations'
import { getPeriodCloseActions, isPeriodClosed } from '@/lib/period-close-state'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'

type Props = {
  initialPeriods: FiscalPeriod[]
}

export default function FiscalPeriodSettings({ initialPeriods }: Props) {
  const company = useCompany()
  const [periods, setPeriods] = useState<FiscalPeriod[]>(initialPeriods)
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<FiscalPeriod | undefined>(undefined)
  const [isPending, startTransition] = useTransition()
  const { refresh } = useCurrentPeriod()
  const toast = useToast()
  const [operation, setOperation] = useState<{ period: FiscalPeriod; mode: 'close' | 'reopen' } | null>(null)
  const [check, setCheck] = useState<PeriodCloseCheck | null>(null)
  const [memo, setMemo] = useState('')
  const [operationError, setOperationError] = useState('')
  const [closeBusy, setCloseBusy] = useState(false)
  const [completedWarnings, setCompletedWarnings] = useState<string[]>([])

  // 最新期（end_dateが最も遅い期）のend_date
  const latestEndDate = periods.reduce(
    (max, p) => (p.end_date > max ? p.end_date : max),
    ''
  )

  async function refreshList() {
    const updated = await getAllPeriods(company.id)
    setPeriods(updated)
  }

  function handleSetCurrent(id: string) {
    startTransition(async () => {
      const result = await setCurrentPeriod(company.id, id)
      if (result.error) { toast.error(result.error); return }
      await refreshList()
      refresh()
    })
  }

  async function handleDelete(p: FiscalPeriod) {
    if (!window.confirm(`「${p.name}」を削除しますか？`)) return
    const result = await deletePeriod(company.id, p.id)
    if (result.error) {
      toast.error(result.error)
      return
    }
    await refreshList()
  }

  function handleAdd() {
    setEditTarget(undefined)
    setModalOpen(true)
  }

  function handleEdit(p: FiscalPeriod) {
    setEditTarget(p)
    setModalOpen(true)
  }

  async function prepareOperation(p: FiscalPeriod, mode: 'close' | 'reopen') {
    const availability = getPeriodCloseActions(p, periods)[mode]
    if (!availability.enabled || closeBusy) return
    setOperation({ period: p, mode })
    setOperationError('')
    setCompletedWarnings([])
    setCheck(null)
    setMemo('')
    if (mode === 'reopen') return
    setCloseBusy(true)
    try { setCheck(await getPeriodCloseCheck(supabase, company.id, p.id)) }
    catch (e) { setOperationError(e instanceof Error ? e.message : '確定前チェックに失敗しました') }
    finally { setCloseBusy(false) }
  }

  async function confirmOperation() {
    if (!operation || closeBusy) return
    if (operation.mode === 'close' && (!check || check.closed || check.errors.length > 0)) return
    setCloseBusy(true)
    setOperationError('')
    try {
      if (operation.mode === 'close') {
        const result = await closeFiscalPeriod(supabase, company.id, operation.period.id, memo)
        setCompletedWarnings(result.warnings)
        toast.success('会計期間を確定しました')
      } else {
        await reopenFiscalPeriod(supabase, company.id, operation.period.id, memo)
        toast.success('会計期間の確定を解除しました')
      }
      setOperation(null)
      await refreshList()
      refresh()
    } catch (e) {
      setOperationError(e instanceof Error ? e.message : '会計期間の操作に失敗しました')
    } finally { setCloseBusy(false) }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>会計期間管理</CardTitle>
        </CardHeader>
        <CardContent>
          {operationError && !operation && <p role="alert" className="text-destructive whitespace-pre-wrap mb-3">{operationError}</p>}
          {completedWarnings.length > 0 && <div className="mb-3 text-sm"><p>確定時の注意事項</p><ul className="list-disc pl-5">{completedWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">期間名</th>
                <th className="py-2 pr-4 font-medium">開始日</th>
                <th className="py-2 pr-4 font-medium">終了日</th>
                <th className="py-2 pr-4 font-medium">現在期</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {periods.map(p => {
                const actions = getPeriodCloseActions(p, periods)
                const closed = isPeriodClosed(p)
                const action = closed ? actions.reopen : actions.close
                return (
                <tr key={p.id} className="border-b">
                  <td className="py-2 pr-4">{p.name} {closed && <Badge variant="secondary">確定済み</Badge>}</td>
                  <td className="py-2 pr-4">{p.start_date}</td>
                  <td className="py-2 pr-4">{p.end_date}</td>
                  <td className="py-2 pr-4">
                    <input
                      type="radio"
                      name="currentPeriod"
                      checked={p.is_current}
                      onChange={() => handleSetCurrent(p.id)}
                      disabled={isPending}
                      className="cursor-pointer"
                    />
                  </td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleEdit(p)}>
                        編集
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={closed || p.is_current || p.end_date !== latestEndDate || closeBusy}
                        onClick={() => handleDelete(p)}
                      >
                        削除
                      </Button>
                      <div>
                        <Button size="sm" variant="outline" disabled={!action.enabled || closeBusy || isPending}
                          title={action.reason ?? undefined} onClick={() => void prepareOperation(p, closed ? 'reopen' : 'close')}>
                          {closed ? '解除' : '確定'}
                        </Button>
                        {action.reason && <p className="text-xs text-muted-foreground mt-1">{action.reason}</p>}
                      </div>
                    </div>
                  </td>
                </tr>
              )})}
              {periods.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-muted-foreground">
                    会計期間が登録されていません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="mt-4">
            <Button variant="outline" onClick={handleAdd}>
              + 期間を追加
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            ※ 現在期を変更すると仕訳入力の年がその期に合わせて自動入力されます
          </p>
        </CardContent>
      </Card>
      <FiscalPeriodModal
        mode={editTarget ? 'edit' : 'create'}
        period={editTarget}
        existingPeriods={periods}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSuccess={refreshList}
      />
      <Dialog open={operation !== null} onOpenChange={open => { if (!open && !closeBusy) setOperation(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{operation?.period.name}の{operation?.mode === 'close' ? '確定' : '確定を解除'}</DialogTitle>
            <DialogDescription>{operation?.mode === 'close'
              ? '確定すると、この期の仕訳・期首残高などを変更できなくなります。確認結果を確認してください。'
              : 'この期以降の数字が動かせるようになります。確定を解除しますか？'}</DialogDescription>
          </DialogHeader>
          {operation?.mode === 'close' && <div className="space-y-3 text-sm" aria-live="polite">
            {!check && !operationError && <p>確定前チェックを確認中です…</p>}
            {check?.closed && <p role="alert">この期は既に確定されています。一覧を再読み込みしてください。</p>}
            {check && <>
              <div><p className="font-medium">確定できない理由</p>{check.errors.length ? <ul className="list-disc pl-5 text-destructive">{check.errors.map((error, index) => <li key={index}>{error}</li>)}</ul> : <p>ありません</p>}</div>
              <div><p className="font-medium">注意事項</p>{check.warnings.length ? <ul className="list-disc pl-5">{check.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : <p>ありません</p>}</div>
            </>}
          </div>}
          {operationError && <p role="alert" className="text-destructive text-sm whitespace-pre-wrap">{operationError}</p>}
          <label className="text-sm">メモ（任意）<Input value={memo} disabled={closeBusy} onChange={event => setMemo(event.target.value)} /></label>
          <DialogFooter>
            <Button variant="outline" disabled={closeBusy} onClick={() => setOperation(null)}>キャンセル</Button>
            <Button onClick={() => void confirmOperation()} disabled={closeBusy || (operation?.mode === 'close' && (!check || check.closed || check.errors.length > 0))}>
              {closeBusy ? '確認・処理中…' : operation?.mode === 'close' ? 'この期を確定する' : 'この期の確定を解除する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
