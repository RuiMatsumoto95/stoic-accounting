'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompany } from '@/contexts/CompanyContext'
import LedgerTable from '@/components/ledger/LedgerTable'
import { Label } from '@/components/ui/label'
import { useCurrentPeriod } from '@/contexts/FiscalPeriodContext'
import PrintButton from '@/components/print/PrintButton'
import PDFButton from '@/components/pdf/PDFButton'
import { getLedgerReport, type LedgerRow } from '@/lib/reports/ledger'

type Account = {
  id: string
  code: string
  name: string
  type: string
  parent_id: string | null
}

export default function LedgerPage() {
  const company = useCompany()
  const { period } = useCurrentPeriod()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [selectedAccountType, setSelectedAccountType] = useState('')
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [openingBalance, setOpeningBalance] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const fetchAccounts = useCallback(async () => {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, code, name, type, parent_id')
      .eq('company_id', company.id)
      .order('code', { ascending: true })

    if (error) { console.error(error); return }
    setAccounts(data ?? [])
  }, [company.id])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  const fetchLedger = useCallback(async (accountId: string, accountType: string) => {
    if (!accountId || !period) return
    setLoading(true)
    setErrorMessage('')
    try {
      const report = await getLedgerReport({
        periodId: period.id,
        periodName: period.name,
        accountId,
        accountType,
        periodStartDate: period.start_date,
      })
      setRows(report.rows)
      setOpeningBalance(report.openingBalance)
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'データの取得に失敗しました。')
    } finally {
      setLoading(false)
    }
  }, [period])

  const handleAccountChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const accountId = e.target.value
    const account = accounts.find((a) => a.id === accountId)
    setSelectedAccountId(accountId)
    setSelectedAccountType(account?.type ?? '')
    setRows([])
    setOpeningBalance(0)
    if (accountId) {
      fetchLedger(accountId, account?.type ?? '')
    }
  }

  const parentAccounts = accounts.filter(a => a.parent_id === null)
  const isDebitNormal = ['ASSET', 'EXPENSE'].includes(selectedAccountType)

  const selectedAccount = accounts.find(a => a.id === selectedAccountId)
  const selectedAccountLabel = selectedAccount
    ? `${selectedAccount.code} ${selectedAccount.name}`
    : ''

  const buildPdfHref = (): string => {
    if (!period || !selectedAccountId || !selectedAccountType) return ''
    const p = new URLSearchParams()
    p.set('periodId', period.id)
    p.set('periodName', period.name)
    p.set('accountId', selectedAccountId)
    p.set('accountType', selectedAccountType)
    return `/api/pdf/ledger?${p.toString()}`
  }

  const canPdf = !!period && !!selectedAccountId

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* 印刷時のみ表示するタイトル・科目情報 */}
      <div className="print-title mb-4">
        <h2 className="text-xl font-bold">総勘定元帳</h2>
        {period && <p className="text-sm mt-1">{period.name}</p>}
      </div>
      {selectedAccountLabel && (
        <div className="print-only text-sm text-muted-foreground mb-4">
          科目：{selectedAccountLabel}
        </div>
      )}

      {/* 画面表示用ヘッダー（印刷時は非表示） */}
      <div className="flex items-center justify-between mb-6 no-print">
        <h1 className="text-2xl font-bold">総勘定元帳</h1>
        <div className="flex items-center gap-2">
          <PrintButton />
          {canPdf && (
            <PDFButton
              href={buildPdfHref()}
              filename={`総勘定元帳_${selectedAccount?.name ?? ''}_${period?.name ?? ''}.pdf`}
            />
          )}
        </div>
      </div>

      {/* 科目選択 */}
      <div className="mb-6 no-print">
        <Label htmlFor="account-select">勘定科目</Label>
        <select
          id="account-select"
          className="mt-1 block w-64 border rounded px-3 py-2 text-sm bg-background"
          value={selectedAccountId}
          onChange={handleAccountChange}
        >
          <option value="">科目を選択してください</option>
          {parentAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} {a.name}
            </option>
          ))}
        </select>
      </div>

      {/* 明細テーブル */}
      {errorMessage ? (
        <p role="alert" className="text-destructive">{errorMessage}</p>
      ) : loading ? (
        <p className="text-muted-foreground text-sm">読み込み中...</p>
      ) : selectedAccountId ? (
        <LedgerTable
          rows={rows}
          openingBalance={openingBalance}
          isDebitNormal={isDebitNormal}
          periodStartDate={period?.start_date ?? ''}
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          科目を選択すると明細が表示されます。
        </p>
      )}
    </div>
  )
}
