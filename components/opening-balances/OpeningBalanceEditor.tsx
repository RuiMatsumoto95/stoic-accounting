'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/lib/toast'
import { registerDirtyChecker } from '@/lib/company-dirty'
import { buildOpeningRows, buildOpeningLines, convertOpeningBalance, fetchOpeningBalanceState, openingInputValues,
  openingDifferences, openingTotals, openingSaveDecision, saveOpeningBalances, clearOpeningBalances, type OpeningBalanceState, type OpeningLine } from '@/lib/opening-balances'

function formatAmount(value: string): string {
  const [integer, fraction] = value.split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction && fraction !== '00' ? `${grouped}.${fraction}` : grouped
}

type Props = { companyId: string; periodId: string; isFirstPeriod: boolean; readOnly?: boolean; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void }

export default function OpeningBalanceEditor({ companyId, periodId, isFirstPeriod, onDirtyChange, onBusyChange, readOnly = false }: Props) {
  const toast = useToast()
  const [state, setState] = useState<OpeningBalanceState | null>(null)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [memo, setMemo] = useState('')
  const [starting, setStarting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submitting = useRef(false)
  const mounted = useRef(true)
  const [pendingSave, setPendingSave] = useState<{ lines: OpeningLine[]; memo: string } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const applyState = useCallback((next: OpeningBalanceState) => {
    if (next.companyId !== companyId) throw new Error('選択した会計期間の会社が一致しません')
    setState(next)
    setInputs(openingInputValues(next.accounts, next.manualSet ? next.manualLines : next.derivedLines))
    setMemo(next.manualSet?.memo ?? '')
    setStarting(false)
    setErrors({})
  }, [companyId])

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    async function load() {
      try {
        const next = await fetchOpeningBalanceState(periodId)
        if (!cancelled) applyState(next)
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : '期首残高を取得できませんでした') }
      finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true; mounted.current = false }
  }, [periodId, applyState])

  const editing = !!state?.manualSet || starting
  const initialInputs = state ? openingInputValues(state.accounts, state.manualSet ? state.manualLines : state.derivedLines) : {}
  const dirty = starting || (editing && (memo !== (state?.manualSet?.memo ?? '') || Object.keys(inputs).some(id => inputs[id] !== initialInputs[id])))
  useEffect(() => registerDirtyChecker(() => dirty), [dirty])
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  const busy = isSubmitting || !!pendingSave || confirmClear
  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])

  async function persist(lines: OpeningLine[], saveMemo: string, autoBalance: boolean) {
    if (readOnly) return
    if (submitting.current) return
    submitting.current = true
    setIsSubmitting(true)
    setError('')
    setPendingSave(null)
    try {
      await saveOpeningBalances({ companyId, periodId, lines, memo: saveMemo, autoBalance })
      const next = await fetchOpeningBalanceState(periodId)
      if (mounted.current) { applyState(next); toast.success('期首残高を保存しました') }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '期首残高の保存に失敗しました') }
    finally { submitting.current = false; if (mounted.current) setIsSubmitting(false) }
  }

  function requestSave() {
    if (readOnly) return
    if (!state || busy || submitting.current) return
    const result = buildOpeningLines(state.accounts, inputs)
    setErrors(result.errors)
    setError('')
    const decision = openingSaveDecision(result.valid, result.lines)
    if (decision === 'invalid') return
    if (decision === 'confirm') setPendingSave({ lines: result.lines, memo })
    else void persist(result.lines, memo, false)
  }

  async function clear() {
    if (readOnly) return
    if (submitting.current) return
    submitting.current = true
    setIsSubmitting(true)
    setConfirmClear(false)
    setError('')
    try {
      await clearOpeningBalances({ companyId, periodId })
      const next = await fetchOpeningBalanceState(periodId)
      if (mounted.current) { applyState(next); toast.success('手動設定を解除しました') }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '手動設定の解除に失敗しました') }
    finally { submitting.current = false; if (mounted.current) setIsSubmitting(false) }
  }

  if (loading) return <p>期首残高を読み込み中です</p>
  if (!state) return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  const built = buildOpeningLines(state.accounts, inputs)
  const displayedLines = editing ? built.lines : state.derivedLines
  const totals = openingTotals(displayedLines)
  const differences = openingDifferences(displayedLines, state.derivedLines)
  const derivedInputs = openingInputValues(state.accounts, state.derivedLines)
  const groups = buildOpeningRows(state.accounts, state.kind)
  const carryName = state.carryForwardAccountName ?? (state.kind === 'INDIVIDUAL' ? '元入金' : '繰越先（未設定）')

  return <section className="space-y-4" aria-label="期首残高の設定">
    <div className="flex flex-wrap items-center gap-3">
      <strong className="rounded bg-muted px-3 py-1">{state.manualSet ? '手動設定中' : starting ? '手動設定を編集中（未保存）' : '前期から自動'}</strong>
      {!editing && <Button disabled={readOnly} onClick={() => { if (!readOnly) { setStarting(true); setError('') } }}>手動設定を開始</Button>}
      {starting && <Button variant="outline" disabled={busy} onClick={() => { applyState(state); setError('') }}>やめる</Button>}
      {state.manualSet && <Button variant="outline" disabled={busy || readOnly} onClick={() => setConfirmClear(true)}>手動設定を解除</Button>}
    </div>
    {!editing && isFirstPeriod && <p className="text-sm">最初の期です。開始残高を入力する場合は「手動設定を開始」を押してください</p>}
    {starting && <p className="text-sm">保存すると、この期の期首残高が手動設定になり、前期の変更では自動更新されなくなります。</p>}
    {state.kind === 'INDIVIDUAL' && <p className="text-sm">事業主貸・事業主借は、期首の計算で元入金に含まれます</p>}
    {state.manualSet && <p className="text-sm font-medium">導出値との差のある科目: {differences.count}件</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <p className="text-sm text-muted-foreground">資産・負債・純資産とも通常の残高は正で入力します。親科目の行は「補助科目に分けない残高」です。</p>
    <div className="overflow-x-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>科目コード</TableHead><TableHead>科目名</TableHead><TableHead>貸借区分</TableHead>
          <TableHead className="text-right">{editing ? '手動設定値' : '期首残高（自動）'}</TableHead>
          {state.manualSet && <><TableHead className="text-right">前期末からの導出値（参考）</TableHead><TableHead className="text-right">差</TableHead></>}
        </TableRow></TableHeader>
        <TableBody>{groups.map(group => <OpeningGroup key={group.category} label={group.label} columns={state.manualSet ? 6 : 4}>
          {group.rows.map(account => {
            const rawDiff = differences.byAccount.get(account.id) ?? '0.00'
            const changed = !!state.manualSet && rawDiff !== '0.00'
            return <TableRow key={account.id} className={changed ? 'bg-amber-50 dark:bg-amber-950/30' : ''}>
              <TableCell>{account.code}</TableCell>
              <TableCell style={{ paddingLeft: `${16 + account.depth * 20}px` }}>{account.name}</TableCell>
              <TableCell>{normalizeSide(account.type)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {editing ? <><Input type="text" inputMode="decimal" className="min-w-36 text-right" aria-label={`${account.code} ${account.name}の手動設定値`} aria-invalid={!!errors[account.id]}
                  aria-describedby={errors[account.id] ? `error-${account.id}` : undefined} disabled={busy || readOnly} value={inputs[account.id] ?? ''} onFocus={event => event.target.select()}
                  onChange={event => { setInputs(previous => ({ ...previous, [account.id]: event.target.value })); setErrors(previous => { const next = { ...previous }; delete next[account.id]; return next }) }} />
                  {errors[account.id] && <p id={`error-${account.id}`} role="alert" className="text-destructive text-sm">{errors[account.id]}</p>}</> : formatAmount(inputs[account.id] ?? '0.00')}
              </TableCell>
              {state.manualSet && <><TableCell className="text-right tabular-nums">{formatAmount(derivedInputs[account.id] ?? '0.00')}</TableCell>
                <TableCell className="text-right tabular-nums">{formatAmount(convertOpeningBalance(rawDiff, account.type))}</TableCell></>}
            </TableRow>
          })}
        </OpeningGroup>)}</TableBody>
      </Table>
    </div>
    <dl className="flex flex-wrap gap-6 rounded border p-4 text-sm tabular-nums">
      <div><dt>借方残高合計</dt><dd>¥{formatAmount(totals.debit)}</dd></div>
      <div><dt>貸方残高合計</dt><dd>¥{formatAmount(totals.credit)}</dd></div>
      <div><dt>貸借バランス（差額）</dt><dd className={totals.balanced ? '' : 'text-destructive'}>¥{formatAmount(totals.difference)}</dd></div>
    </dl>
    {editing && !built.valid && <p className="text-sm text-destructive">入力に誤りがあります。合計は正しい形式の行だけで計算しています。</p>}
    {editing && <>
      {/* UIの無効化は案内のため。DBのガードが最終防御となる。 */}
      <label className="block text-sm">メモ<Input className="mt-1" value={memo} disabled={busy || readOnly} onChange={event => setMemo(event.target.value)} /></label>
      <Button disabled={busy || readOnly} onClick={requestSave}>{isSubmitting ? '処理中…' : '保存'}</Button>
    </>}
    <Dialog open={!!pendingSave} onOpenChange={open => { if (!open) setPendingSave(null) }}>
      <DialogContent><DialogHeader><DialogTitle>貸借バランスの確認</DialogTitle>
        <DialogDescription>貸借バランスの差額（¥{formatAmount(pendingSave ? openingTotals(pendingSave.lines).difference : '0.00')}）を「{carryName}」に集計します。よろしいですか？</DialogDescription>
      </DialogHeader><DialogFooter><Button variant="outline" onClick={() => setPendingSave(null)}>キャンセル</Button><Button disabled={readOnly} onClick={() => { if (pendingSave) void persist(pendingSave.lines, pendingSave.memo, true) }}>OK</Button></DialogFooter></DialogContent>
    </Dialog>
    <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
      <DialogContent><DialogHeader><DialogTitle>手動設定を解除</DialogTitle>
        <DialogDescription>手動設定を解除すると、前期末からの自動計算に戻ります。入力した金額は残りません。</DialogDescription>
      </DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmClear(false)}>キャンセル</Button><Button disabled={readOnly} onClick={() => void clear()}>OK</Button></DialogFooter></DialogContent>
    </Dialog>
  </section>
}

function normalizeSide(type: string) { return type === 'ASSET' ? '借方科目' : '貸方科目' }
function OpeningGroup({ label, columns, children }: { label: string; columns: number; children: React.ReactNode }) {
  return <><TableRow className="bg-muted"><TableCell colSpan={columns} className="font-semibold">{label}</TableCell></TableRow>{children}</>
}
