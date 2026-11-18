'use client'

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { Button } from '@/components/ui/button'
import { JournalEntryWithLines } from './JournalForm'
import { useDisplaySettings } from '@/contexts/DisplaySettingsContext'
import InlineEditRow from './InlineEditRow'
import { Account } from './JournalLineRow'
import { TaxCode, TaxMethod } from '@/lib/tax-codes'
import { getJournalWindow, resolveTopEntryIndex, slideJournalWindow, jumpJournalWindow, fragmentPageRows, restoreJournalViewport, type JournalViewport, type ReloadViewportRequest } from '@/lib/journal-paging'
import { getJournalCellInitialInput, shouldBubbleJournalCtrlDown, type JournalInitialInput } from '@/lib/journal-cell-shortcuts'
import { isSimpleEntry } from '@/lib/journal-duplicate'
import { NAV_COLS, JOURNAL_HEADERS, JOURNAL_GRID_STYLE, journalCellStyle, journalFragmentStyle, type NavCol } from './journal-grid'
import styles from './journal-grid.module.css'

type SimpleAccount = Account
type JournalEntry = JournalEntryWithLines

export type JournalListHandle = {
  goToFirstPage: () => void
  goToLastPage: () => void
  focusFirstDebitCell: () => void
  focusLastEntryCell: (col: NavCol) => void
  isEditing: () => boolean
  hasPendingFocus: () => boolean
  captureViewport: () => JournalViewport
}

function getTaxCodeLabel(allTaxCodes: TaxCode[], taxCodeId: string | null | undefined): string {
  if (!taxCodeId) return ''
  const found = allTaxCodes.find(t => t.id === taxCodeId)
  return found?.short_name ?? found?.name ?? taxCodeId
}

function getParentName(accounts: SimpleAccount[], parentId: string | null): string | null {
  if (!parentId) return null
  return accounts.find(a => a.id === parentId)?.name ?? null
}

function formatDateSlash(date: string): string {
  return date.replace(/-/g, '/')
}

const WINDOW_ROWS = 12

type Props = {
  readOnly?: boolean
  entries: JournalEntry[]
  lastPageRequest: number
  reloadViewportRequest: ReloadViewportRequest | null
  accounts: SimpleAccount[]
  allTaxCodes: TaxCode[]
  taxMethod: TaxMethod
  onEdit: (entry: JournalEntry) => void
  onDelete: (entry: JournalEntry) => void
  onDuplicate: (entry: JournalEntry) => void
  inlineFormRows?: React.ReactNode
  showInlineForm?: boolean
  showForm: boolean
  onInlineEditSave: (updated: JournalEntry, referenceNumber: number | null) => Promise<boolean>
  onInlineEditStart?: () => void
  onInlineEditEnd?: () => void
  onNavigateToInlineForm?: () => void
  selectedIds: Set<string>
  onToggleSelect: (entryId: string) => void
  onToggleAll: (entryIds: string[]) => void
}

const JournalList = forwardRef<JournalListHandle, Props>(
  function JournalList(
    { entries, lastPageRequest, reloadViewportRequest, accounts, allTaxCodes, taxMethod, onEdit, onDelete, onDuplicate, inlineFormRows, showInlineForm,
      showForm, onInlineEditSave, onInlineEditStart, onInlineEditEnd, onNavigateToInlineForm,
      selectedIds, onToggleSelect, onToggleAll, readOnly = false },
    ref
  ) {
    const handledLastPageRequest = useRef(0)
    const handledReloadRequest = useRef<number | null>(null)
    const [displaySettings] = useDisplaySettings()
    const [topEntryId, setTopEntryId] = useState<string | null>(null)
    const previousTopIndex = useRef(0)
    const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
    const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
    const [initialEditField, setInitialEditField] = useState<string | undefined>(undefined)
    const [openInitialAccount, setOpenInitialAccount] = useState(false)
    const [initialInput, setInitialInput] = useState<JournalInitialInput | undefined>(undefined)
    const listRef = useRef<HTMLDivElement>(null)
    const [openedEntryIds, setOpenedEntryIds] = useState<Set<string>>(() => new Set())
    const [pendingFocusCell, setPendingFocusCell] = useState<{ entryId: string; colIndex: number } | 'form' | null>(null)
    const [pendingViewport, setPendingViewport] = useState<ReloadViewportRequest | null>(null)
    const lastPageRequested = lastPageRequest !== handledLastPageRequest.current

    const journalWindow = getJournalWindow(entries, resolveTopEntryIndex(entries, topEntryId, previousTopIndex.current), WINDOW_ROWS)
    const { topIndex, lastTopIndex, rows: windowRows, startRow, endRow, totalRows } = journalWindow
    const fragments = fragmentPageRows(windowRows)
    const entryIndexes = new Map(entries.map((entry, index) => [entry.id, index]))
    const resolvedTopId = journalWindow.entries[0]?.id ?? null

    useEffect(() => {
      previousTopIndex.current = topIndex
      if (topEntryId !== null && topEntryId !== resolvedTopId) setTopEntryId(resolvedTopId)
    }, [topIndex, topEntryId, resolvedTopId])

    const selectableEntryIds = journalWindow.entries
      .filter(entry => !entry.is_opening_balance)
      .map(entry => entry.id)
    const allInWindowSelected = selectableEntryIds.length > 0 && selectableEntryIds.every(id => selectedIds.has(id))
    const someInWindowSelected = selectableEntryIds.some(id => selectedIds.has(id))

    const setWindowTop = (index: number) => setTopEntryId(entries[index]?.id ?? null)
    const jumpWindow = (direction: 'first' | 'prev' | 'next' | 'last') => {
      setWindowTop(jumpJournalWindow(entries, topIndex, direction, WINDOW_ROWS))
    }

    useEffect(() => {
      if (lastPageRequest === handledLastPageRequest.current) return
      handledLastPageRequest.current = lastPageRequest
      setPendingViewport(null)
      jumpWindow('last')
    }, [lastPageRequest, entries]) // eslint-disable-line react-hooks/exhaustive-deps

    useImperativeHandle(ref, () => ({
      goToFirstPage: () => jumpWindow('first'),
      goToLastPage: () => jumpWindow('last'),
      isEditing: () => editingEntryId !== null,
      hasPendingFocus: () => pendingFocusCell !== null || pendingViewport !== null,
      captureViewport: () => {
        const active = document.activeElement
        const cell = active instanceof HTMLElement && listRef.current?.contains(active)
          ? active.closest<HTMLElement>('[data-row][data-col]') : null
        return {
          topIndex,
          cell: cell ? { rowOffset: Number(cell.dataset.row), colIndex: Number(cell.dataset.col) } : null,
        }
      },
      focusLastEntryCell: col => {
        const target = entries[entries.length - 1]
        if (!target || editingEntryId !== null) return
        const colIndex = NAV_COLS.indexOf(col)
        if (windowRows.some(row => row.isFirstRow && row.entry.id === target.id)) {
          focusCellInDOM(target.id, colIndex)
        } else {
          jumpWindow('last')
          setPendingFocusCell({ entryId: target.id, colIndex })
        }
      },
      focusFirstDebitCell: () => {
        setEditingEntryId(null)
        setSelectedEntryId(null)
        setTopEntryId(null)
        if (entries[0]) setPendingFocusCell({ entryId: entries[0].id, colIndex: NAV_COLS.indexOf('debit_account') })
      },
    }))

    const focusCellInDOM = (entryId: string, colIndex: number) => {
      const rowIndex = windowRows.findIndex(row => row.isFirstRow && row.entry.id === entryId)
      if (rowIndex === -1) return
      const target = listRef.current?.querySelector<HTMLElement>(
        `[data-row="${rowIndex}"][data-col="${colIndex}"]`
      )
      target?.focus()
      setSelectedEntryId(entryId)
    }

    useEffect(() => {
      if (!reloadViewportRequest || reloadViewportRequest.seq === handledReloadRequest.current) return
      handledReloadRequest.current = reloadViewportRequest.seq
      if (lastPageRequested || editingEntryId !== null || showForm || pendingFocusCell !== null) return
      const viewport = reloadViewportRequest.viewport
      const restored = restoreJournalViewport(entries, viewport, WINDOW_ROWS)
      setTopEntryId(restored.topEntryId)
      setPendingViewport(reloadViewportRequest)
    }, [reloadViewportRequest, entries, lastPageRequested, editingEntryId, showForm, pendingFocusCell])

    useEffect(() => {
      if (!pendingViewport) return
      if (pendingViewport.seq !== reloadViewportRequest?.seq || editingEntryId !== null || showForm || pendingFocusCell !== null || lastPageRequested) {
        setPendingViewport(null)
        return
      }
      const restored = restoreJournalViewport(entries, pendingViewport.viewport, WINDOW_ROWS)
      if (restored.topEntryId !== resolvedTopId) {
        setTopEntryId(restored.topEntryId)
        return
      }
      if (restored.focusCell) focusCellInDOM(restored.focusCell.entryId, restored.focusCell.colIndex)
      else if (pendingViewport.viewport.cell) setSelectedEntryId(null)
      setPendingViewport(null)
    })

    useEffect(() => {
      if (editingEntryId !== null || pendingFocusCell === null) return
      if (pendingFocusCell === 'form') onNavigateToInlineForm?.()
      else focusCellInDOM(pendingFocusCell.entryId, pendingFocusCell.colIndex)
      setPendingFocusCell(null)
    })

    const navigateToEntry = (entryId: string, colIndex: number, afterEdit = false) => {
      const targetIndex = entryIndexes.get(entryId)
      if (targetIndex === undefined) return
      const nextTopIndex = slideJournalWindow(entries, topIndex, targetIndex, WINDOW_ROWS)
      if (afterEdit || nextTopIndex !== topIndex) {
        setPendingFocusCell({ entryId, colIndex })
        setWindowTop(nextTopIndex)
      } else {
        focusCellInDOM(entryId, colIndex)
      }
    }

    const navigateAdjacent = (entryId: string, direction: -1 | 1, colIndex: number, afterEdit = false) => {
      const index = entryIndexes.get(entryId)
      if (index === undefined) return
      const target = entries[index + direction]
      if (target) navigateToEntry(target.id, colIndex, afterEdit)
      else if (direction === 1) {
        if (afterEdit) setPendingFocusCell('form')
        else onNavigateToInlineForm?.()
      }
    }

    const toggleSupplement = (entryId: string) => {
      setOpenedEntryIds(previous => {
        const next = new Set(previous)
        if (next.has(entryId)) next.delete(entryId)
        else next.add(entryId)
        return next
      })
    }

    const handleInlineNavigate = (
      direction: 'next' | 'prev' | 'up' | 'down',
      field: string
    ) => {
      if (!editingEntryId) return
      const colIndex = NAV_COLS.indexOf(field as NavCol)
      if (direction === 'next' && colIndex + 1 < NAV_COLS.length) {
        navigateToEntry(editingEntryId, colIndex + 1, true)
      } else if (direction === 'prev' && colIndex > 0) {
        navigateToEntry(editingEntryId, colIndex - 1, true)
      } else {
        const delta = direction === 'prev' || direction === 'up' ? -1 : 1
        const targetCol = direction === 'next' ? 0 : direction === 'prev' ? NAV_COLS.length - 1 : colIndex
        navigateAdjacent(editingEntryId, delta, targetCol, true)
      }
    }

    // 非編集時のセルキー操作
    const handleCellKeyDown = (localRowIdx: number, colIndex: number) => (
      e: React.KeyboardEvent<HTMLDivElement>
    ) => {
      if (editingEntryId) return
      // Ctrl+↓ は画面全体の「最後の窓 → 入力フォームの日付欄」に任せる。
      // 通常の ↓ 処理にも流さず、イベントを消費しない。
      if (shouldBubbleJournalCtrlDown(e)) return

      const row = windowRows[localRowIdx]
      const field = NAV_COLS[colIndex]
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
        && ['ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        // セル内で処理する Ctrl+↑／←／→ は画面全体に伝えない。
        e.stopPropagation()
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          focusCellInDOM(row.entry.id, e.key === 'ArrowLeft' ? 0 : NAV_COLS.length - 1)
        } else {
          const target = entries[0]
          if (!target) return
          if (windowRows.some(row => row.entry.id === target.id)) {
            focusCellInDOM(target.id, colIndex)
          } else {
            jumpWindow('first')
            setPendingFocusCell({ entryId: target.id, colIndex })
          }
        }
        return
      }

      const isAccountAltDown = e.altKey && e.key === 'ArrowDown'
        && (field === 'debit_account' || field === 'credit_account')

      if (e.altKey && e.key === 'ArrowDown' && !isAccountAltDown) {
        e.preventDefault()
        toggleSupplement(row.entry.id)
        return
      }

      if (e.key === 'Delete' && !e.nativeEvent.isComposing && !e.repeat) {
        if (readOnly) { e.preventDefault(); return }
        if (row.isFirstRow) { e.preventDefault(); onDelete(row.entry) }
        return
      }

      if ((e.key === 'Enter' || e.key === 'F2' || isAccountAltDown) && !e.nativeEvent.isComposing && !e.repeat) {
        e.preventDefault()
        if (readOnly || !row.isFirstRow || row.entry.is_opening_balance || showForm) return
        setSelectedEntryId(row.entry.id)
        if (!isSimpleEntry(row.entry)) { onEdit(row.entry); return }
        setInitialEditField(field)
        setOpenInitialAccount(isAccountAltDown)
        setInitialInput(undefined)
        setEditingEntryId(row.entry.id)
        onInlineEditStart?.()
        return
      }

      if (isAccountAltDown || e.key === 'Escape') { e.preventDefault(); return }

      if (e.key === ' ' && !e.nativeEvent.isComposing && !e.repeat) {
        if (row.isFirstRow && !row.entry.is_opening_balance) {
          e.preventDefault()
          onToggleSelect(row.entry.id)
        }
        return
      }

      const typedInput = getJournalCellInitialInput(field, e.nativeEvent, {
        isFirstRow: row.isFirstRow,
        isOpeningBalance: !!row.entry.is_opening_balance,
        showForm,
        editing: editingEntryId !== null,
      })
      if (typedInput) {
        e.preventDefault()
        if (readOnly) return
        setSelectedEntryId(row.entry.id)
        if (!isSimpleEntry(row.entry)) { onEdit(row.entry); return }
        setInitialEditField(field)
        setOpenInitialAccount(false)
        setInitialInput(typedInput)
        setEditingEntryId(row.entry.id)
        onInlineEditStart?.()
        return
      }

      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) return
      e.preventDefault()

      const isLeft  = e.key === 'ArrowLeft'  || (e.key === 'Tab' && e.shiftKey)
      const isRight = e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)
      const isUp    = e.key === 'ArrowUp'
      const isDown  = e.key === 'ArrowDown'

      if (isLeft) {
        if (colIndex > 0) focusCellInDOM(row.entry.id, colIndex - 1)
        else if (e.key === 'Tab') navigateAdjacent(row.entry.id, -1, NAV_COLS.length - 1)
        return
      }
      if (isRight) {
        if (colIndex < NAV_COLS.length - 1) focusCellInDOM(row.entry.id, colIndex + 1)
        else if (e.key === 'Tab') navigateAdjacent(row.entry.id, 1, 0)
        return
      }
      if (isUp) navigateAdjacent(row.entry.id, -1, colIndex)
      if (isDown) navigateAdjacent(row.entry.id, 1, colIndex)
    }

    return (
      <div ref={listRef} className={`${styles.container} ${displaySettings.textSize === 'large' ? styles.large : ''}`} style={JOURNAL_GRID_STYLE}>
        <div className={styles.viewport}>
          <div role="table" aria-label="仕訳日記帳" className={styles.table}>
            <div role="rowgroup">
              <div role="row" className={`${styles.grid} ${styles.header}`}>
                {JOURNAL_HEADERS.map(({ field, label, secondaryLabel }) => (
                  <div key={field} role="columnheader"
                    className={`${styles.headerCell} ${field === 'select' ? 'no-print' : ''} ${field === 'description' || field === 'actions' ? styles.wideOnly : ''} ${field.endsWith('amount') ? styles.amount : ''}`}
                    style={{ ...journalCellStyle(field), gridRow: 1 }}>
                    {field === 'select' ? (
                      <input type="checkbox" aria-label="すべて選択" checked={allInWindowSelected}
                        ref={el => { if (el) el.indeterminate = someInWindowSelected && !allInWindowSelected }}
                        onChange={() => onToggleAll(selectableEntryIds)}
                        disabled={selectableEntryIds.length === 0 || editingEntryId !== null} />
                    ) : (
                      <>
                        <span className={styles.headerLine}>{label}</span>
                        <span className={`${styles.headerLine} ${styles.secondary}`}>{secondaryLabel}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div className={styles.headerNote}>摘要 ／ 右端のボタンで補足を開閉</div>
            </div>
            {fragments.map(fragment => {
              const { entry, rows, startRowIndex: localIdx, hasFirstRow } = fragment
              if (editingEntryId === entry.id && !readOnly) {
                if (!hasFirstRow) return null
                return (
                  <InlineEditRow key={`edit-${entry.id}`} entry={entry} accounts={accounts}
                    allTaxCodes={allTaxCodes} taxMethod={taxMethod} initialField={initialEditField}
                    openInitialAccount={openInitialAccount}
                    initialInput={initialInput}
                    onSave={async (updated, referenceNumber) => {
                      const saved = await onInlineEditSave(updated, referenceNumber)
                      if (saved) {
                        setEditingEntryId(null)
                        onInlineEditEnd?.()
                      }
                      return saved
                    }}
                    onCancel={() => {
                      const colIndex = NAV_COLS.indexOf((initialEditField ?? 'debit_account') as NavCol)
                      setPendingFocusCell({ entryId: entry.id, colIndex })
                      setEditingEntryId(null)
                      setSelectedEntryId(entry.id)
                      onInlineEditEnd?.()
                    }} onNavigate={handleInlineNavigate} />
                )
              }
              const isSelected = selectedEntryId === entry.id
              const isOpen = openedEntryIds.has(entry.id)
              const accountName = (line: typeof rows[number]['debitLine']) => {
                if (!line) return ''
                const account = line.accounts
                if (!account) return '（削除済み科目）'
                return account.parent_id ? getParentName(accounts, account.parent_id) ?? account.name : account.name
              }
              const subName = (line: typeof rows[number]['debitLine']) => line?.accounts?.parent_id ? line.accounts.name : ''
              return (
                <div key={`${entry.id}-${rows[0].rowIndex}`} role="rowgroup"
                  className={`${styles.grid} ${styles.entry} ${(entryIndexes.get(entry.id) ?? 0) % 2 ? styles.striped : ''} ${isSelected ? styles.selected : ''}`}
                  style={journalFragmentStyle(rows.length)}
                  onClick={hasFirstRow ? () => { if (!entry.is_opening_balance) setSelectedEntryId(entry.id) } : undefined}
                  onDoubleClick={hasFirstRow ? () => {
                    if (readOnly || entry.is_opening_balance || showForm) return
                    if (!isSimpleEntry(entry)) { onEdit(entry); return }
                    setInitialEditField('debit_account')
                    setOpenInitialAccount(false)
                    setInitialInput(undefined)
                    setEditingEntryId(entry.id)
                    onInlineEditStart?.()
                  } : undefined}>
                  {rows.map((row, displayIndex) => {
                    const rowIdx = localIdx + displayIndex
                    const cells: { field: NavCol; value: React.ReactNode; className?: string }[] = [
                      { field: 'date', value: row.isFirstRow ? <><span className={styles.fullDate}>{formatDateSlash(entry.date)}</span><span className={styles.compactDate}>{formatDateSlash(entry.date).slice(5)}</span></> : '' },
                      { field: 'slip_number', value: row.isFirstRow ? entry.referenceNumberPending ? '…' : entry.reference_number ?? '-' : '', className: styles.secondary },
                      { field: 'debit_account', value: accountName(row.debitLine), className: styles.account },
                      { field: 'debit_sub', value: subName(row.debitLine), className: styles.secondary },
                      { field: 'debit_amount', value: row.debitLine?.amount.toLocaleString() ?? '', className: styles.amount },
                      { field: 'credit_account', value: accountName(row.creditLine), className: styles.account },
                      { field: 'credit_sub', value: subName(row.creditLine), className: styles.secondary },
                      { field: 'credit_amount', value: row.creditLine?.amount.toLocaleString() ?? '', className: styles.amount },
                    ]
                    return (
                      <div key={row.rowIndex} role="row" className={styles.row}>
                        {row.isFirstRow && (
                          <div role="cell" className={`${styles.cell} ${styles.check} no-print`} style={journalCellStyle('select', displayIndex)}>
                            <input type="checkbox" aria-label="この仕訳を選択" checked={selectedIds.has(entry.id)}
                              onChange={() => onToggleSelect(entry.id)} disabled={entry.is_opening_balance || editingEntryId !== null}
                              onClick={e => e.stopPropagation()} />
                          </div>
                        )}
                        {cells.map(({ field, value, className }) => {
                          const colIndex = NAV_COLS.indexOf(field)
                          const isAccount = field === 'debit_account' || field === 'credit_account'
                          return (
                            <div key={field} role="cell" className={`${styles.cell} ${className ?? ''} ${row.isFirstRow ? styles.navCell : ''}`}
                              style={journalCellStyle(field, displayIndex)} data-row={rowIdx} data-col={colIndex}
                              tabIndex={row.isFirstRow ? 0 : -1}
                              onKeyDown={row.isFirstRow ? handleCellKeyDown(rowIdx, colIndex) : undefined}>
                              {value}
                              {row.isFirstRow && isAccount && (
                                <span aria-hidden="true" className={styles.indicator}>
                                  <svg width="10" height="8" viewBox="0 0 10 8"><path d="M1 1.5 H9 L5 6.8 Z" fill="none" stroke="#1d4ed8" strokeWidth="1.4" strokeLinejoin="round" /></svg>
                                </span>
                              )}
                            </div>
                          )
                        })}
                        {displaySettings.showTaxClass && (
                          <>
                            <div role="cell" className={`${styles.cell} ${styles.secondary} ${styles.amount}`} style={journalCellStyle('debit_tax', displayIndex)}>{getTaxCodeLabel(allTaxCodes, row.debitLine?.tax_code)}</div>
                            <div role="cell" className={`${styles.cell} ${styles.secondary} ${styles.amount}`} style={journalCellStyle('credit_tax', displayIndex)}>{getTaxCodeLabel(allTaxCodes, row.creditLine?.tax_code)}</div>
                          </>
                        )}
                        {row.isFirstRow && (
                          <>
                            <div className={styles.summary} style={journalCellStyle('description')}>
                              <div role="cell" className={`${styles.cell} ${styles.description} ${styles.navCell}`}
                                data-row={rowIdx} data-col={NAV_COLS.indexOf('description')} tabIndex={0} onKeyDown={handleCellKeyDown(rowIdx, NAV_COLS.indexOf('description'))} title={entry.description}>
                                <span aria-hidden="true" className={styles.glyph}>└</span>
                                {entry.is_opening_balance && <span className={styles.secondary}>期首 </span>}
                                {entry.description}
                              </div>
                              <div id={`journal-supplement-${entry.id}`}
                                className={`${styles.cell} ${styles.secondary} ${styles.supplement} ${isOpen ? '' : styles.closed}`} title={entry.supplement ?? ''}>
                                {entry.supplement}
                              </div>
                            </div>
                            <div role="cell" className={`${styles.actions} no-print`} style={journalCellStyle('actions')}>
                              {isSelected && (
                                <>
                                  {!entry.is_opening_balance && <button type="button" disabled={readOnly} className={styles.actionButton} onClick={e => { e.stopPropagation(); onDuplicate(entry) }}>複製</button>}
                                </>
                              )}
                              <button type="button" className={`${styles.actionButton} ${styles.toggle}`}
                                aria-label={entry.supplement ? '補足を開閉（補足あり）' : '補足を開閉'} aria-expanded={isOpen} aria-controls={`journal-supplement-${entry.id}`}
                                onClick={e => { e.stopPropagation(); toggleSupplement(entry.id) }}>
                                <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d={isOpen ? 'M1 5 L5 1 L9 5' : 'M1 1 L5 5 L9 1'} fill="none" stroke="#3f3f46" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                {entry.supplement && <span aria-hidden="true" className={styles.supplementMark} />}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
            {showInlineForm && inlineFormRows}
          </div>
        </div>

        {totalRows > WINDOW_ROWS && (
          <div className="flex items-center justify-between mt-2 no-print">
            <span className="text-muted-foreground">
              {startRow}〜{endRow} 行目 / 全 {totalRows} 行
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={() => jumpWindow('first')} disabled={topIndex === 0} title="最初の窓へ">«</Button>
              <Button variant="outline" size="icon" onClick={() => jumpWindow('prev')} disabled={topIndex === 0} title="前の窓へ">‹</Button>
              <Button variant="outline" size="icon" onClick={() => jumpWindow('next')} disabled={topIndex === lastTopIndex} title="次の窓へ">›</Button>
              <Button variant="outline" size="icon" onClick={() => jumpWindow('last')} disabled={topIndex === lastTopIndex} title="最後の窓へ">»</Button>
            </div>
          </div>
        )}
      </div>
    )
  }
)

export default JournalList
