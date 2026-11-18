import { getReportPeriod } from './scope'
import { getCompanyIdByPeriod } from '@/lib/company-scope'
import { supabase } from '@/lib/supabase'
import { getOpeningBalancesByType } from '@/lib/balance-calculator'
import { NotFoundError, ERROR_CODES } from '@/lib/errors'

export type LedgerRow = {
  id: string
  line_number: number
  date: string
  reference_number: number | null
  account_name: string
  entry_description: string
  counter_account_name: string | null
  side: 'DEBIT' | 'CREDIT'
  amount: number
  balance: number
}

export interface LedgerReport {
  periodName: string
  accountCode: string
  accountName: string
  openingBalance: number
  isDebitNormal: boolean
  periodStartDate: string
  rows: LedgerRow[]
}

export async function getLedgerReport({
  periodId,
  periodName,
  accountId,
  accountType,
  periodStartDate: periodStartDateArg,
}: {
  periodId: string
  periodName: string
  accountId: string
  accountType: string
  periodStartDate?: string
}): Promise<LedgerReport> {
  const companyId = await getCompanyIdByPeriod(periodId)
  periodName = (await getReportPeriod(periodId)).name
  // 全科目を取得（名前解決・補助科目展開に使用）
  const { data: accountsData, error: accountsError } = await supabase
    .from('accounts')
    .select('id, code, name, type, parent_id').eq('company_id', companyId)
    .order('code', { ascending: true })

  if (accountsError) throw new Error(accountsError.message)

  const accounts = (accountsData ?? []) as {
    id: string; code: string; name: string; type: string; parent_id: string | null
  }[]

  // 対象科目の code・name を解決
  const targetAccount = accounts.find(a => a.id === accountId)
  if (!targetAccount) {
    throw new NotFoundError(
      ERROR_CODES.ACCOUNT_NOT_FOUND.code,
      ERROR_CODES.ACCOUNT_NOT_FOUND.message
    )
  }
  const accountCode = targetAccount?.code ?? ''
  const accountName = targetAccount?.name ?? ''

  // 親科目 + その補助科目のIDを収集
  const accountIds = [
    accountId,
    ...accounts.filter(a => a.parent_id === accountId).map(a => a.id),
  ]

  // 科目名の逆引きマップ
  const accountNameMap = new Map(accounts.map(a => [a.id, a.name]))

  // 期首残高を取得（BS科目のみ）
  const isBsType = ['ASSET', 'LIABILITY', 'EQUITY'].includes(accountType)
  const isDebitNormal = ['ASSET', 'EXPENSE'].includes(accountType)

  let openingBalance = 0
  if (isBsType) {
    const obMap = await getOpeningBalancesByType(periodId, ['ASSET', 'LIABILITY', 'EQUITY'])
    for (const id of accountIds) {
      openingBalance += obMap.get(id) ?? 0
    }
  }

  // 会計期間の開始日（引数で渡された場合はDBクエリをスキップ）
  let periodStartDate = periodStartDateArg ?? ''
  if (!periodStartDate) {
    const { data: periodData, error: periodError } = await supabase
      .from('fiscal_periods')
      .select('start_date').eq('company_id', companyId)
      .eq('id', periodId)
      .single()

    if (periodError) throw new Error(periodError.message)
    periodStartDate = (periodData as { start_date: string }).start_date
  }

  // ledger_view から明細を取得
  const { data: viewData, error: viewError } = await supabase
    .from('ledger_view')
    .select('*')
    .in('account_id', accountIds)
    .eq('period_id', periodId)
    .order('date', { ascending: true })
    .order('entry_id', { ascending: true })

  if (viewError) throw new Error(viewError.message)

  // 残高を計算（期首残高を開始値として累積）
  let balance = openingBalance
  const rows: LedgerRow[] = (viewData ?? []).map((row) => {
    const rawRow = row as {
      id: string
      line_number: number
      date: string
      reference_number: number | null
      account_id: string
      entry_description: string
      counter_account_name: string | null
      side: 'DEBIT' | 'CREDIT'
      amount: number
    }

    if (isDebitNormal) {
      balance += rawRow.side === 'DEBIT' ? Number(rawRow.amount) : -Number(rawRow.amount)
    } else {
      balance += rawRow.side === 'CREDIT' ? Number(rawRow.amount) : -Number(rawRow.amount)
    }

    return {
      id: rawRow.id,
      line_number: rawRow.line_number,
      date: rawRow.date,
      reference_number: rawRow.reference_number,
      account_name: accountNameMap.get(rawRow.account_id) ?? '',
      entry_description: rawRow.entry_description,
      counter_account_name: rawRow.counter_account_name,
      side: rawRow.side,
      amount: Number(rawRow.amount),
      balance,
    }
  })

  return {
    periodName,
    accountCode,
    accountName,
    openingBalance,
    isDebitNormal,
    periodStartDate,
    rows,
  }
}
