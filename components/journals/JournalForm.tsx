'use client'

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { createJournalEntry, updateJournalEntry, amountToRpcString } from '@/lib/journal-save'
import { parseReferenceNumberInput } from '@/lib/reference-number'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import JournalLineRow, { LineState, Account } from './JournalLineRow'
import DateInput from './DateInput'
import { useCompany } from '@/contexts/CompanyContext'
import { useCurrentPeriod } from '@/contexts/FiscalPeriodContext'
import { useDisplaySettings } from '@/contexts/DisplaySettingsContext'
import { resolveYearFromMonth } from '@/lib/fiscal-period'
import { isPeriodClosed } from '@/lib/period-close-state'
import { getTaxMethod, getAllTaxCodes, filterTaxCodes, TaxMethod, TaxCode } from '@/lib/tax-codes'
import { ERROR_CODES, isAppError } from '@/lib/errors'
import { useToast } from '@/lib/toast'
import { registerDirtyChecker } from '@/lib/company-dirty'

const EMPTY_LINE = (): LineState => ({
  side: 'DEBIT',
  account_id: '',
  amount: '',
  tax_code: '',
  description: '',
})

const DEFAULT_LINES = (): LineState[] => [
  { ...EMPTY_LINE(), side: 'DEBIT' },
  { ...EMPTY_LINE(), side: 'CREDIT' },
]

export type JournalEntryWithLines = {
  id: string
  date: string
  description: string
  reference_number: number | null
  // 新規保存中のみ true。番号は予測せず、RPC の確定結果で行ごと置き換える。
  referenceNumberPending?: boolean
  supplement: string | null
  is_opening_balance: boolean
  journal_lines: {
    id: string
    line_number: number
    side: 'DEBIT' | 'CREDIT'
    account_id: string
    amount: number
    tax_code: string | null
    description: string | null
    accounts: {
      id: string
      name: string
      parent_id: string | null
    } | null
  }[]
}

export type JournalFormHandle = {
  submit: () => void
  cancel: () => void
}

type Props = {
  accounts: Account[]
  editTarget: JournalEntryWithLines | null
  duplicateSource?: JournalEntryWithLines | null
  onNewAdd: (entry: JournalEntryWithLines) => void
  onNewCommit: (tempId: string, realEntry: JournalEntryWithLines) => void
  onNewRollback: (tempId: string) => void
  onEditSave: (entry: JournalEntryWithLines) => void
  onDuplicateSubmitted?: () => void
  onCancel: () => void
}

const JournalForm = forwardRef<JournalFormHandle, Props>(
  function JournalForm({
    accounts, editTarget, duplicateSource,
    onNewAdd, onNewCommit, onNewRollback, onEditSave, onDuplicateSubmitted,
    onCancel,
  }, ref) {
    const company = useCompany()
    const { period } = useCurrentPeriod()
    const [displaySettings] = useDisplaySettings()
    const toast = useToast()

    const [date, setDate] = useState('')
    const [description, setDescription] = useState('')
    const [supplement, setSupplement] = useState('')
    const [referenceNumber, setReferenceNumber] = useState('')
    const [lines, setLines] = useState<LineState[]>(DEFAULT_LINES())
    const [isSaving, setIsSaving] = useState(false)
    const [errorMessage, setErrorMessage] = useState('')
    const [taxMethod, setTaxMethod] = useState<TaxMethod>('EXEMPT')
    const [allTaxCodes, setAllTaxCodes] = useState<TaxCode[]>([])
    const dateInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
      Promise.all([getTaxMethod(company.id), getAllTaxCodes()])
        .then(([method, codes]) => { setTaxMethod(method); setAllTaxCodes(codes) })
        .catch(console.error)
    }, [company.id, company.tax_method])

    const getDefaultDate = useCallback((): string => {
      const today = new Date()
      const month = today.getMonth() + 1
      const year = period ? resolveYearFromMonth(month, period) : today.getFullYear()
      return `${year}-${String(month).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    }, [period])

    useEffect(() => {
      if (editTarget) {
        setDate(editTarget.date)
        setDescription(editTarget.description)
        setSupplement(editTarget.supplement ?? '')
        setReferenceNumber(String(editTarget.reference_number ?? ''))
        const sorted = [...editTarget.journal_lines].sort(
          (a, b) => a.line_number - b.line_number
        )
        setLines(
          sorted.map((l) => ({
            side: l.side,
            account_id: l.account_id,
            amount: String(l.amount),
            tax_code: l.tax_code ?? '',
            description: l.description ?? '',
          }))
        )
      } else if (duplicateSource) {
        setDate(duplicateSource.date)
        setDescription(duplicateSource.description)
        setSupplement(duplicateSource.supplement ?? '')
        setReferenceNumber('')
        const sorted = [...duplicateSource.journal_lines].sort(
          (a, b) => a.line_number - b.line_number
        )
        setLines(
          sorted.map((l) => ({
            side: l.side,
            account_id: l.account_id,
            amount: String(l.amount),
            tax_code: l.tax_code ?? '',
            description: l.description ?? '',
          }))
        )
      } else {
        setDate(getDefaultDate())
        setDescription('')
        setSupplement('')
        setReferenceNumber('')
        setLines(DEFAULT_LINES())
      }
      setErrorMessage('')
    }, [editTarget, duplicateSource, getDefaultDate])

    useEffect(() => registerDirtyChecker(() => {
      if (isSaving || duplicateSource) return true
      const originalLines = editTarget
        ? [...editTarget.journal_lines].sort((a, b) => a.line_number - b.line_number).map(line => ({
          side: line.side, account_id: line.account_id, amount: String(line.amount),
          tax_code: line.tax_code ?? '', description: line.description ?? '',
        })) : DEFAULT_LINES()
      return (date !== '' && date !== (editTarget?.date ?? getDefaultDate())) ||
        description !== (editTarget?.description ?? '') || supplement !== (editTarget?.supplement ?? '') ||
        referenceNumber !== String(editTarget?.reference_number ?? '') || JSON.stringify(lines) !== JSON.stringify(originalLines)
    }), [isSaving, duplicateSource, editTarget, date, description, supplement, referenceNumber, lines, getDefaultDate])

    const debitTotal = lines
      .filter((l) => l.side === 'DEBIT')
      .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0)

    const creditTotal = lines
      .filter((l) => l.side === 'CREDIT')
      .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0)

    const isBalanced = debitTotal === creditTotal && debitTotal > 0

    const handleLineChange = (index: number, field: keyof LineState, value: string) => {
      setLines((prev) => {
        const next = [...prev]
        next[index] = { ...next[index], [field]: value }
        return next
      })
    }

    const handleAddLine = () => {
      setLines((prev) => [...prev, EMPTY_LINE()])
    }

    const handleRemoveLine = (index: number) => {
      setLines((prev) => prev.filter((_, i) => i !== index))
    }

    const handleDescriptionKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
        e.preventDefault()
        handleSubmit()
      }
    }

    const buildEntry = (
      id: string,
      isOpeningBalance: boolean,
      entryDate: string,
      entryDesc: string,
      entryRef: number | null,
      entryLines: LineState[],
      entrySupplement: string
    ): JournalEntryWithLines => ({
      id,
      date: entryDate,
      description: entryDesc,
      reference_number: entryRef,
      supplement: entrySupplement || null,
      is_opening_balance: isOpeningBalance,
      journal_lines: entryLines.map((l, i) => {
        const acc = accounts.find(a => a.id === l.account_id)
        return {
          id: `${id}-${i + 1}`,
          line_number: i + 1,
          side: l.side,
          account_id: l.account_id,
          amount: parseFloat(l.amount),
          tax_code: l.tax_code || null,
          description: null,
          accounts: acc ? { id: acc.id, name: acc.name, parent_id: acc.parent_id } : null,
        }
      }),
    })

    const handleSubmit = async () => {
      if (isPeriodClosed(period)) { setErrorMessage('この期は確定済みです。設定画面で確定を解除してください。'); return }
      if (isSaving) return
      setErrorMessage('')

      if (!date) { setErrorMessage('日付を入力してください。'); return }
      if (!description) { setErrorMessage('摘要を入力してください。'); return }
      if (lines.some((l) => !l.account_id)) { setErrorMessage('すべての行に勘定科目を選択してください。'); return }
      if (lines.some((l) => !l.amount || parseFloat(l.amount) <= 0)) { setErrorMessage('すべての行に金額を入力してください。'); return }
      if (!isBalanced) { setErrorMessage('借方合計と貸方合計が一致していません。'); return }
      const parsedReference = parseReferenceNumberInput(referenceNumber)
      if (!parsedReference.ok) { setErrorMessage(parsedReference.message); return }
      // 新規は保存前にフォームをリセットするため、DB に送れない金額（小数第3位以下など）は先に弾く
      try {
        lines.forEach((l, i) => amountToRpcString(l.amount, i + 1))
      } catch (e) {
        setErrorMessage(isAppError(e) ? e.message : '金額が不正です。')
        return
      }

      if (editTarget) {
        if (editTarget.is_opening_balance) {
          setErrorMessage(ERROR_CODES.OPENING_BALANCE_EDIT_FORBIDDEN.message)
          return
        }
        // ── 編集：同期保存 ──────────────────────────────────
        setIsSaving(true)
        try {
          // ヘッダー・明細を DB 関数で1トランザクションに保存する（途中失敗しても明細だけ消えた状態にならない）
          await updateJournalEntry({
            companyId: company.id,
            entryId: editTarget.id,
            date,
            description,
            referenceNumber: parsedReference.value,
            supplement,
            lines,
          })

          const savedEntry = buildEntry(
            editTarget.id, editTarget.is_opening_balance,
            date, description, parsedReference.value ?? editTarget.reference_number, lines, supplement
          )
          onEditSave(savedEntry)
        } catch (e) {
          console.error(e)
          setErrorMessage(isAppError(e) ? e.message : '保存中にエラーが発生しました。')
        } finally {
          setIsSaving(false)
        }

      } else {
        // ── 新規：楽観的更新 ────────────────────────────────
        if (!period) { setErrorMessage('現在の会計期間が設定されていません。'); return }
        const savedPeriodId = period.id
        const tempId = crypto.randomUUID()
        const savedDate = date
        const savedDesc = description
        const savedSupplement = supplement
        const savedRef = parsedReference.value
        const savedLines = [...lines]

        // ① 即時stateに追加
        const optimisticEntry = {
          ...buildEntry(tempId, false, savedDate, savedDesc, null, savedLines, savedSupplement),
          referenceNumberPending: true,
        }
        onNewAdd(optimisticEntry)
        if (duplicateSource) onDuplicateSubmitted?.()

        // ② 複製は直後に閉じるため、新規モードだけフォームリセット・日付にフォーカス
        if (!duplicateSource) {
          setDate(getDefaultDate())
          setDescription('')
          setSupplement('')
          setReferenceNumber('')
          setLines(DEFAULT_LINES())
          setErrorMessage('')
          dateInputRef.current?.focus()
        }

        // ③ バックグラウンドでDB保存
        try {
          const created = await createJournalEntry({
            companyId: company.id,
            periodId: savedPeriodId,
            date: savedDate,
            description: savedDesc,
            supplement: savedSupplement,
            referenceNumber: savedRef,
            lines: savedLines,
          })

          // ④ 仮IDを本物のIDに差し替え
          const realEntry = buildEntry(created.id, false, savedDate, savedDesc, created.referenceNumber, savedLines, savedSupplement)
          onNewCommit(tempId, realEntry)

        } catch (e) {
          console.error(e)
          // ⑤ 失敗時：楽観的追加をロールバック
          onNewRollback(tempId)
          const msg = isAppError(e) ? e.message : '保存に失敗しました。再度お試しください。'
          toast.error(msg)
          setErrorMessage(msg)
        }
      }
    }

    useImperativeHandle(ref, () => ({
      submit: handleSubmit,
      cancel: onCancel,
    }), [handleSubmit, onCancel]) // eslint-disable-line react-hooks/exhaustive-deps

    return (
      // 入力無効化は案内のため。別タブ等の競合に対してはDBのガードが最終防御となる。
      <fieldset disabled={isPeriodClosed(period)} className="min-w-0">
      <div
        className="border rounded-lg p-4 mb-6"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            onCancel()
          }
        }}
      >
        <h2 className="text-lg font-semibold mb-4">
          {editTarget ? '仕訳を編集' : duplicateSource ? '仕訳を複製' : '新規仕訳入力'}
        </h2>

        {/* ヘッダーエリア：日付 → 伝票番号 */}
        <div className="flex gap-4 mb-4">
          <div>
            <Label>日付</Label>
            {period ? (
              <DateInput
                ref={dateInputRef}
                value={date}
                onChange={setDate}
                period={period}
              />
            ) : (
              <Input
                ref={dateInputRef}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-36"
              />
            )}
          </div>
          <div>
            <Label>伝票番号</Label>
            <Input
              type="text"
              placeholder={editTarget ? '空欄で変更なし' : '空欄で自動採番'}
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              className="w-32"
            />
          </div>
        </div>

        {/* 明細エリア */}
        <div className="overflow-x-auto mb-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="p-1">区分</th>
                <th className="p-1">勘定科目</th>
                {displaySettings.showSubAccount && <th className="p-1">補助科目</th>}
                <th className="p-1 text-right">金額</th>
                {displaySettings.showTaxClass && <th className="p-1">税区分</th>}
                <th className="p-1"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <JournalLineRow
                  key={i}
                  index={i}
                  line={line}
                  accounts={accounts}
                  taxcodes={filterTaxCodes(
                    allTaxCodes,
                    taxMethod,
                    line.side === 'DEBIT' ? 'PURCHASE' : 'SALES'
                  )}
                  onChange={handleLineChange}
                  onRemove={handleRemoveLine}
                  canRemove={lines.length > 2}
                  showSubAccount={displaySettings.showSubAccount}
                  showTaxClass={displaySettings.showTaxClass}
                />
              ))}
            </tbody>
          </table>
        </div>

        <Button type="button" variant="outline" size="sm" onClick={handleAddLine} className="mb-4">
          ＋ 行を追加
        </Button>

        {/* 摘要 */}
        <div className="mb-4">
          <Label>摘要</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={handleDescriptionKeyDown}
            placeholder="摘要を入力（Enterで保存）"
            className="w-full"
            list="desc-suggestions"
          />
        </div>

        <div className="mb-4">
          <Label htmlFor="journal-supplement">補足</Label>
          <Input
            id="journal-supplement"
            value={supplement}
            onChange={(e) => setSupplement(e.target.value)}
            onKeyDown={handleDescriptionKeyDown}
            placeholder="補足"
            className="w-full"
          />
        </div>

        {/* 合計表示 */}
        <div className={`text-sm mb-4 ${isBalanced ? 'text-green-600' : 'text-red-500'}`}>
          借方合計：{debitTotal.toLocaleString()}
          貸方合計：{creditTotal.toLocaleString()}
          {isBalanced ? '✓ バランスしています' : `✗ 差額：${Math.abs(debitTotal - creditTotal).toLocaleString()}`}
        </div>

        {errorMessage && (
          <div className="text-red-500 text-sm mb-4">{errorMessage}</div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleSubmit} disabled={isSaving || isPeriodClosed(period)}>
            {isSaving ? '保存中...' : editTarget ? '保存' : duplicateSource ? '複製して保存' : '確定保存'}
          </Button>
          <Button variant="outline" onClick={onCancel}>
            キャンセル
          </Button>
        </div>
      </div>
      </fieldset>
    )
  }
)

export default JournalForm
