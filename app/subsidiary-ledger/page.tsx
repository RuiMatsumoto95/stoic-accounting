'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompany } from '@/contexts/CompanyContext'
import { Label } from '@/components/ui/label'
import { useCurrentPeriod } from '@/contexts/FiscalPeriodContext'
import PrintButton from '@/components/print/PrintButton'
import PDFButton from '@/components/pdf/PDFButton'
import { getSubsidiaryLedgerReport, type SubsidiaryLedgerRow } from '@/lib/reports/subsidiary-ledger'

type Account = {
  id: string
  code: string
  name: string
  type: string
  parent_id: string | null
  parent_name: string
}

export default function SubsidiaryLedgerPage() {
  const company = useCompany()
  const { period } = useCurrentPeriod()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [selectedAccountType, setSelectedAccountType] = useState('')
  const [rows, setRows] = useState<SubsidiaryLedgerRow[]>([])
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

    const allAccounts = data ?? []
    const parentMap = new Map<string, string>(
      allAccounts.filter((a) => a.parent_id === null).map((a) => [a.id, a.name])
    )
    const subsidiaries: Account[] = allAccounts
      .filter((a) => a.parent_id !== null)
      .map((a) => ({
        ...a,
        parent_name: parentMap.get(a.parent_id!) ?? '',
      }))

    setAccounts(subsidiaries)
  }, [company.id])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  const fetchLedger = useCallback(async (accountId: string, accountType: string) => {
    if (!accountId || !period) return
    setLoading(true)
    setErrorMessage('')
    try {
      const report = await getSubsidiaryLedgerReport({
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
    if (accountId && period) {
      fetchLedger(accountId, account?.type ?? '')
    }
  }

  const fmt = (n: number) => n.toLocaleString('ja-JP')

  const isDebitNormal = ['ASSET', 'EXPENSE'].includes(selectedAccountType)
  const showOpeningRow = openingBalance !== 0
  const hasData = rows.length > 0 || showOpeningRow

  const openingDebit = isDebitNormal
    ? (openingBalance > 0 ? openingBalance : 0)
    : (openingBalance < 0 ? -openingBalance : 0)
  const openingCredit = isDebitNormal
    ? (openingBalance < 0 ? -openingBalance : 0)
    : (openingBalance > 0 ? openingBalance : 0)

  const selectedAccount = accounts.find(a => a.id === selectedAccountId)
  const printLabel = selectedAccount
    ? `${selectedAccount.parent_name} › ${selectedAccount.name}`
    : ''

  const buildPdfHref = (): string => {
    if (!period || !selectedAccountId || !selectedAccountType) return ''
    const p = new URLSearchParams()
    p.set('periodId', period.id)
    p.set('periodName', period.name)
    p.set('accountId', selectedAccountId)
    p.set('accountType', selectedAccountType)
    return `/api/pdf/subsidiary-ledger?${p.toString()}`
  }

  const canPdf = !!period && !!selectedAccountId

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* 印刷時のみ表示するタイトル・科目情報 */}
      <div className="print-title mb-4">
        <h2 className="text-xl font-bold">補助元帳</h2>
        {period && <p className="text-sm mt-1">{period.name}</p>}
      </div>
      {printLabel && (
        <div className="print-only text-sm text-muted-foreground mb-4">
          {printLabel}
        </div>
      )}

      {/* 画面表示用ヘッダー（印刷時は非表示） */}
      <div className="flex items-center justify-between mb-6 no-print">
        <h1 className="text-2xl font-bold">補助元帳</h1>
        <div className="flex items-center gap-2">
          <PrintButton />
          {canPdf && (
            <PDFButton
              href={buildPdfHref()}
              filename={`補助元帳_${selectedAccount?.name ?? ''}_${period?.name ?? ''}.pdf`}
            />
          )}
        </div>
      </div>

      <div className="mb-6 no-print">
        <Label htmlFor="account-select">補助科目</Label>
        <select
          id="account-select"
          className="mt-1 block w-80 border rounded px-3 py-2 text-sm bg-background"
          value={selectedAccountId}
          onChange={handleAccountChange}
        >
          <option value="">補助科目を選択してください</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.parent_name} › {a.name}
            </option>
          ))}
        </select>
      </div>

      {errorMessage ? (
        <p role="alert" className="text-destructive">{errorMessage}</p>
      ) : loading ? (
        <p className="text-muted-foreground text-sm">読み込み中...</p>
      ) : selectedAccountId ? (
        !hasData ? (
          <p className="text-muted-foreground text-sm">この科目の仕訳データがありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-2 w-28">日付</th>
                  <th className="p-2 w-24">伝票番号</th>
                  <th className="p-2 w-36">相手科目</th>
                  <th className="p-2">摘要</th>
                  <th className="p-2 w-28 text-right">借方</th>
                  <th className="p-2 w-28 text-right">貸方</th>
                  <th className="p-2 w-28 text-right">残高</th>
                </tr>
              </thead>
              <tbody>
                {/* 前期繰越行（BS科目かつ期首残高あり） */}
                {showOpeningRow && (
                  <tr className="border-b bg-muted/50">
                    <td className="p-2">{period?.start_date ?? ''}</td>
                    <td className="p-2 text-muted-foreground">-</td>
                    <td className="p-2 text-muted-foreground">-</td>
                    <td className="p-2 font-medium">前期繰越</td>
                    <td className="p-2 text-right tabular-nums">
                      {openingDebit > 0 ? fmt(openingDebit) : ''}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {openingCredit > 0 ? fmt(openingCredit) : ''}
                    </td>
                    <td className="p-2 text-right font-medium tabular-nums">
                      {fmt(Math.abs(openingBalance))}
                    </td>
                  </tr>
                )}

                {rows.map((row) => (
                  <tr key={`${row.id}-${row.line_number}`} className="border-b hover:bg-muted/30">
                    <td className="p-2">{row.date}</td>
                    <td className="p-2">{row.reference_number ?? '-'}</td>
                    <td className="p-2">{row.counter_account_name ?? '-'}</td>
                    <td className="p-2">{row.entry_description}</td>
                    <td className="p-2 text-right tabular-nums">
                      {row.side === 'DEBIT' ? fmt(row.amount) : ''}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {row.side === 'CREDIT' ? fmt(row.amount) : ''}
                    </td>
                    <td className="p-2 text-right tabular-nums">{fmt(row.balance)}</td>
                  </tr>
                ))}

                <tr className="border-t-2 font-semibold bg-muted/50">
                  <td className="p-2" colSpan={4}>合計</td>
                  <td className="p-2 text-right tabular-nums">
                    {fmt(rows.filter((r) => r.side === 'DEBIT').reduce((s, r) => s + r.amount, 0))}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {fmt(rows.filter((r) => r.side === 'CREDIT').reduce((s, r) => s + r.amount, 0))}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {fmt(rows.length > 0 ? rows[rows.length - 1].balance : openingBalance)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )
      ) : (
        <p className="text-muted-foreground text-sm">
          補助科目を選択すると明細が表示されます。
        </p>
      )}
    </div>
  )
}
