import { normalizeOpeningBalance } from './account-balance'
import { getCompanyIdByPeriod } from './company-scope'
import { supabase } from './supabase'
import { translateSupabaseError } from './supabase-error-handler'
import { FiscalPeriod } from './fiscal-period'

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'


// 指定した期の前期を返す。第1期の場合は null
export async function getPreviousPeriod(periodId: string): Promise<FiscalPeriod | null> {
  const { data: current } = await supabase
    .from('fiscal_periods')
    .select('start_date, company_id')
    .eq('id', periodId)
    .single()

  if (!current) return null

  const { data } = await supabase
    .from('fiscal_periods')
    .select('*')
    .eq('company_id', current.company_id)
    .lt('end_date', (current as { start_date: string }).start_date)
    .order('end_date', { ascending: false })
    .limit(1)

  return data && data.length > 0 ? (data[0] as FiscalPeriod) : null
}

// 指定した期・指定した科目の期末残高を返す（DEBIT合計 - CREDIT合計）
export async function getClosingBalance(
  periodId: string,
  accountId: string
): Promise<number> {
  const { data: entries } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('period_id', periodId)

  if (!entries || entries.length === 0) return 0

  const entryIds = (entries as { id: string }[]).map(e => e.id)

  const { data: lines } = await supabase
    .from('journal_lines')
    .select('side, amount')
    .eq('account_id', accountId)
    .in('entry_id', entryIds)

  if (!lines || lines.length === 0) return 0

  let debit = 0
  let credit = 0
  for (const line of lines as { side: string; amount: number }[]) {
    if (line.side === 'DEBIT') debit += Number(line.amount)
    else credit += Number(line.amount)
  }
  return debit - credit
}

// DBが損益・事業主貸借を繰越先へ畳み込んだ期首残高（手動設定があればその値）を返す。
// ASSET/EXPENSE は借方残が正、LIABILITY/EQUITY/REVENUE は貸方残が正
// 残高0の科目はMapに含まれない（呼び出し元で0として扱う）
export async function getOpeningBalancesByType(
  periodId: string,
  accountTypes: AccountType[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const companyId = await getCompanyIdByPeriod(periodId)

  const { data, error } = await supabase.rpc('get_opening_balances_for_period', {
    target_period_id: periodId,
  })

  if (error) throw translateSupabaseError(error)

  if (!data || (data as unknown[]).length === 0) return result

  const rows = data as { account_id: string; balance: number }[]
  const accountIds = rows.map(r => r.account_id)

  const { data: accounts, error: accountsError } = await supabase
    .from('accounts')
    .select('id, type')
    .eq('company_id', companyId)
    .in('id', accountIds)
    .in('type', accountTypes)

  if (accountsError) throw translateSupabaseError(accountsError)

  if (!accounts || accounts.length === 0) return result

  const accountTypeMap = new Map(
    (accounts as { id: string; type: AccountType }[]).map(a => [a.id, a.type])
  )

  for (const row of rows) {
    const type = accountTypeMap.get(row.account_id)
    if (!type) continue

    // RPCはDEBIT超過が正の生残高。正常残高方向が正になるよう符号を調整する
    const balance = normalizeOpeningBalance(Number(row.balance), type)
    if (balance !== 0) result.set(row.account_id, balance)
  }

  return result
}
