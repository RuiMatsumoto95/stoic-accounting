import { getReportPeriod } from './scope'
import { getCompanyIdByPeriod } from '@/lib/company-scope'
import { supabase } from '@/lib/supabase'
import { getOpeningBalancesByType } from '@/lib/balance-calculator'

export const TYPE_LABELS: Record<string, string> = {
  ASSET: '資産',
  LIABILITY: '負債',
  EQUITY: '純資産',
  REVENUE: '収益',
  EXPENSE: '費用',
}

const BS_TYPES = ['ASSET', 'LIABILITY', 'EQUITY']

export type SubsidiaryBalanceRow = {
  accountId: string
  accountName: string
  parentAccountName: string
  openingBalance: number
  debitTotal: number
  creditTotal: number
  closingBalance: number
  isBs: boolean
}

export type SubsidiaryBalanceGroup = {
  parentId: string
  parentName: string
  parentType: string
  isBs: boolean
  rows: SubsidiaryBalanceRow[]
  openingSubtotal: number
  debitSubtotal: number
  creditSubtotal: number
  closingSubtotal: number
}

export interface SubsidiaryBalanceReport {
  periodName: string
  groups: SubsidiaryBalanceGroup[]
  grandOpening: number
  grandDebit: number
  grandCredit: number
  grandClosing: number
}

type RawAccount = {
  id: string
  code: string
  name: string
  type: string
  parent_id: string | null
}

export async function getSubsidiaryBalanceReport({
  periodId,
  periodName,
}: {
  periodId: string
  periodName: string
}): Promise<SubsidiaryBalanceReport> {
  const companyId = await getCompanyIdByPeriod(periodId)
  periodName = (await getReportPeriod(periodId)).name
  const [
    { data: accounts, error: accountsError },
    { data: entries, error: entriesError },
  ] = await Promise.all([
    supabase.from('accounts').select('id, code, name, type, parent_id').order('code', { ascending: true }).eq('company_id', companyId),
    supabase.from('journal_entries').select('id').eq('period_id', periodId),
  ])

  if (accountsError) throw new Error(accountsError.message)
  if (entriesError) throw new Error(entriesError.message)

  const allAccounts = (accounts ?? []) as RawAccount[]
  const parentMap = new Map<string, RawAccount>(
    allAccounts.filter(a => a.parent_id === null).map(a => [a.id, a])
  )
  const subsidiaryAccounts = allAccounts.filter(a => a.parent_id !== null)

  if (subsidiaryAccounts.length === 0) {
    return { periodName, groups: [], grandOpening: 0, grandDebit: 0, grandCredit: 0, grandClosing: 0 }
  }

  // 期首残高の取得（BS科目のみ、補助科目単位）
  const obMap = await getOpeningBalancesByType(periodId, ['ASSET', 'LIABILITY', 'EQUITY'])

  // 当期明細の集計（entryIds が空でも続行 → 期首残高のみの場合に対応）
  const entryIds = (entries ?? []).map((e: { id: string }) => e.id)
  const totals: Record<string, { debit: number; credit: number }> = {}

  if (entryIds.length > 0) {
    const subsidiaryIds = subsidiaryAccounts.map(a => a.id)
    const { data: lines, error: linesError } = await supabase
      .from('journal_lines')
      .select('account_id, side, amount')
      .in('entry_id', entryIds)
      .in('account_id', subsidiaryIds)

    if (linesError) throw new Error(linesError.message)

    for (const line of (lines ?? []) as { account_id: string; side: string; amount: number }[]) {
      if (!totals[line.account_id]) totals[line.account_id] = { debit: 0, credit: 0 }
      if (line.side === 'DEBIT') {
        totals[line.account_id].debit += Number(line.amount)
      } else {
        totals[line.account_id].credit += Number(line.amount)
      }
    }
  }

  // 補助科目ごとに集計
  const rawRows: {
    account: RawAccount
    parentAccount: RawAccount
    openingBalance: number
    debitTotal: number
    creditTotal: number
    closingBalance: number
    isBs: boolean
  }[] = []

  for (const account of subsidiaryAccounts) {
    const parentAccount = parentMap.get(account.parent_id!)
    if (!parentAccount) continue

    const isBs = BS_TYPES.includes(parentAccount.type)
    const isDebitNormal = ['ASSET', 'EXPENSE'].includes(parentAccount.type)
    const openingBalance = isBs ? (obMap.get(account.id) ?? 0) : 0
    const t = totals[account.id] ?? { debit: 0, credit: 0 }

    // 期首残高も当期取引もない → スキップ
    if (openingBalance === 0 && t.debit === 0 && t.credit === 0) continue

    const currentBalance = isDebitNormal ? t.debit - t.credit : t.credit - t.debit
    const closingBalance = openingBalance + currentBalance

    rawRows.push({
      account,
      parentAccount,
      openingBalance,
      debitTotal: t.debit,
      creditTotal: t.credit,
      closingBalance,
      isBs,
    })
  }

  // 親科目でグループ化
  const groupMap = new Map<string, SubsidiaryBalanceGroup>()
  for (const r of rawRows) {
    const parentId = r.parentAccount.id
    if (!groupMap.has(parentId)) {
      groupMap.set(parentId, {
        parentId,
        parentName: r.parentAccount.name,
        parentType: r.parentAccount.type,
        isBs: r.isBs,
        rows: [],
        openingSubtotal: 0,
        debitSubtotal: 0,
        creditSubtotal: 0,
        closingSubtotal: 0,
      })
    }
    const group = groupMap.get(parentId)!
    group.rows.push({
      accountId: r.account.id,
      accountName: r.account.name,
      parentAccountName: r.parentAccount.name,
      openingBalance: r.openingBalance,
      debitTotal: r.debitTotal,
      creditTotal: r.creditTotal,
      closingBalance: r.closingBalance,
      isBs: r.isBs,
    })
    group.openingSubtotal += r.openingBalance
    group.debitSubtotal   += r.debitTotal
    group.creditSubtotal  += r.creditTotal
    group.closingSubtotal += r.closingBalance
  }

  const groups = Array.from(groupMap.values())

  return {
    periodName,
    groups,
    grandOpening: rawRows.reduce((s, r) => s + r.openingBalance, 0),
    grandDebit:   rawRows.reduce((s, r) => s + r.debitTotal, 0),
    grandCredit:  rawRows.reduce((s, r) => s + r.creditTotal, 0),
    grandClosing: rawRows.reduce((s, r) => s + r.closingBalance, 0),
  }
}
