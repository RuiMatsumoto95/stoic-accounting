'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompany } from '@/contexts/CompanyContext'
import { assertActiveCompany } from '@/lib/company-guard'
import { registerDirtyChecker } from '@/lib/company-dirty'
import { Button } from '@/components/ui/button'
import JournalForm, { JournalEntryWithLines } from '@/components/journals/JournalForm'
import type { JournalFormHandle } from '@/components/journals/JournalForm'
import JournalList from '@/components/journals/JournalList'
import type { JournalListHandle } from '@/components/journals/JournalList'
import InlineJournalForm from '@/components/journals/InlineJournalForm'
import type { InlineJournalFormHandle } from '@/components/journals/InlineJournalForm'
import { Account } from '@/components/journals/JournalLineRow'
import { useCurrentPeriod } from '@/contexts/FiscalPeriodContext'
import { getTaxMethod, getAllTaxCodes, TaxMethod, TaxCode } from '@/lib/tax-codes'
import JournalSearch, { SearchParams, EMPTY_SEARCH } from '@/components/journals/JournalSearch'
import PrintButton from '@/components/print/PrintButton'
import PDFButton from '@/components/pdf/PDFButton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/lib/toast'
import { AccountingError, ERROR_CODES, isAppError } from '@/lib/errors'
import { updateJournalEntry } from '@/lib/journal-save'
import { translateSupabaseError } from '@/lib/supabase-error-handler'
import type { ReloadViewportRequest } from '@/lib/journal-paging'
import { readJournalEntries } from '@/lib/journal-fetch'
import OpeningBalanceImpactNotice from '@/components/OpeningBalanceImpactNotice'
import PeriodClosedNotice from '@/components/PeriodClosedNotice'
import { isPeriodClosed } from '@/lib/period-close-state'
import { entryToInlineDraft, isSimpleEntry, type InlineDraft } from '@/lib/journal-duplicate'
import { applyJournalFetch, classifyF5, commitEntry, getFetchKeepIds, isLatestFetch, shouldApplyReload, type JournalFetchResult } from '@/lib/journal-order'

function JournalsContent() {
  const company = useCompany()
  const { period } = useCurrentPeriod()
  const closed = isPeriodClosed(period)
  const router = useRouter()
  const searchParamsUrl = useSearchParams()
  const toast = useToast()

  const inlineFormRef = useRef<InlineJournalFormHandle>(null)
  const journalFormRef = useRef<JournalFormHandle>(null)
  const journalListRef = useRef<JournalListHandle>(null)

  const latestFetchSeq = useRef(0)
  const activeFetchesRef = useRef(new Set<number>())
  const reloadRef = useRef<() => void>(() => {})
  const pendingIdsRef = useRef(new Set<string>())
  const committedAtRef = useRef(new Map<string, number>())
  const [lastPageRequest, setLastPageRequest] = useState(0)

  const [accounts, setAccounts] = useState<Account[]>([])
  const [allTaxCodes, setAllTaxCodes] = useState<TaxCode[]>([])
  const [taxMethod, setTaxMethod] = useState<TaxMethod>('EXEMPT')
  const [listState, setListState] = useState<{
    entries: JournalEntryWithLines[]; reloadViewportRequest: ReloadViewportRequest | null
  }>({ entries: [], reloadViewportRequest: null })
  const { entries, reloadViewportRequest } = listState
  const setEntries = (update: (current: JournalEntryWithLines[]) => JournalEntryWithLines[]) => {
    setListState(current => ({ ...current, entries: update(current.entries) }))
  }
  const [showForm, setShowForm] = useState(false)
  const showFormRef = useRef(showForm)
  showFormRef.current = showForm
  const [editTarget, setEditTarget] = useState<JournalEntryWithLines | null>(null)
  const [duplicateSource, setDuplicateSource] = useState<JournalEntryWithLines | null>(null)
  const [duplicateRequest, setDuplicateRequest] = useState<{ seq: number; draft: InlineDraft } | null>(null)
  const duplicateSeqRef = useRef(0)
  const [loading, setLoading] = useState(true)
  const [searchParams, setSearchParams] = useState<SearchParams>(EMPTY_SEARCH)
  const [descriptionSuggestions, setDescriptionSuggestions] = useState<string[]>([])
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [bulkEditDialogOpen, setBulkEditDialogOpen] = useState(false)
  const [bulkDate, setBulkDate] = useState('')
  const [bulkDescription, setBulkDescription] = useState('')
  const [changeDateFlag, setChangeDateFlag] = useState(false)
  const [changeDescriptionFlag, setChangeDescriptionFlag] = useState(false)

  useEffect(() => registerDirtyChecker(() =>
    (journalListRef.current?.isEditing() ?? false) || pendingIdsRef.current.size > 0 ||
    (bulkEditDialogOpen && (changeDateFlag || changeDescriptionFlag)),
  ), [bulkEditDialogOpen, changeDateFlag, changeDescriptionFlag])

  const fetchAccounts = useCallback(async () => {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, code, name, type, parent_id, default_tax_code, account_aliases(id, account_id, alias, normalized_alias, alias_type, sort_order)')
      .eq('company_id', company.id)
      .order('code', { ascending: true })
    if (error) { console.error(error); return }
    setAccounts(data ?? [])
  }, [company.id])

  const fetchDescriptionSuggestions = useCallback(async () => {
    const { data, error } = await supabase
      .from('journal_entries')
      .select('description')
      .eq('company_id', company.id)
    if (error) { console.error(error); return }
    const countMap = new Map<string, number>()
    for (const row of data ?? []) {
      const d = (row.description as string | null)?.trim()
      if (!d) continue
      countMap.set(d, (countMap.get(d) ?? 0) + 1)
    }
    const suggestions = [...countMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([d]) => d)
    setDescriptionSuggestions(suggestions)
  }, [company.id])

  function applyEntries(seq: number, result: JournalFetchResult, keepOrder: boolean, reload: boolean): boolean {
    const latestSeq = latestFetchSeq.current
    if (!isLatestFetch(seq, latestSeq) || !result.ok) return false
    const list = journalListRef.current
    if (reload && (!list || !shouldApplyReload({
      seq, latestSeq, editing: list.isEditing(), formOpen: showFormRef.current, pendingFocus: list.hasPendingFocus(),
    }))) return false
    // 取得中の移動を尊重し、反映の直前に記録する。
    const viewport = reload && list ? list.captureViewport() : null
    const keepIds = getFetchKeepIds(pendingIdsRef.current, committedAtRef.current, seq)
    // 復元要求は対応する取得結果と一緒に反映する。
    setListState(current => ({
      entries: applyJournalFetch(current.entries, result, { seq, latestSeq, keepIds, keepOrder }),
      reloadViewportRequest: viewport ? { seq, viewport } : null,
    }))
    return true
  }

  async function fetchEntries(params: SearchParams, currentAccounts: Account[], {
    showLoading = true, keepOrder = false, reload = false,
  }: { showLoading?: boolean; keepOrder?: boolean; reload?: boolean } = {}) {
    const seq = ++latestFetchSeq.current
    if (!period) { setLoading(false); return false }
    // 古い取得は反映されないため、その取得だけが必要とする履歴を解放する。
    for (const [id, at] of committedAtRef.current) {
      if (at < seq) committedAtRef.current.delete(id)
    }
    activeFetchesRef.current.add(seq)
    if (showLoading) setLoading(true)
    try {
      const result = await readJournalEntries(period.id, params, currentAccounts, company.id)
      if (!result.ok) {
        console.error(result.error)
        if (reload && isLatestFetch(seq, latestFetchSeq.current)) toast.error('仕訳の再取得に失敗しました。再度お試しください。')
        return false
      }
      return applyEntries(seq, result, keepOrder, reload)
    } finally {
      activeFetchesRef.current.delete(seq)
      if (isLatestFetch(seq, latestFetchSeq.current)) setLoading(false)
    }
  }

  // URLから検索条件を復元（初回マウント時のみ）
  useEffect(() => {
    const params: SearchParams = {
      dateFrom:  searchParamsUrl.get('dateFrom')  ?? '',
      dateTo:    searchParamsUrl.get('dateTo')    ?? '',
      amountMin: searchParamsUrl.get('amountMin') ?? '',
      amountMax: searchParamsUrl.get('amountMax') ?? '',
      keyword:   searchParamsUrl.get('keyword')   ?? '',
      accountId: searchParamsUrl.get('accountId') ?? '',
    }
    setSearchParams(params)
  }, [company.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchAccounts()
    fetchDescriptionSuggestions()
    Promise.all([getTaxMethod(company.id), getAllTaxCodes()])
      .then(([method, codes]) => { setTaxMethod(method); setAllTaxCodes(codes) })
      .catch(console.error)
  }, [fetchAccounts, fetchDescriptionSuggestions, company.id, company.tax_method])

  useEffect(() => {
    if (period) fetchEntries(searchParams, accounts)
  }, [period]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = async (params: SearchParams) => {
    setSearchParams(params)
    const urlParams = new URLSearchParams()
    if (params.dateFrom)  urlParams.set('dateFrom',  params.dateFrom)
    if (params.dateTo)    urlParams.set('dateTo',    params.dateTo)
    if (params.amountMin) urlParams.set('amountMin', params.amountMin)
    if (params.amountMax) urlParams.set('amountMax', params.amountMax)
    if (params.keyword)   urlParams.set('keyword',   params.keyword)
    if (params.accountId) urlParams.set('accountId', params.accountId)
    const qs = urlParams.toString()
    router.replace(qs ? `/journals?${qs}` : '/journals', { scroll: false })
    const applied = await fetchEntries(params, accounts)
    if (!applied) return
    setTimeout(() => {
      if (!showForm) {
        journalListRef.current?.focusFirstDebitCell()
      }
    }, 0)
  }

  const handleClear = () => {
    setSearchParams(EMPTY_SEARCH)
    router.replace('/journals', { scroll: false })
    fetchEntries(EMPTY_SEARCH, accounts)
  }

  function mergeDescriptionSuggestion(prev: string[], text: string): string[] {
    const trimmed = text.trim()
    if (!trimmed) return prev
    return [trimmed, ...prev.filter(s => s !== trimmed)].slice(0, 50)
  }

  // 楽観的更新（新規仕訳）
  const handleNewAdd = (entry: JournalEntryWithLines) => {
    pendingIdsRef.current.add(entry.id)
    setEntries(prev => [...prev, entry])
    setLastPageRequest(request => request + 1)
  }
  const handleNewCommit = (tempId: string, realEntry: JournalEntryWithLines) => {
    pendingIdsRef.current.delete(tempId)
    committedAtRef.current.set(realEntry.id, latestFetchSeq.current)
    setEntries(prev => commitEntry(prev, tempId, realEntry))
    setDescriptionSuggestions(prev => mergeDescriptionSuggestion(prev, realEntry.description))
  }
  const handleNewRollback = (tempId: string) => {
    pendingIdsRef.current.delete(tempId)
    setEntries(prev => prev.filter(e => e.id !== tempId))
  }

  // 編集保存
  const handleEditSave = (savedEntry: JournalEntryWithLines) => {
    setShowForm(false)
    setEditTarget(null)
    setDuplicateSource(null)
    setEntries(prev => prev.map(e => e.id === savedEntry.id ? savedEntry : e))
    setDescriptionSuggestions(prev => mergeDescriptionSuggestion(prev, savedEntry.description))
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditTarget(null)
    setDuplicateSource(null)
  }

  const handleEdit = (entry: JournalEntryWithLines) => {
    if (closed) { toast.error(ERROR_CODES.PERIOD_CLOSED.message); return }
    setDuplicateRequest(null)
    setSelectedIds(new Set())
    setEditTarget(entry)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDuplicate = (entry: JournalEntryWithLines) => {
    if (closed) { toast.error(ERROR_CODES.PERIOD_CLOSED.message); return }
    if (isSimpleEntry(entry)) {
      let draft: InlineDraft
      try {
        draft = entryToInlineDraft(entry, accounts)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '仕訳の複製に失敗しました。')
        return
      }
      setSelectedIds(new Set())
      setShowForm(false)
      setEditTarget(null)
      setDuplicateSource(null)
      setDuplicateRequest({ seq: ++duplicateSeqRef.current, draft })
      return
    }
    setDuplicateRequest(null)
    setSelectedIds(new Set())
    setEditTarget(null)
    setDuplicateSource(entry)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDuplicateApplied = useCallback((seq: number) => {
    setDuplicateRequest(cur => cur?.seq === seq ? null : cur)
  }, [])

  const handleDuplicateSubmitted = () => {
    setShowForm(false)
    setEditTarget(null)
    setDuplicateSource(null)
  }

  const handleDelete = (entry: JournalEntryWithLines) => {
    if (closed) { toast.error(ERROR_CODES.PERIOD_CLOSED.message); return }
    if (entry.is_opening_balance) {
      toast.error(ERROR_CODES.OPENING_BALANCE_EDIT_FORBIDDEN.message)
      return
    }
    setDeleteTargetId(entry.id)
  }

  const executeDelete = async () => {
    if (closed) { toast.error(ERROR_CODES.PERIOD_CLOSED.message); return }
    if (!deleteTargetId) return
    const id = deleteTargetId
    setDeleteTargetId(null)
    try {
      assertActiveCompany(company.id)
      const { error } = await supabase.from('journal_entries').delete().eq('id', id)
        .eq('company_id', company.id)
      if (error) throw translateSupabaseError(error)
      setEntries(prev => prev.filter(e => e.id !== id))
      toast.success('仕訳を削除しました')
    } catch (e) {
      console.error(e)
      if (isAppError(e)) {
        toast.error(e.message)
      } else {
        toast.error('削除に失敗しました')
      }
    }
  }

  const handleToggleSelect = (entryId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      return next
    })
  }

  const handleToggleAll = (entryIds: string[]) => {
    setSelectedIds(prev => {
      const allSelected = entryIds.length > 0 && entryIds.every(id => prev.has(id))
      const next = new Set(prev)
      if (allSelected) {
        for (const id of entryIds) next.delete(id)
      } else {
        for (const id of entryIds) next.add(id)
      }
      return next
    })
  }

  const executeBulkDelete = async () => {
    if (closed) { toast.error(ERROR_CODES.PERIOD_CLOSED.message); return }
    if (selectedIds.size === 0) return
    setBulkDeleteDialogOpen(false)
    try {
      const ids = [...selectedIds]
      assertActiveCompany(company.id)
      const { error } = await supabase.from('journal_entries').delete().in('id', ids)
        .eq('company_id', company.id)
      if (error) throw translateSupabaseError(error)
      setEntries(prev => prev.filter(e => !ids.includes(e.id)))
      setSelectedIds(new Set())
      toast.success(`${ids.length}件の仕訳を削除しました`)
    } catch (e) {
      console.error(e)
      toast.error(isAppError(e) ? e.message : '削除に失敗しました')
    }
  }

  const executeBulkEdit = async () => {
    if (closed) { toast.error(ERROR_CODES.PERIOD_CLOSED.message); return }
    if (selectedIds.size === 0) return
    if (!changeDateFlag && !changeDescriptionFlag) return
    if (changeDateFlag) {
      if (!bulkDate) {
        toast.error('日付を入力してください')
        return
      }
      if (period && (bulkDate < period.start_date || bulkDate > period.end_date)) {
        toast.error('会計期間外の日付です')
        return
      }
    }
    setBulkEditDialogOpen(false)
    try {
      const ids = [...selectedIds]
      const updateData: Record<string, string> = {}
      if (changeDateFlag) updateData.date = bulkDate
      if (changeDescriptionFlag) updateData.description = bulkDescription
      assertActiveCompany(company.id)
      const { error } = await supabase.from('journal_entries').update(updateData).in('id', ids)
        .eq('company_id', company.id)
      // 会計期間外の日付などは DB の Trigger が拒否する。理由を画面に出すために AppError へ変換する
      if (error) throw translateSupabaseError(error)
      setEntries(prev => prev.map(e => {
        if (!ids.includes(e.id)) return e
        return {
          ...e,
          ...(changeDateFlag ? { date: bulkDate } : {}),
          ...(changeDescriptionFlag ? { description: bulkDescription } : {}),
        }
      }))
      setSelectedIds(new Set())
      toast.success(`${ids.length}件の仕訳を更新しました`)
    } catch (e) {
      console.error(e)
      toast.error(isAppError(e) && e.code !== 'DB_QUERY_FAILED' ? e.message : '更新に失敗しました')
    }
  }

  const handleInlineEditSave = async (updated: JournalEntryWithLines, referenceNumber: number | null): Promise<boolean> => {
    if (closed) throw new AccountingError(ERROR_CODES.PERIOD_CLOSED.code, ERROR_CODES.PERIOD_CLOSED.message)
    if (updated.is_opening_balance) {
      toast.error(ERROR_CODES.OPENING_BALANCE_EDIT_FORBIDDEN.message)
      return false
    }

    try {
      // ヘッダー・明細を DB 関数で1トランザクションに保存する
      await updateJournalEntry({
        companyId: company.id,
        entryId: updated.id,
        date: updated.date,
        description: updated.description,
        referenceNumber,
        supplement: updated.supplement ?? '',
        lines: updated.journal_lines.map(l => ({
          side: l.side,
          account_id: l.account_id,
          amount: l.amount,
          tax_code: l.tax_code,
        })),
      })

      await fetchEntries(searchParams, accounts, { showLoading: false, keepOrder: true })
      setDescriptionSuggestions(prev => mergeDescriptionSuggestion(prev, updated.description))
      return true
    } catch (e) {
      console.error(e)
      // 再取得のloading表示で一覧を外すと、編集中の入力も消えてしまう。
      if (isAppError(e)) {
        toast.error(e.message)
      } else {
        toast.error('保存に失敗しました。再度お試しください。')
      }
      // 編集行に入力を残し、共通エラー欄にも DB の理由を表示する。
      throw e
    }
  }

  const handleInlineEditStart = () => {
    setShowForm(false)
  }

  const handleInlineEditEnd = () => {
    // 現状は何もしない
  }

  // ショートカットのeffectから、実行時点の検索・期間・科目を参照する。
  reloadRef.current = () => { void fetchEntries(searchParams, accounts, { showLoading: false, reload: true }) }

  useEffect(() => {
    const handleF5 = (e: KeyboardEvent) => {
      if (e.key !== 'F5' || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return
      // 子のIME処理がstopPropagationしても再読み込みを防ぐため、F5だけcaptureで受ける。
      e.preventDefault()
      if (classifyF5(e, {
        editing: journalListRef.current?.isEditing() ?? false,
        formOpen: showFormRef.current,
        busy: activeFetchesRef.current.size > 0,
      }) === 'reload') reloadRef.current()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      // ショートカット一覧
      // F5: 日付順で再取得し、画面上のセル位置を保つ
      // Ctrl+Shift+E: 横並びフォームの日付欄にフォーカス
      // Ctrl+Shift+L: 借方行追加
      // Ctrl+Shift+R: 貸方行追加
      // Ctrl+Shift+S: 保存
      // Ctrl+↑: 先頭ページへ
      // Ctrl+↓: 最終ページへ（InlineJournalFormにフォーカス）
      if (e.isComposing) return
      if (e.repeat) return

      const isCtrlShift = e.ctrlKey && e.shiftKey
      if (closed && isCtrlShift && ['E', 'L', 'R', 'S'].includes(e.key)) { e.preventDefault(); return }

      if (isCtrlShift && e.key === 'E') {
        e.preventDefault()
        if (!showForm) {
          inlineFormRef.current?.focusDate()
        }
      }

      if (isCtrlShift && e.key === 'L') {
        e.preventDefault()
        if (!showForm) {
          inlineFormRef.current?.addDebit()
        }
      }

      if (isCtrlShift && e.key === 'R') {
        e.preventDefault()
        if (!showForm) {
          inlineFormRef.current?.addCredit()
        }
      }

      if (isCtrlShift && e.key === 'S') {
        e.preventDefault()
        if (showForm) {
          journalFormRef.current?.submit()
        } else {
          inlineFormRef.current?.submit()
        }
      }

      if (e.ctrlKey && !e.shiftKey && e.key === 'ArrowUp') {
        e.preventDefault()
        journalListRef.current?.goToFirstPage()
      }

      if (e.ctrlKey && !e.shiftKey && e.key === 'ArrowDown') {
        e.preventDefault()
        if (!showForm) {
          journalListRef.current?.goToLastPage()
          setTimeout(() => inlineFormRef.current?.focusDate(), 100)
        }
      }
    }

    window.addEventListener('keydown', handleF5, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleF5, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showForm, closed])

  // PDF URL を組み立て
  const buildPdfHref = (): string => {
    if (!period) return ''
    const p = new URLSearchParams()
    p.set('periodId', period.id)
    p.set('periodName', period.name)
    if (searchParams.dateFrom)  p.set('dateFrom',  searchParams.dateFrom)
    if (searchParams.dateTo)    p.set('dateTo',    searchParams.dateTo)
    if (searchParams.keyword)   p.set('keyword',   searchParams.keyword)
    if (searchParams.accountId) p.set('accountId', searchParams.accountId)
    if (searchParams.amountMin) p.set('amountMin', searchParams.amountMin)
    if (searchParams.amountMax) p.set('amountMax', searchParams.amountMax)
    return `/api/pdf/journal?${p.toString()}`
  }

  // 印刷専用の検索条件テキスト
  const buildPrintConditions = (): string => {
    const parts: string[] = []
    if (searchParams.dateFrom || searchParams.dateTo) {
      const from = searchParams.dateFrom.replace(/-/g, '/')
      const to   = searchParams.dateTo.replace(/-/g, '/')
      parts.push(`期間: ${from}〜${to}`)
    }
    if (searchParams.keyword) parts.push(`摘要: ${searchParams.keyword}`)
    if (searchParams.accountId) {
      const acct = accounts.find(a => a.id === searchParams.accountId)
      if (acct) {
        const parent = accounts.find(a => a.id === acct.parent_id)
        const label = parent ? `${parent.name}/${acct.name}` : acct.name
        parts.push(`科目: ${label}`)
      }
    }
    return parts.join('　')
  }

  return (
    <div className="mx-auto px-2 py-6 lg:px-6">
      <datalist id="desc-suggestions">
        {descriptionSuggestions.map(s => <option key={s} value={s} />)}
      </datalist>
      {/* 印刷時のみ表示するタイトル */}
      <div className="print-title mb-4">
        <h2 className="text-xl font-bold">仕訳日記帳</h2>
        {period && <p className="text-sm mt-1">{period.name}</p>}
      </div>
      {buildPrintConditions() && (
        <div className="print-only text-sm text-muted-foreground mb-4">
          {buildPrintConditions()}
        </div>
      )}

      {/* 画面表示用ヘッダー（印刷時は非表示） */}
      <div className="flex items-center justify-between mb-6 no-print">
        <h1 className="text-2xl font-bold">仕訳日記帳</h1>
        <div className="flex items-center gap-2">
          <PrintButton />
          <PDFButton
            href={buildPdfHref()}
            filename={`仕訳日記帳_${period?.name ?? ''}.pdf`}
          />
        </div>
      </div>

      <div className="mb-4 no-print"><OpeningBalanceImpactNotice companyId={company.id} periodId={period?.id ?? null} /></div>
      <div className="mb-4 no-print"><PeriodClosedNotice period={period} /></div>
      {showForm && (
        <div className="no-print">
          <JournalForm
            ref={journalFormRef}
            accounts={accounts}
            editTarget={editTarget}
            duplicateSource={duplicateSource}
            onNewAdd={handleNewAdd}
            onNewCommit={handleNewCommit}
            onNewRollback={handleNewRollback}
            onEditSave={handleEditSave}
            onDuplicateSubmitted={handleDuplicateSubmitted}
            onCancel={handleCancel}
          />
        </div>
      )}

      <div className="no-print">
        <JournalSearch
          accounts={accounts}
          params={searchParams}
          entries={entries}
          onSearch={handleSearch}
          onClear={handleClear}
        />
      </div>

      {selectedIds.size > 0 && !showForm && (
        <div className="no-print flex items-center gap-3 py-2 px-3 bg-muted rounded mb-2 text-sm">
          <span>{selectedIds.size}件選択中</span>
          <Button size="sm" variant="outline" disabled={closed} onClick={() => setBulkEditDialogOpen(true)}>
            日付・摘要を変更
          </Button>
          <Button size="sm" variant="destructive" disabled={closed} onClick={() => setBulkDeleteDialogOpen(true)}>
            削除
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            ×選択解除
          </Button>
        </div>
      )}

      {loading && <p className="text-muted-foreground text-sm">読み込み中...</p>}
      <JournalList
        readOnly={closed}
        ref={journalListRef}
        entries={entries}
        lastPageRequest={lastPageRequest}
        reloadViewportRequest={reloadViewportRequest}
        accounts={accounts}
        allTaxCodes={allTaxCodes}
        taxMethod={taxMethod}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        showInlineForm={!showForm}
        showForm={showForm}
        onInlineEditSave={handleInlineEditSave}
        onInlineEditStart={handleInlineEditStart}
        onInlineEditEnd={handleInlineEditEnd}
        selectedIds={selectedIds}
        onToggleSelect={handleToggleSelect}
        onToggleAll={handleToggleAll}
        onNavigateToInlineForm={() => {
          if (!showForm) inlineFormRef.current?.focusDate()
        }}
        inlineFormRows={
          <InlineJournalForm
            ref={inlineFormRef}
            duplicateRequest={duplicateRequest}
            onDuplicateApplied={handleDuplicateApplied}
            accounts={accounts}
            allTaxCodes={allTaxCodes}
            taxMethod={taxMethod}
            onNewAdd={handleNewAdd}
            onNewCommit={handleNewCommit}
            onNewRollback={handleNewRollback}
            onNavigateUp={col => journalListRef.current?.focusLastEntryCell(col)}
          />
        }
      />

      <Dialog open={deleteTargetId !== null} onOpenChange={(open) => { if (!open) setDeleteTargetId(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>仕訳の削除</DialogTitle>
          </DialogHeader>
          <p className="text-sm">この仕訳を削除しますか？この操作は取り消せません。</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTargetId(null)}>キャンセル</Button>
            <Button variant="destructive" disabled={closed} onClick={executeDelete}>削除する</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>一括削除</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{selectedIds.size}件の仕訳を削除します。この操作は取り消せません。</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteDialogOpen(false)}>キャンセル</Button>
            <Button variant="destructive" disabled={closed} onClick={executeBulkDelete}>削除する</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkEditDialogOpen} onOpenChange={setBulkEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>一括変更（{selectedIds.size}件）</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="changeDateFlag"
                disabled={closed}
                checked={changeDateFlag}
                onChange={e => setChangeDateFlag(e.target.checked)}
                className="mt-1"
              />
              <div className="flex-1 space-y-1">
                <Label htmlFor="bulkDate" className={!changeDateFlag ? 'text-muted-foreground' : ''}>日付</Label>
                <Input
                  id="bulkDate"
                  type="date"
                  value={bulkDate}
                  onChange={e => setBulkDate(e.target.value)}
                  disabled={closed || !changeDateFlag}
                />
              </div>
            </div>
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="changeDescriptionFlag"
                disabled={closed}
                checked={changeDescriptionFlag}
                onChange={e => setChangeDescriptionFlag(e.target.checked)}
                className="mt-1"
              />
              <div className="flex-1 space-y-1">
                <Label htmlFor="bulkDescription" className={!changeDescriptionFlag ? 'text-muted-foreground' : ''}>摘要</Label>
                <Input
                  id="bulkDescription"
                  type="text"
                  value={bulkDescription}
                  onChange={e => setBulkDescription(e.target.value)}
                  disabled={closed || !changeDescriptionFlag}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkEditDialogOpen(false)}>キャンセル</Button>
            <Button
              onClick={executeBulkEdit}
              disabled={closed || (!changeDateFlag && !changeDescriptionFlag)}
            >
              変更する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function JournalsPage() {
  return (
    <Suspense fallback={<div className="mx-auto px-2 py-6 lg:px-6"><p className="text-muted-foreground text-sm">読み込み中...</p></div>}>
      <JournalsContent />
    </Suspense>
  )
}
