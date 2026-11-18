'use client'

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { createJournalEntry, amountToRpcString } from '@/lib/journal-save'
import { JOURNAL_GRID_STYLE, journalCellStyle, journalFragmentStyle, type NavCol } from './journal-grid'
import styles from './journal-grid.module.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { JournalEntryWithLines } from './JournalForm'
import { Account } from './JournalLineRow'
import DateInput, { type DateInputStatusHandle } from './DateInput'
import AccountCombobox from './AccountCombobox'
import { useCompany } from '@/contexts/CompanyContext'
import { useCurrentPeriod } from '@/contexts/FiscalPeriodContext'
import { resolveYearFromMonth } from '@/lib/fiscal-period'
import { isPeriodClosed } from '@/lib/period-close-state'
import { TaxCode, TaxMethod, filterTaxCodes } from '@/lib/tax-codes'
import { useToast } from '@/lib/toast'
import { isAppError } from '@/lib/errors'
import { getInlineFormNavigateUpColumn } from '@/lib/inline-form-navigation'
import { applyImeFreeAmountKey } from '@/lib/ime-free-input'
import { isImeInput } from '@/lib/account-combobox-input'
import { syncAmounts, type AmountSnapshot } from '@/lib/amount-sync'
import type { InlineDraft, InlineLine } from '@/lib/journal-duplicate'
import { registerDirtyChecker } from '@/lib/company-dirty'

const DEFAULT_INLINE_LINES = (): InlineLine[] => [
  { side: 'DEBIT',  account_id: '', sub_account_id: '', amount: '', tax_code: '' },
  { side: 'CREDIT', account_id: '', sub_account_id: '', amount: '', tax_code: '' },
]

export type InlineJournalFormHandle = {
  focusDate: () => void
  addDebit: () => void
  addCredit: () => void
  submit: () => void
  clear: () => void
}

type Props = {
  accounts: Account[]
  allTaxCodes: TaxCode[]
  taxMethod: TaxMethod
  onNewAdd: (entry: JournalEntryWithLines) => void
  onNewCommit: (tempId: string, realEntry: JournalEntryWithLines) => void
  onNewRollback: (tempId: string) => void
  onNavigateUp?: (col: NavCol) => void
  duplicateRequest?: { seq: number; draft: InlineDraft } | null
  onDuplicateApplied?: (seq: number) => void
}

const InlineJournalForm = forwardRef<InlineJournalFormHandle, Props>(
  function InlineJournalForm({ accounts, allTaxCodes, taxMethod, onNewAdd, onNewCommit, onNewRollback, onNavigateUp, duplicateRequest, onDuplicateApplied }, ref) {
    const company = useCompany()
    const { period } = useCurrentPeriod()
    const toast = useToast()

    const [date, setDate] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [lines, setLines] = useState<InlineLine[]>(DEFAULT_INLINE_LINES())
    const [description, setDescription] = useState('')
    const [supplement, setSupplement] = useState('')
    const [errorMessage, setErrorMessage] = useState('')
    const [pendingFocus, setPendingFocus] = useState<{
      side: 'DEBIT' | 'CREDIT'
      rowIndex: number
    } | null>(null)

    const amountReplaceAll = useRef(false)
    const amountSnapshot = useRef<AmountSnapshot | null>(null)
    const appliedSeqRef = useRef<number | null>(null)
    const dateInputRef = useRef<HTMLInputElement>(null)
    const dateStatusRef = useRef<DateInputStatusHandle>(null)
    const debitAccountRefs = useRef<(HTMLInputElement | null)[]>([])
    const creditAccountRefs = useRef<(HTMLInputElement | null)[]>([])

    const getDefaultDate = useCallback((): string => {
      const today = new Date()
      const month = today.getMonth() + 1
      const year = period ? resolveYearFromMonth(month, period) : today.getFullYear()
      return `${year}-${String(month).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    }, [period])

    useEffect(() => registerDirtyChecker(() => isSubmitting || description !== '' || supplement !== '' ||
      (date !== '' && date !== getDefaultDate()) || lines.length !== 2 ||
      lines.some(line => Boolean(line.account_id || line.sub_account_id || line.amount || line.tax_code)),
    ), [isSubmitting, description, supplement, date, lines, getDefaultDate])

    useEffect(() => {
      setDate(getDefaultDate())
    }, [getDefaultDate])

    // マウント時に複製元の日付を既定の日付で上書きしないよう、既定の日付の effect より後に置く。
    useEffect(() => {
      if (!duplicateRequest || appliedSeqRef.current === duplicateRequest.seq) return
      const { seq, draft } = duplicateRequest
      appliedSeqRef.current = seq
      amountSnapshot.current = null
      amountReplaceAll.current = false
      setPendingFocus(null)
      setErrorMessage('')
      setDate(draft.date)
      setLines(draft.lines)
      setDescription(draft.description)
      setSupplement(draft.supplement)
      dateInputRef.current?.focus()
      onDuplicateApplied?.(seq)
    }, [duplicateRequest, onDuplicateApplied])

    // 行追加後に新しい行の科目欄へフォーカスを移動する
    useEffect(() => {
      if (!pendingFocus) return
      const refs = pendingFocus.side === 'DEBIT'
        ? debitAccountRefs.current
        : creditAccountRefs.current
      refs[pendingFocus.rowIndex]?.focus()
      setPendingFocus(null)
    }, [lines, pendingFocus])

    const parentAccounts = accounts.filter(a => a.parent_id === null)

    const debitEntries = lines
      .map((line, idx) => ({ line, idx }))
      .filter(x => x.line.side === 'DEBIT')

    const creditEntries = lines
      .map((line, idx) => ({ line, idx }))
      .filter(x => x.line.side === 'CREDIT')

    const updateLine = (idx: number, updates: Partial<InlineLine>) => {
      setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...updates } : l))
    }

    const syncCurrentAmounts = () => {
      const syncedLines = syncAmounts(lines, amountSnapshot.current)
      if (syncedLines !== lines) setLines(syncedLines)
      // 保存の入力チェックで止まった後も、同じ欄で続けて編集できるよう基準を進める。
      if (syncedLines !== lines && amountSnapshot.current) {
        const source = syncedLines.find(line => line.side === amountSnapshot.current?.side)
        if (source) amountSnapshot.current = { side: source.side, value: source.amount }
      }
      return syncedLines
    }

    const handleAmountFocus = (e: React.FocusEvent<HTMLInputElement>, idx: number) => {
      amountSnapshot.current = { side: lines[idx].side, value: e.currentTarget.value }
      amountReplaceAll.current = e.currentTarget.value !== ''
      if (amountReplaceAll.current) e.currentTarget.select()
    }

    const handleAmountBlur = () => {
      syncCurrentAmounts()
      amountSnapshot.current = null
      amountReplaceAll.current = false
    }

    const handleAmountKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number, clearOnEscape = false) => {
      const nextText = applyImeFreeAmountKey(e.currentTarget.value, e.nativeEvent, amountReplaceAll.current)
      if (nextText !== null) {
        e.preventDefault()
        amountReplaceAll.current = false
        updateLine(idx, { amount: nextText })
        e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)
      } else if (e.key === 'Enter' && !isImeInput(e.nativeEvent)) {
        e.preventDefault()
        handleSubmit()
      } else if (clearOnEscape && e.key === 'Escape' && !e.nativeEvent.isComposing) {
        e.preventDefault()
        handleClear()
      }
    }

    const removeLine = (idx: number) => {
      amountSnapshot.current = null
      setLines(prev => prev.filter((_, i) => i !== idx))
    }

    const addDebitLine = () => {
      amountSnapshot.current = null
      const nextIndex = debitEntries.length
      setLines(prev => [
        ...prev,
        { side: 'DEBIT', account_id: '', sub_account_id: '', amount: '', tax_code: '' },
      ])
      setPendingFocus({ side: 'DEBIT', rowIndex: nextIndex })
    }

    const addCreditLine = () => {
      amountSnapshot.current = null
      const nextIndex = creditEntries.length
      setLines(prev => [
        ...prev,
        { side: 'CREDIT', account_id: '', sub_account_id: '', amount: '', tax_code: '' },
      ])
      setPendingFocus({ side: 'CREDIT', rowIndex: nextIndex })
    }

    const handleClear = () => {
      amountSnapshot.current = null
      setDate(getDefaultDate())
      setLines(DEFAULT_INLINE_LINES())
      setDescription('')
      setSupplement('')
      setErrorMessage('')
      dateInputRef.current?.focus()
    }

    const buildEntry = (
      id: string,
      entryDate: string,
      entryDesc: string,
      entryLines: InlineLine[],
      entrySupplement: string,
      referenceNumber: number | null = null
    ): JournalEntryWithLines => ({
      id,
      date: entryDate,
      description: entryDesc,
      reference_number: referenceNumber,
      referenceNumberPending: referenceNumber === null,
      supplement: entrySupplement || null,
      is_opening_balance: false,
      journal_lines: entryLines.map((l, i) => {
        const effectiveId = l.sub_account_id || l.account_id
        const acc = accounts.find(a => a.id === effectiveId)
        return {
          id: `${id}-${i + 1}`,
          line_number: i + 1,
          side: l.side,
          account_id: effectiveId,
          amount: parseFloat(l.amount),
          tax_code: l.tax_code || null,
          description: null,
          accounts: acc ? { id: acc.id, name: acc.name, parent_id: acc.parent_id } : null,
        }
      }),
    })

    const handleSubmit = async () => {
      if (isPeriodClosed(period)) { setErrorMessage('この期は確定済みです。設定画面で確定を解除してください。'); return }
      if (isSubmitting) return
      const syncedLines = syncCurrentAmounts()
      const syncedDebitTotal = syncedLines.filter(l => l.side === 'DEBIT')
        .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0)
      const syncedCreditTotal = syncedLines.filter(l => l.side === 'CREDIT')
        .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0)
      setErrorMessage('')

      if (!date) {
        setErrorMessage('日付を入力してください。')
        return
      }
      if (syncedLines.some(l => !l.account_id)) {
        setErrorMessage('すべての行に勘定科目を選択してください。')
        return
      }
      if (syncedLines.some(l => !l.amount || parseFloat(l.amount) <= 0)) {
        setErrorMessage('すべての行に金額を入力してください。')
        return
      }
      if (syncedDebitTotal !== syncedCreditTotal) {
        setErrorMessage('借方合計と貸方合計が一致していません。')
        return
      }
      if (!period) {
        setErrorMessage('現在の会計期間が設定されていません。')
        return
      }
      // 保存前にフォームをリセットするため、DB に送れない金額（小数第3位以下など）は先に弾く
      try {
        syncedLines.forEach((l, i) => amountToRpcString(l.amount, i + 1))
      } catch (e) {
        setErrorMessage(isAppError(e) ? e.message : '金額が不正です。')
        return
      }

      const savedPeriodId = period.id
      const tempId = crypto.randomUUID()
      const savedDate = date
      const savedDesc = description
      const savedSupplement = supplement
      const savedLines = syncedLines

      onNewAdd(buildEntry(tempId, savedDate, savedDesc, savedLines, savedSupplement))

      amountSnapshot.current = null
      setDate(getDefaultDate())
      setLines(DEFAULT_INLINE_LINES())
      setDescription('')
      setSupplement('')
      setErrorMessage('')
      dateInputRef.current?.focus()
      setIsSubmitting(true)

      try {
        // ヘッダー・明細を DB 関数で1トランザクションに保存する
        const created = await createJournalEntry({
            companyId: company.id,
          periodId: savedPeriodId,
          date: savedDate,
          description: savedDesc,
          supplement: savedSupplement,
          referenceNumber: null,
          lines: savedLines.map(l => ({
            side: l.side,
            account_id: l.sub_account_id || l.account_id,
            amount: l.amount,
            tax_code: l.tax_code,
          })),
        })

        onNewCommit(tempId, buildEntry(created.id, savedDate, savedDesc, savedLines, savedSupplement, created.referenceNumber))
      } catch (e) {
        console.error(e)
        onNewRollback(tempId)
        toast.error(isAppError(e) ? e.message : '保存に失敗しました。再度お試しください。')
      } finally {
        setIsSubmitting(false)
      }
    }

    const handleDescriptionKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !isImeInput(e.nativeEvent)) {
        e.preventDefault()
        handleSubmit()
      }
      if (e.key === 'Escape' && !isImeInput(e.nativeEvent)) {
        e.preventDefault()
        handleClear()
      }
    }

    const handleNavigateUp = (field: NavCol) => (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!onNavigateUp) return
      const hasPendingDateInput = field === 'date' && (
        dateStatusRef.current?.hasPendingInput() || dateInputRef.current?.validity.badInput || false
      )
      const col = getInlineFormNavigateUpColumn(field, 0, e.nativeEvent, hasPendingDateInput)
      if (!col) return
      // 科目候補が開いていれば子が stopPropagation する。閉じた科目欄の
      // preventDefault 済みの ↑ はここでも受け取り、金額の増加も抑止する。
      e.preventDefault()
      onNavigateUp(col)
    }

    useImperativeHandle(ref, () => ({
      focusDate: () => dateInputRef.current?.focus(),
      addDebit: addDebitLine,
      addCredit: addCreditLine,
      submit: handleSubmit,
      clear: handleClear,
    }), [addDebitLine, addCreditLine, handleSubmit, handleClear]) // eslint-disable-line react-hooks/exhaustive-deps

    const cell = styles.inputCell
    const displayRowCount = Math.max(debitEntries.length, creditEntries.length, 1)

    const d0 = debitEntries[0]
    const c0 = creditEntries[0]

    const debitSubAccounts  = d0 ? accounts.filter(a => a.parent_id === d0.line.account_id) : []
    const creditSubAccounts = c0 ? accounts.filter(a => a.parent_id === c0.line.account_id) : []

    const availableTaxCodes = filterTaxCodes(allTaxCodes, taxMethod)

    return (
      // UIは案内のために無効化する。確定状態が変わった場合もDBが最終防御となる。
      <fieldset disabled={isPeriodClosed(period)} role="rowgroup" className={`min-w-0 border-0 p-0 m-0 ${styles.grid} ${styles.editEntry} ${styles.editRow} ${styles.inlineForm}`} style={{ ...JOURNAL_GRID_STYLE, ...journalFragmentStyle(displayRowCount) }}>
        <div role="row" className={styles.row}>
          <div role="cell" className={cell} style={journalCellStyle('date', 0)} onKeyDown={handleNavigateUp('date')}>
            {period ? (
              <DateInput
                imeFree
                ref={dateInputRef}
                statusRef={dateStatusRef}
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
                className="w-full"
              />
            )}
          </div>
          <div role="cell" className={cell} style={journalCellStyle('slip_number', 0)}></div>
          <div role="cell" className={cell} style={journalCellStyle('debit_account', 0)} onKeyDown={handleNavigateUp('debit_account')}>
            {d0 && (
              <AccountCombobox
                imeFree
                ref={(el) => { debitAccountRefs.current[0] = el }}
                accounts={parentAccounts}
                value={d0.line.account_id}
                onChange={(id) => updateLine(d0.idx, { account_id: id, sub_account_id: '' })}
              />
            )}
          </div>
          <div role="cell" className={cell} style={journalCellStyle('debit_sub', 0)}>
            {d0 && debitSubAccounts.length > 0 && (
              <AccountCombobox
                imeFree
                accounts={debitSubAccounts}
                value={d0.line.sub_account_id}
                onChange={(id) => updateLine(d0.idx, { sub_account_id: id })}
                showCode={false}
                placeholder="補助科目"
              />
            )}
          </div>
          <div role="cell" className={cell} style={journalCellStyle('debit_amount', 0)} onKeyDown={handleNavigateUp('debit_amount')}>
            {d0 && (
              <input
                type="text"
                readOnly
                className="w-full border rounded text-right bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                value={d0.line.amount}
                onFocus={e => handleAmountFocus(e, d0.idx)}
                onBlur={handleAmountBlur}
                onKeyDown={e => handleAmountKeyDown(e, d0.idx, true)}
                placeholder="0"
              />
            )}
          </div>
          <div role="cell" className={cell} style={journalCellStyle('debit_tax', 0)}>
            {d0 && (
              <Select
                value={d0.line.tax_code || 'NONE'}
                onValueChange={(v) => updateLine(d0.idx, { tax_code: v === 'NONE' ? '' : v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="税区分" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">（なし）</SelectItem>
                  {availableTaxCodes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.short_name ?? t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div role="cell" className={cell} style={journalCellStyle('credit_account', 0)} onKeyDown={handleNavigateUp('credit_account')}>
            {c0 && (
              <AccountCombobox
                imeFree
                ref={(el) => { creditAccountRefs.current[0] = el }}
                accounts={parentAccounts}
                value={c0.line.account_id}
                onChange={(id) => updateLine(c0.idx, { account_id: id, sub_account_id: '' })}
              />
            )}
          </div>
          <div role="cell" className={cell} style={journalCellStyle('credit_sub', 0)}>
            {c0 && creditSubAccounts.length > 0 && (
              <AccountCombobox
                imeFree
                accounts={creditSubAccounts}
                value={c0.line.sub_account_id}
                onChange={(id) => updateLine(c0.idx, { sub_account_id: id })}
                showCode={false}
                placeholder="補助科目"
              />
            )}
          </div>
          <div role="cell" className={cell} style={journalCellStyle('credit_amount', 0)} onKeyDown={handleNavigateUp('credit_amount')}>
            {c0 && (
              <input
                type="text"
                readOnly
                className="w-full border rounded text-right bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                value={c0.line.amount}
                onFocus={e => handleAmountFocus(e, c0.idx)}
                onBlur={handleAmountBlur}
                onKeyDown={e => handleAmountKeyDown(e, c0.idx, true)}
                placeholder="0"
              />
            )}
          </div>
          <div role="cell" className={cell} style={journalCellStyle('credit_tax', 0)}>
            {c0 && (
              <Select
                value={c0.line.tax_code || 'NONE'}
                onValueChange={(v) => updateLine(c0.idx, { tax_code: v === 'NONE' ? '' : v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="税区分" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">（なし）</SelectItem>
                  {availableTaxCodes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.short_name ?? t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        {debitEntries.slice(1).map(({ line, idx }, displayIndex) => (
          <div key={idx} role="row" className={styles.row}>
            <div role="cell" className={`${cell} ${styles.removableAccount}`} style={journalCellStyle('debit_account', displayIndex + 1)}>
              <AccountCombobox
                imeFree
                ref={(el) => { debitAccountRefs.current[displayIndex + 1] = el }}
                accounts={parentAccounts}
                value={line.account_id}
                onChange={(id) => updateLine(idx, { account_id: id, sub_account_id: '' })}
              />
            </div>
            <div role="cell" className={cell} style={journalCellStyle('debit_amount', displayIndex + 1)}>
              <input
                type="text"
                readOnly
                className="w-full border rounded text-right bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                value={line.amount}
                onFocus={e => handleAmountFocus(e, idx)}
                onBlur={handleAmountBlur}
                onKeyDown={e => handleAmountKeyDown(e, idx)}
                placeholder="0"
              />
            </div>
            <div role="cell" className={cell} style={journalCellStyle('debit_tax', displayIndex + 1)}>
              <Select
                value={line.tax_code || 'NONE'}
                onValueChange={(v) => updateLine(idx, { tax_code: v === 'NONE' ? '' : v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="税区分" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">（なし）</SelectItem>
                  {availableTaxCodes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.short_name ?? t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div role="cell" className={`${styles.removeCell} no-print`} style={journalCellStyle('debit_account', displayIndex + 1)}>
              <Button className={styles.actionButton} aria-label="借方行を削除" type="button" size="sm" variant="outline" onClick={() => removeLine(idx)}>×</Button>
            </div>
          </div>
        ))}
        {creditEntries.slice(1).map(({ line, idx }, displayIndex) => (
          <div key={idx} role="row" className={styles.row}>
            <div role="cell" className={`${cell} ${styles.removableAccount}`} style={journalCellStyle('credit_account', displayIndex + 1)}>
              <AccountCombobox
                imeFree
                ref={(el) => { creditAccountRefs.current[displayIndex + 1] = el }}
                accounts={parentAccounts}
                value={line.account_id}
                onChange={(id) => updateLine(idx, { account_id: id, sub_account_id: '' })}
              />
            </div>
            <div role="cell" className={cell} style={journalCellStyle('credit_amount', displayIndex + 1)}>
              <input
                type="text"
                readOnly
                className="w-full border rounded text-right bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                value={line.amount}
                onFocus={e => handleAmountFocus(e, idx)}
                onBlur={handleAmountBlur}
                onKeyDown={e => handleAmountKeyDown(e, idx)}
                placeholder="0"
              />
            </div>
            <div role="cell" className={cell} style={journalCellStyle('credit_tax', displayIndex + 1)}>
              <Select
                value={line.tax_code || 'NONE'}
                onValueChange={(v) => updateLine(idx, { tax_code: v === 'NONE' ? '' : v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="税区分" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">（なし）</SelectItem>
                  {availableTaxCodes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.short_name ?? t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div role="cell" className={`${styles.removeCell} no-print`} style={journalCellStyle('credit_account', displayIndex + 1)}>
              <Button className={styles.actionButton} aria-label="貸方行を削除" type="button" size="sm" variant="outline" onClick={() => removeLine(idx)}>×</Button>
            </div>
          </div>
        ))}
        <div role="row" className={styles.row}>
          <div className={styles.editorSummary} style={journalCellStyle('description')}>
            <div role="cell" className={cell}>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={handleDescriptionKeyDown}
                placeholder="摘要（Enterで保存）"
                className="w-full"
                list="desc-suggestions"
              />
            </div>
            <div role="cell" className={cell}>
              <Input
                value={supplement}
                onChange={e => setSupplement(e.target.value)}
                onKeyDown={handleDescriptionKeyDown}
                aria-label="補足"
                placeholder="補足"
                className="w-full"
              />
            </div>
          </div>
          <div role="cell" className={`${styles.formActions} no-print`} style={journalCellStyle('actions')}>
            <Button className={`${styles.actionButton} ${styles.primaryAction}`} type="button" size="sm" onClick={handleSubmit} disabled={isSubmitting || isPeriodClosed(period)}>
              {isSubmitting ? '保存中...' : '保存'}
            </Button>
            <Button className={styles.actionButton} type="button" size="sm" variant="outline" onClick={handleClear}>クリア</Button>
            <Button className={styles.actionButton} type="button" size="sm" variant="outline" onClick={addDebitLine}>借方+</Button>
            <Button className={styles.actionButton} type="button" size="sm" variant="outline" onClick={addCreditLine}>貸方+</Button>
          </div>
        </div>
        {/* エラーメッセージ行 */}
        {errorMessage && (
          <div role="row" className={styles.row}>
            <div role="cell" style={journalCellStyle('message', displayRowCount + 1)} className="border px-2 py-1 text-red-500 bg-red-50">
              {errorMessage}
            </div>
          </div>
        )}
      </fieldset>
    )
  }
)

export default InlineJournalForm
