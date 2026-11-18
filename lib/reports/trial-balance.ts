import { getReportPeriod } from './scope'
import { getCompanyIdByPeriod } from '@/lib/company-scope'
import { supabase } from '@/lib/supabase'
import { getOpeningBalancesByType } from '@/lib/balance-calculator'

export const TYPE_LABELS: Record<string, string> = {
  ASSET:     '資産',
  LIABILITY: '負債',
  EQUITY:    '純資産',
  REVENUE:   '収益',
  EXPENSE:   '費用',
}

export const TYPE_ORDER    = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']
export const BS_TYPES      = ['ASSET', 'LIABILITY', 'EQUITY']
export const BS_TYPE_ORDER = ['ASSET', 'LIABILITY', 'EQUITY']
export const PL_TYPE_ORDER = ['REVENUE', 'EXPENSE']

export interface TrialBalanceRow {
  accountId: string
  accountCode: string
  accountName: string
  accountType: string
  openingBalance: number
  debitTotal: number
  creditTotal: number
  closingBalance: number
  children?: TrialBalanceRow[]
}

export interface TrialBalanceGroup {
  type: string
  label: string
  rows: TrialBalanceRow[]
  openingSubtotal: number
  debitSubtotal: number
  creditSubtotal: number
  closingSubtotal: number
}

export interface TrialBalanceReport {
  periodName: string
  groups: TrialBalanceGroup[]
  grandOpening: number
  grandDebit: number
  grandCredit: number
  grandClosing: number
}

export async function getTrialBalanceReport({
  periodId,
  periodName,
  filterTypes,
  includeSubsidiaries,
}: {
  periodId: string
  periodName: string
  filterTypes?: string[]
  includeSubsidiaries?: boolean
}): Promise<TrialBalanceReport> {
  const companyId = await getCompanyIdByPeriod(periodId)
  periodName = (await getReportPeriod(periodId)).name
  const [{ data: accounts, error: accountsError }, { data: entries, error: entriesError }] =
    await Promise.all([
      supabase.from('accounts').select('id, code, name, type, parent_id').order('code', { ascending: true }).eq('company_id', companyId),
      supabase.from('journal_entries').select('id').eq('period_id', periodId),
    ])

  if (accountsError) throw accountsError
  if (entriesError)  throw entriesError

  const allAccounts = accounts ?? []

  // 補助科目 → 親科目IDの逆引きマップ
  const parentIdOf = new Map<string, string>()
  for (const a of allAccounts) {
    if (a.parent_id !== null) parentIdOf.set(a.id, a.parent_id)
  }

  // 期首残高（BS科目のみ）。補助科目分は親科目に合算
  const obByParent: Record<string, number> = {}
  const obMap = await getOpeningBalancesByType(periodId, ['ASSET', 'LIABILITY', 'EQUITY'])
  for (const [acctId, ob] of obMap) {
    const targetId = parentIdOf.get(acctId) ?? acctId
    obByParent[targetId] = (obByParent[targetId] ?? 0) + ob
  }

  // 当期仕訳明細の集計
  const entryIds = (entries ?? []).map(e => e.id)
  const totals: Record<string, { debit: number; credit: number }> = {}
  const subTotals: Record<string, { debit: number; credit: number }> = {}

  if (entryIds.length > 0) {
    const { data: lines, error: linesError } = await supabase
      .from('journal_lines')
      .select('account_id, side, amount')
      .in('entry_id', entryIds)

    if (linesError) throw linesError

    for (const line of lines ?? []) {
      const targetId = parentIdOf.get(line.account_id) ?? line.account_id
      if (!totals[targetId]) totals[targetId] = { debit: 0, credit: 0 }
      if (line.side === 'DEBIT') {
        totals[targetId].debit += Number(line.amount)
      } else {
        totals[targetId].credit += Number(line.amount)
      }

      if (includeSubsidiaries) {
        if (!subTotals[line.account_id]) subTotals[line.account_id] = { debit: 0, credit: 0 }
        if (line.side === 'DEBIT') {
          subTotals[line.account_id].debit += Number(line.amount)
        } else {
          subTotals[line.account_id].credit += Number(line.amount)
        }
      }
    }
  }

  // 親科目 → 補助科目リストのマップ（includeSubsidiaries 時のみ構築）
  const subsidiaryMap = new Map<string, typeof allAccounts>()
  if (includeSubsidiaries) {
    for (const a of allAccounts) {
      if (a.parent_id !== null) {
        const list = subsidiaryMap.get(a.parent_id) ?? []
        list.push(a)
        subsidiaryMap.set(a.parent_id, list)
      }
    }
  }

  // 親科目のみで行を構築
  const rows: TrialBalanceRow[] = []
  for (const account of allAccounts.filter(a => a.parent_id === null)) {
    const isBs = BS_TYPES.includes(account.type)
    const isDebitNormal = ['ASSET', 'EXPENSE'].includes(account.type)
    const openingBalance = isBs ? (obByParent[account.id] ?? 0) : 0
    const t = totals[account.id] ?? { debit: 0, credit: 0 }

    if (openingBalance === 0 && t.debit === 0 && t.credit === 0) continue

    const currentBalance = isDebitNormal ? t.debit - t.credit : t.credit - t.debit
    const closingBalance = openingBalance + currentBalance

    const row: TrialBalanceRow = {
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type,
      openingBalance,
      debitTotal: t.debit,
      creditTotal: t.credit,
      closingBalance,
    }

    if (includeSubsidiaries) {
      const subs = subsidiaryMap.get(account.id) ?? []
      const children: TrialBalanceRow[] = []
      for (const sub of subs) {
        const subOb = isBs ? (obMap.get(sub.id) ?? 0) : 0
        const st = subTotals[sub.id] ?? { debit: 0, credit: 0 }
        if (subOb === 0 && st.debit === 0 && st.credit === 0) continue
        const subCurrent = isDebitNormal ? st.debit - st.credit : st.credit - st.debit
        children.push({
          accountId:      sub.id,
          accountCode:    sub.code,
          accountName:    sub.name,
          accountType:    sub.type,
          openingBalance: subOb,
          debitTotal:     st.debit,
          creditTotal:    st.credit,
          closingBalance: subOb + subCurrent,
        })
      }
      if (children.length > 0) row.children = children
    }

    rows.push(row)
  }

  // 科目区分でグループ化（filterTypes 指定時はその区分のみ）
  const activeTypes = filterTypes ?? TYPE_ORDER
  const groups: TrialBalanceGroup[] = TYPE_ORDER
    .filter(type => activeTypes.includes(type))
    .map(type => {
      const typeRows = rows.filter(r => r.accountType === type)
      return {
        type,
        label: TYPE_LABELS[type],
        rows: typeRows,
        openingSubtotal: typeRows.reduce((s, r) => s + r.openingBalance, 0),
        debitSubtotal:   typeRows.reduce((s, r) => s + r.debitTotal, 0),
        creditSubtotal:  typeRows.reduce((s, r) => s + r.creditTotal, 0),
        closingSubtotal: typeRows.reduce((s, r) => s + r.closingBalance, 0),
      }
    })
    .filter(g => g.rows.length > 0)

  const grandRows = filterTypes
    ? rows.filter(r => filterTypes.includes(r.accountType))
    : rows

  return {
    periodName,
    groups,
    grandOpening: grandRows.reduce((s, r) => s + r.openingBalance, 0),
    grandDebit:   grandRows.reduce((s, r) => s + r.debitTotal, 0),
    grandCredit:  grandRows.reduce((s, r) => s + r.creditTotal, 0),
    grandClosing: grandRows.reduce((s, r) => s + r.closingBalance, 0),
  }
}
