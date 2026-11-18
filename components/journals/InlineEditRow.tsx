'use client'

import { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { JournalEntryWithLines } from './JournalForm'
import { Account } from './JournalLineRow'
import AccountCombobox from './AccountCombobox'
import DateInput, { type DateInputHandle } from './DateInput'
import { JOURNAL_GRID_STYLE, journalCellStyle, journalFragmentStyle } from './journal-grid'
import styles from './journal-grid.module.css'
import { useCurrentPeriod } from '@/contexts/FiscalPeriodContext'
import { TaxCode, TaxMethod, filterTaxCodes } from '@/lib/tax-codes'
import { isImeInput } from '@/lib/account-combobox-input'
import { applyImeFreeAmountKey } from '@/lib/ime-free-input'
import type { JournalInitialInput } from '@/lib/journal-cell-shortcuts'
import { syncAmounts, type AmountLine, type AmountSnapshot } from '@/lib/amount-sync'
import { amountToRpcString } from '@/lib/journal-save'
import { parseReferenceNumberInput } from '@/lib/reference-number'
import { isAppError } from '@/lib/errors'

type Props = {
  entry: JournalEntryWithLines
  accounts: Account[]
  allTaxCodes: TaxCode[]
  taxMethod: TaxMethod
  onSave: (updated: JournalEntryWithLines, referenceNumber: number | null) => Promise<boolean>
  onCancel: () => void
  initialField?: string
  openInitialAccount?: boolean
  initialInput?: JournalInitialInput
  onNavigate?: (direction: 'next' | 'prev' | 'up' | 'down', field: string) => void
}

export default function InlineEditRow({ entry, accounts, allTaxCodes, taxMethod, onSave, onCancel, initialField, openInitialAccount = false, initialInput, onNavigate }: Props) {
  const { period } = useCurrentPeriod()

  const debitLine  = entry.journal_lines.find(l => l.side === 'DEBIT')
  const creditLine = entry.journal_lines.find(l => l.side === 'CREDIT')

  const debitAccount = accounts.find(a => a.id === debitLine?.account_id)
  const initialDebitParentId = debitAccount?.parent_id ?? (debitLine?.account_id ?? '')
  const initialDebitSubId    = debitAccount?.parent_id ? (debitLine?.account_id ?? '') : ''

  const creditAccount = accounts.find(a => a.id === creditLine?.account_id)
  const initialCreditParentId = creditAccount?.parent_id ?? (creditLine?.account_id ?? '')
  const initialCreditSubId    = creditAccount?.parent_id ? (creditLine?.account_id ?? '') : ''

  const [date,            setDate]            = useState(entry.date)
  const [referenceNumber, setReferenceNumber] = useState(String(entry.reference_number ?? ''))
  const [debitAccountId,  setDebitAccountId]  = useState(initialDebitParentId)
  const [debitSubId,      setDebitSubId]      = useState(initialDebitSubId)
  const [debitAmount,     setDebitAmount]     = useState(initialInput?.field === 'debit_amount' ? initialInput.text : String(debitLine?.amount ?? ''))
  const [debitTaxCode,    setDebitTaxCode]    = useState(debitLine?.tax_code ?? '')
  const [creditAccountId, setCreditAccountId] = useState(initialCreditParentId)
  const [creditSubId,     setCreditSubId]     = useState(initialCreditSubId)
  const [creditAmount,    setCreditAmount]    = useState(initialInput?.field === 'credit_amount' ? initialInput.text : String(creditLine?.amount ?? ''))
  const [creditTaxCode,   setCreditTaxCode]   = useState(creditLine?.tax_code ?? '')
  const [description,     setDescription]    = useState(initialInput?.field === 'description' ? initialInput.text : (entry.description ?? ''))
  const [supplement,      setSupplement]     = useState(entry.supplement ?? '')
  const [errorMessage,    setErrorMessage]    = useState('')
  const [saving,          setSaving]          = useState(false)

  const amountReplaceAll = useRef(false)
  const amountSnapshot = useRef<AmountSnapshot | null>(null)
  const initialAmountFocus = useRef(initialInput?.field === 'debit_amount' || initialInput?.field === 'credit_amount')
  const rowRef           = useRef<HTMLDivElement>(null)
  const dateRef          = useRef<HTMLInputElement>(null)
  const dateCommitRef    = useRef<DateInputHandle>(null)
  const refNumRef        = useRef<HTMLInputElement>(null)
  const debitAccountRef  = useRef<HTMLInputElement>(null)
  const debitSubRef      = useRef<HTMLInputElement>(null)
  const debitAmountRef   = useRef<HTMLInputElement>(null)
  const creditAccountRef = useRef<HTMLInputElement>(null)
  const creditSubRef     = useRef<HTMLInputElement>(null)
  const creditAmountRef  = useRef<HTMLInputElement>(null)
  const descriptionRef   = useRef<HTMLInputElement>(null)
  const supplementRef    = useRef<HTMLInputElement>(null)

  // 現在フォーカス中のフィールド名を追跡（仕訳の塊でのキー処理で使用）
  const currentFocusedField = useRef<string>('debit_account')
  // 二重保存防止フラグ
  const isSavingRef = useRef(false)

  const parentAccounts    = accounts.filter(a => a.parent_id === null)
  const debitSubAccounts  = accounts.filter(a => a.parent_id === debitAccountId)
  const creditSubAccounts = accounts.filter(a => a.parent_id === creditAccountId)

  const availableTaxCodes = filterTaxCodes(allTaxCodes, taxMethod)

  // initialField で指定したフィールドにマウント時フォーカス
  useEffect(() => {
    const field = initialField ?? 'debit_account'
    if (field === 'debit_sub') {
      if (debitSubAccounts.length > 0) { debitSubRef.current?.focus(); return }
      debitAmountRef.current?.focus(); return
    }
    if (field === 'credit_sub') {
      if (creditSubAccounts.length > 0) { creditSubRef.current?.focus(); return }
      creditAmountRef.current?.focus(); return
    }
    const map: Record<string, React.RefObject<HTMLInputElement | null>> = {
      date:           dateRef,
      slip_number:    refNumRef,
      debit_account:  debitAccountRef,
      debit_amount:   debitAmountRef,
      credit_account: creditAccountRef,
      credit_amount:  creditAmountRef,
      description:    descriptionRef,
    }
    const input = (map[field] ?? map['debit_account']).current
    input?.focus()
    if (initialInput && input && input.type !== 'number' && field !== 'date') {
      input.setSelectionRange(input.value.length, input.value.length)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAmountFocus = (e: React.FocusEvent<HTMLInputElement>, field: 'debit_amount' | 'credit_amount') => {
    const isInitialInput = initialAmountFocus.current && initialInput?.field === field
    const side = field === 'debit_amount' ? 'DEBIT' : 'CREDIT'
    amountSnapshot.current = {
      side,
      value: isInitialInput
        ? String((side === 'DEBIT' ? debitLine : creditLine)?.amount ?? '')
        : e.currentTarget.value,
    }
    amountReplaceAll.current = e.currentTarget.value !== '' && !isInitialInput
    initialAmountFocus.current = false
    if (amountReplaceAll.current) e.currentTarget.select()
  }

  const handleAmountKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, setAmount: (value: string) => void) => {
    const nextText = applyImeFreeAmountKey(e.currentTarget.value, e.nativeEvent, amountReplaceAll.current)
    if (nextText === null) return
    e.preventDefault()
    amountReplaceAll.current = false
    setAmount(nextText)
    e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)
  }

  const syncCurrentAmounts = (amounts: AmountLine[] = [
    { side: 'DEBIT', amount: debitAmount },
    { side: 'CREDIT', amount: creditAmount },
  ]) => {
    // InlineEditRow は単純仕訳用だが、元データの行数も明示的に確認する。
    const synced = syncAmounts(amounts, entry.journal_lines.length === 2 ? amountSnapshot.current : null)
    if (synced !== amounts) {
      setDebitAmount(synced[0].amount)
      setCreditAmount(synced[1].amount)
    }
    if (synced !== amounts && amountSnapshot.current) {
      const source = synced.find(line => line.side === amountSnapshot.current?.side)
      if (source) amountSnapshot.current = { side: source.side, value: source.amount }
    }
    return synced
  }

  function validate(committedDate: string, amounts: AmountLine[]): string | null {
    if (!committedDate) return '日付を入力してください。'
    if (!debitAccountId) return '借方科目を選択してください。'
    if (!creditAccountId) return '貸方科目を選択してください。'
    const [debit, credit] = amounts
    if (!debit.amount.trim()) return '借方金額を入力してください。'
    if (!credit.amount.trim()) return '貸方金額を入力してください。'
    const dAmt = Number(debit.amount)
    const cAmt = Number(credit.amount)
    try { amountToRpcString(debit.amount, 1) } catch { return '借方金額は小数第2位までの正の数で入力してください。' }
    try { amountToRpcString(credit.amount, 2) } catch { return '貸方金額は小数第2位までの正の数で入力してください。' }
    if (dAmt !== cAmt) return '借方金額と貸方金額が一致していません。'
    return null
  }

  async function triggerSave(amounts?: AmountLine[]): Promise<boolean> {
    if (isSavingRef.current || saving) return false
    const parsedReference = parseReferenceNumberInput(referenceNumber)
    if (!parsedReference.ok) {
      setErrorMessage(parsedReference.message)
      refNumRef.current?.focus()
      return false
    }
    const syncedAmounts = syncCurrentAmounts(amounts)
    // Tab/Enter は blur を起こさない。blur 経由でも親 state の反映を待たずに同じ確定値を使う。
    const committedDate = dateCommitRef.current ? dateCommitRef.current.commit() : date
    if (committedDate === null) {
      setErrorMessage('正しい日付を入力してください。')
      return false
    }
    const err = validate(committedDate, syncedAmounts)
    if (err) { setErrorMessage(err); return false }
    setErrorMessage('')
    isSavingRef.current = true
    setSaving(true)

    const resolvedDebitId  = debitSubId  || debitAccountId
    const resolvedCreditId = creditSubId || creditAccountId
    const debitAcc  = accounts.find(a => a.id === resolvedDebitId)
    const creditAcc = accounts.find(a => a.id === resolvedCreditId)

    const updatedEntry: JournalEntryWithLines = {
      ...entry,
      date: committedDate,
      description,
      supplement,
      reference_number: parsedReference.value ?? entry.reference_number,
      journal_lines: [
        {
          ...debitLine!,
          account_id: resolvedDebitId,
          amount: Number(syncedAmounts[0].amount),
          tax_code: debitTaxCode || null,
          accounts: debitAcc
            ? { id: debitAcc.id, name: debitAcc.name, parent_id: debitAcc.parent_id }
            : debitLine!.accounts,
        },
        {
          ...creditLine!,
          account_id: resolvedCreditId,
          amount: Number(syncedAmounts[1].amount),
          tax_code: creditTaxCode || null,
          accounts: creditAcc
            ? { id: creditAcc.id, name: creditAcc.name, parent_id: creditAcc.parent_id }
            : creditLine!.accounts,
        },
      ],
    }

    try {
      const saved = await onSave(updatedEntry, parsedReference.value)
      if (saved) amountSnapshot.current = null
      return saved
    } catch (error) {
      setErrorMessage(isAppError(error) ? error.message : '保存に失敗しました。再度お試しください。')
      return false
    } finally {
      isSavingRef.current = false
      setSaving(false)
    }
  }

  const handleBlur = (e: React.FocusEvent) => {
    if (isSavingRef.current) return
    if (!parseReferenceNumberInput(referenceNumber).ok) {
      void triggerSave()
      return
    }
    const syncedAmounts = syncCurrentAmounts()
    amountSnapshot.current = null
    if (rowRef.current?.contains(e.relatedTarget as Node)) return
    // 子の blur で setState しても、このイベント中の保存は必ずローカルの確定値を使う。
    triggerSave(syncedAmounts)
  }

  // 摘要と補足の間だけは保存せず移動し、他のTab/Enterは従来どおり保存する。
  const handleRowKeyDown = (e: React.KeyboardEvent) => {
    if (isImeInput(e.nativeEvent)) {
      if (e.key === 'Tab') e.preventDefault()
      e.stopPropagation()
      return
    }
    if (e.key !== 'Tab' && e.key !== 'Enter' && e.key !== 'Escape') return

    if (e.key === 'Escape') {
      e.preventDefault()
      amountSnapshot.current = null
      onCancel()
      return
    }

    const field = currentFocusedField.current
    if (!parseReferenceNumberInput(referenceNumber).ok) {
      e.preventDefault()
      void triggerSave()
      return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      if (field === 'description' && !e.shiftKey) {
        supplementRef.current?.focus()
        return
      }
      if (field === 'supplement' && e.shiftKey) {
        descriptionRef.current?.focus()
        return
      }
      const direction = e.shiftKey ? 'prev' : 'next'
      triggerSave().then(ok => { if (ok) onNavigate?.(direction, field === 'supplement' ? 'description' : field) })
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      triggerSave().then(ok => { if (ok) onNavigate?.('down', field === 'supplement' ? 'description' : field) })
    }
  }

  const inputCell = styles.inputCell

  return (
    <div ref={rowRef} role="rowgroup" className={styles.editEntry} style={JOURNAL_GRID_STYLE} onKeyDown={handleRowKeyDown}>
      <div role="row" className={`${styles.grid} ${styles.editRow}`} style={journalFragmentStyle(1)}>
        {/* 1: 日付 */}
        <div role="cell" className={inputCell} style={journalCellStyle('date')} onBlur={handleBlur} onFocus={() => { currentFocusedField.current = 'date' }}>
          {period || initialInput?.field === 'date' ? (
            <DateInput
              imeFree
              ref={dateRef}
              commitRef={dateCommitRef}
              initialInputText={initialInput?.field === 'date' ? initialInput.text : undefined}
              value={date}
              onChange={setDate}
              period={period ?? { id: '', name: '', start_date: `${entry.date.slice(0, 4)}-01-01`, end_date: `${entry.date.slice(0, 4)}-12-31`, is_current: false, closed_at: null }}
            />
          ) : (
            <Input
              ref={dateRef}
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full"
            />
          )}
        </div>

        {/* 2: 伝票No. */}
        <div role="cell" className={inputCell} style={journalCellStyle('slip_number')} onBlur={handleBlur} onFocus={() => { currentFocusedField.current = 'slip_number' }}>
          <Input
            ref={refNumRef}
            type="text"
            value={referenceNumber}
            onChange={e => setReferenceNumber(e.target.value)}
            className="w-full"
          />
        </div>

        {/* 3: 借方科目（親） */}
        <div role="cell" className={inputCell} style={journalCellStyle('debit_account')} onBlur={handleBlur} onFocus={() => { currentFocusedField.current = 'debit_account' }}>
          <AccountCombobox
            imeFree
            ref={debitAccountRef}
            replaceOnType
            openOnMount={openInitialAccount && initialField === 'debit_account'}
            initialQuery={initialInput?.field === 'debit_account' ? initialInput.text : undefined}
            accounts={parentAccounts}
            value={debitAccountId}
            onChange={(id) => { setDebitAccountId(id); setDebitSubId('') }}
            placeholder=""
          />
        </div>

        {/* 4: 借方補助科目 */}
        <div role="cell" className={inputCell} style={journalCellStyle('debit_sub')} onBlur={handleBlur} onFocus={() => { currentFocusedField.current = 'debit_sub' }}>
          {debitSubAccounts.length > 0 && (
            <AccountCombobox
              imeFree
              ref={debitSubRef}
              replaceOnType
              accounts={debitSubAccounts}
              value={debitSubId}
              onChange={setDebitSubId}
              showCode={false}
              placeholder=""
            />
          )}
        </div>

        {/* 5: 借方金額 */}
        <div role="cell" className={inputCell} style={journalCellStyle('debit_amount')} onBlur={handleBlur} onFocus={() => { currentFocusedField.current = 'debit_amount' }}>
          <input
            ref={debitAmountRef}
            type="text"
            readOnly
            className="w-full border rounded text-right bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            value={debitAmount}
            onFocus={e => handleAmountFocus(e, 'debit_amount')}
            onBlur={() => { amountReplaceAll.current = false }}
            onKeyDown={e => handleAmountKeyDown(e, setDebitAmount)}
            placeholder="0"
          />
        </div>

        {/* 6: 借方税区分 */}
        <div role="cell" className={inputCell} style={journalCellStyle('debit_tax')} onBlur={handleBlur} onFocus={() => { currentFocusedField.current = 'debit_tax' }}>
          <Select value={debitTaxCode || 'NONE'} onValueChange={(v) => setDebitTaxCode(v === 'NONE' ? '' : v)}>
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

        {/* 7: 貸方科目（親） */}
        <div role="cell" className={inputCell} style={journalCellStyle('credit_account')} onBlur={handleBlur} onFocus={() => { currentFocusedField.current = 'credit_account' }}>
          <AccountCombobox
            imeFree
            ref={creditAccountRef}
            replaceOnType
            openOnMount={openInitialAccount && initialField === 'credit_account'}
            initialQuery={initialInput?.field === 'credit_account' ? initialInput.text : undefined}
            accounts={parentAccounts}
            value={creditAccountId}
            onChange={(id) => { setCreditAccountId(id); setCreditSubId('') }}
            placeholder=""
          />
        </div>

        {/* 8: 貸方補助科目 */}
        <div role="cell" className={inputCell} style={journalCellStyle('credit_sub')} onBlur={handleBlur} onFocus={() => { currentFocusedField.current = 'credit_sub' }}>
          {creditSubAccounts.length > 0 && (
            <AccountCombobox
              imeFree
              ref={creditSubRef}
              replaceOnType
              accounts={creditSubAccounts}
              value={creditSubId}
              onChange={setCreditSubId}
              showCode={false}
              placeholder=""
            />
          )}
        </div>

        {/* 9: 貸方金額 */}
        <div role="cell" className={inputCell} style={journalCellStyle('credit_amount')} onBlur={handleBlur} onFocus={() => { currentFocusedField.current = 'credit_amount' }}>
          <input
            ref={creditAmountRef}
            type="text"
            readOnly
            className="w-full border rounded text-right bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            value={creditAmount}
            onFocus={e => handleAmountFocus(e, 'credit_amount')}
            onBlur={() => { amountReplaceAll.current = false }}
            onKeyDown={e => handleAmountKeyDown(e, setCreditAmount)}
            placeholder="0"
          />
        </div>

        {/* 10: 貸方税区分 */}
        <div role="cell" className={inputCell} style={journalCellStyle('credit_tax')} onBlur={handleBlur} onFocus={() => { currentFocusedField.current = 'credit_tax' }}>
          <Select value={creditTaxCode || 'NONE'} onValueChange={(v) => setCreditTaxCode(v === 'NONE' ? '' : v)}>
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

        {/* 11: 摘要 */}
        <div className={styles.editorSummary} style={journalCellStyle('description')}>
          <div role="cell" className={inputCell} onBlur={handleBlur} onFocus={() => { currentFocusedField.current = 'description' }}>
            <Input
              ref={descriptionRef}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="摘要"
              className="w-full"
              list="desc-suggestions"
              aria-label="摘要"
            />
          </div>
          <div role="cell" className={inputCell} onBlur={handleBlur} onFocus={() => { currentFocusedField.current = 'supplement' }}>
            <Input
              ref={supplementRef}
              value={supplement}
              onChange={e => setSupplement(e.target.value)}
              aria-label="補足"
              placeholder="補足"
              className="w-full"
            />
          </div>
        </div>
      </div>

      {errorMessage && (
        <div role="row" className={styles.grid} style={JOURNAL_GRID_STYLE}>
          <div role="cell" style={journalCellStyle('message')} className="border px-2 py-1 text-red-500 bg-red-50">
            {errorMessage}
          </div>
        </div>
      )}
    </div>
  )
}
