import { getReportPeriod } from './scope'
import { NotFoundError, ERROR_CODES } from '@/lib/errors'
import { getCompanyIdByPeriod } from '@/lib/company-scope'
import { supabase } from '@/lib/supabase'
import { getOpeningBalancesByType } from '@/lib/balance-calculator'

export type SubsidiaryLedgerRow = {
  id: string
  line_number: number
  date: string
  reference_number: number | null
  entry_description: string
  counter_account_name: string | null
  side: 'DEBIT' | 'CREDIT'
  amount: number
  balance: number
}

export interface SubsidiaryLedgerReport {
  periodName: string
  accountName: string
  parentName: string
  openingBalance: number
  isDebitNormal: boolean
  periodStartDate: string
  rows: SubsidiaryLedgerRow[]
}

export async function getSubsidiaryLedgerReport({
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
}): Promise<SubsidiaryLedgerReport> {
  const companyId = await getCompanyIdByPeriod(periodId)
  periodName = (await getReportPeriod(periodId)).name
  // 全科目取得（対象科目名・親科目名の解決に使用）
  const { data: accountsData, error: accountsError } = await supabase
    .from('accounts')
    .select('id, name, parent_id').eq('company_id', companyId)

  if (accountsError) throw new Error(accountsError.message)

  const accounts = (accountsData ?? []) as { id: string; name: string; parent_id: string | null }[]
  const accountMap = new Map(accounts.map(a => [a.id, a]))

  const targetAccount = accountMap.get(accountId)
  if (!targetAccount) throw new NotFoundError(ERROR_CODES.ACCOUNT_NOT_FOUND.code, ERROR_CODES.ACCOUNT_NOT_FOUND.message)
  const accountName = targetAccount?.name ?? ''
  const parentAccount = targetAccount?.parent_id ? accountMap.get(targetAccount.parent_id) : null
  const parentName = parentAccount?.name ?? ''

  // BS科目の場合、前期末残高を期首残高として取得
  const isBsType = ['ASSET', 'LIABILITY', 'EQUITY'].includes(accountType)
  const isDebitNormal = ['ASSET', 'EXPENSE'].includes(accountType)

  let openingBalance = 0
  if (isBsType) {
    const obMap = await getOpeningBalancesByType(periodId, ['ASSET', 'LIABILITY', 'EQUITY'])
    openingBalance = obMap.get(accountId) ?? 0
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
    .eq('account_id', accountId)
    .eq('period_id', periodId)
    .order('date', { ascending: true })
    .order('entry_id', { ascending: true })

  if (viewError) throw new Error(viewError.message)

  // 残高を計算（期首残高を開始値として累積）
  let balance = openingBalance
  const rows: SubsidiaryLedgerRow[] = (viewData ?? []).map((row) => {
    const rawRow = row as {
      id: string
      line_number: number
      date: string
      reference_number: number | null
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
      entry_description: rawRow.entry_description,
      counter_account_name: rawRow.counter_account_name,
      side: rawRow.side,
      amount: Number(rawRow.amount),
      balance,
    }
  })

  return { periodName, accountName, parentName, openingBalance, isDebitNormal, periodStartDate, rows }
}
