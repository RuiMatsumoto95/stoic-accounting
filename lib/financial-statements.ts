import { supabase } from './supabase'
import { translateSupabaseError } from './supabase-error-handler'
import { chunkItems, readAllPages } from './report-pagination'
import { validateComparisonPeriod } from './reports/scope'
import {
  aggregateMovementLines, calculatePLData, calculateBSData,
  type StatementAccount, type JournalMovementLine, type OpeningBalance,
} from './financial-statement-calculations'
import { calculateIndividualPLData, calculateIndividualBSData } from './individual-financial-statements'
export * from './financial-statement-calculations'
export * from './individual-financial-statements'

async function fetchAccounts(companyId: string): Promise<StatementAccount[]> {
  return readAllPages<StatementAccount>((from, to) => supabase.from('accounts')
    .select('id, code, name, type, pl_category, bs_category, parent_id')
    .eq('company_id', companyId).order('code').order('id').range(from, to))
}

// ID自体もページ分割する。明細の塊ごとに安定した順序で全ページを読み切る。
export async function fetchPLMovements(periodId: string) {
  const entries = await readAllPages<{ id: string }>((from, to) => supabase.from('journal_entries')
    .select('id').eq('period_id', periodId).order('id').range(from, to))
  const lines: JournalMovementLine[] = []
  for (const ids of chunkItems(entries.map(entry => entry.id), 100)) {
    const pageLines = await readAllPages<JournalMovementLine>((from, to) => supabase.from('journal_lines')
      .select('account_id, side, amount').in('entry_id', ids).order('id').range(from, to))
    for (const line of pageLines) lines.push(line)
  }
  return aggregateMovementLines(lines)
}

async function fetchOpeningBalances(periodId: string): Promise<OpeningBalance[]> {
  const { data, error } = await supabase.rpc('get_opening_balances_for_period', { target_period_id: periodId })
  if (error) throw translateSupabaseError(error)
  return data ?? []
}

async function fetchPLInputs(periodId: string, prevPeriodId: string | null) {
  const companyId = await validateComparisonPeriod(periodId, prevPeriodId)
  const [accounts, movements, prevMovements] = await Promise.all([
    fetchAccounts(companyId), fetchPLMovements(periodId),
    prevPeriodId ? fetchPLMovements(prevPeriodId) : Promise.resolve(null),
  ])
  return { accounts, movements, prevMovements }
}

async function fetchBSInputs(periodId: string, prevPeriodId: string | null) {
  const inputs = await fetchPLInputs(periodId, prevPeriodId)
  const [opening, prevOpening] = await Promise.all([
    fetchOpeningBalances(periodId), prevPeriodId ? fetchOpeningBalances(prevPeriodId) : Promise.resolve(null),
  ])
  return { ...inputs, opening, prevOpening }
}

export async function getPLData(periodId: string, prevPeriodId: string | null) {
  const { accounts, movements, prevMovements } = await fetchPLInputs(periodId, prevPeriodId)
  return calculatePLData(accounts, movements, prevMovements)
}

export async function getBSData(periodId: string, prevPeriodId: string | null, netIncome: number, prevNetIncome: number | null) {
  const { accounts, movements, prevMovements, opening, prevOpening } = await fetchBSInputs(periodId, prevPeriodId)
  return calculateBSData(accounts, opening, movements, prevOpening, prevMovements, netIncome, prevNetIncome)
}

export async function getIndividualPLData(periodId: string, prevPeriodId: string | null) {
  const { accounts, movements, prevMovements } = await fetchPLInputs(periodId, prevPeriodId)
  return calculateIndividualPLData(accounts, movements, prevMovements)
}

export async function getIndividualBSData(periodId: string, prevPeriodId: string | null, incomeBeforeDeduction: number, prevIncomeBeforeDeduction: number | null) {
  const { accounts, movements, prevMovements, opening, prevOpening } = await fetchBSInputs(periodId, prevPeriodId)
  return calculateIndividualBSData(accounts, opening, movements, prevOpening, prevMovements, incomeBeforeDeduction, prevIncomeBeforeDeduction)
}
