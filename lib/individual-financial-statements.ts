import {
  calculateSections, type StatementSection, type StatementAccount, type Movement, type OpeningBalance,
  type IndividualPLCategory, type IndividualBSCategory,
} from './financial-statement-calculations'

export const INDIVIDUAL_PL_LABELS: Record<IndividualPLCategory, string> = {
  REVENUE: '収入金額', COGS: '売上原価', SGA: '経費',
  RESERVE_REVERSAL: '繰戻額等', RESERVE_PROVISION: '繰入額等',
}
export const INDIVIDUAL_BS_LABELS: Record<IndividualBSCategory, string> = {
  CURRENT_ASSETS: '流動資産', FIXED_ASSETS: '固定資産', DEFERRED_ASSETS: '繰延資産', OWNER_DRAWINGS: '事業主貸',
  CURRENT_LIABILITIES: '流動負債', FIXED_LIABILITIES: '固定負債', OWNER_CONTRIBUTIONS: '事業主借', EQUITY: '元入金',
}
interface IndividualPLTotals {
  revenueTotal: number
  cogsTotal: number
  grossProfit: number
  expensesTotal: number
  balanceAmount: number
  reserveReversalTotal: number
  reserveProvisionTotal: number
  incomeBeforeDeduction: number
}
export interface IndividualPLResult extends IndividualPLTotals {
  kind: 'INDIVIDUAL'
  sections: StatementSection<IndividualPLCategory>[]
  prev: IndividualPLTotals | null
}
interface IndividualBSTotals {
  totalAssets: number
  totalLiabilities: number
  capitalTotal: number
  totalLiabilitiesAndEquity: number
  incomeBeforeDeduction: number
}
export interface IndividualBSResult extends IndividualBSTotals {
  kind: 'INDIVIDUAL'
  sections: StatementSection<IndividualBSCategory>[]
  prev: IndividualBSTotals | null
}

export function calculateIndividualPLData(
  accounts: readonly StatementAccount[], movements: readonly Movement[], prevMovements: readonly Movement[] | null,
): IndividualPLResult {
  const sections = calculateSections(accounts, movements, prevMovements,
    ['REVENUE', 'COGS', 'SGA', 'RESERVE_REVERSAL', 'RESERVE_PROVISION'] as const, INDIVIDUAL_PL_LABELS, 'pl')
  const totals = (previous: boolean): IndividualPLTotals => {
    const get = (category: IndividualPLCategory) => {
      const section = sections.find(section => section.category === category)!
      return (previous ? section.prev_subtotal : section.subtotal) ?? 0
    }
    const revenueTotal = get('REVENUE'), cogsTotal = get('COGS'), expensesTotal = get('SGA')
    const grossProfit = revenueTotal - cogsTotal
    const balanceAmount = grossProfit - expensesTotal
    const reserveReversalTotal = get('RESERVE_REVERSAL'), reserveProvisionTotal = get('RESERVE_PROVISION')
    return { revenueTotal, cogsTotal, grossProfit, expensesTotal, balanceAmount, reserveReversalTotal, reserveProvisionTotal,
      incomeBeforeDeduction: balanceAmount + reserveReversalTotal - reserveProvisionTotal }
  }
  return { kind: 'INDIVIDUAL', sections, ...totals(false), prev: prevMovements !== null ? totals(true) : null }
}

export function calculateIndividualBSData(
  accounts: readonly StatementAccount[], opening: readonly OpeningBalance[], movements: readonly Movement[],
  prevOpening: readonly OpeningBalance[] | null, prevMovements: readonly Movement[] | null,
  incomeBeforeDeduction: number, prevIncomeBeforeDeduction: number | null,
): IndividualBSResult {
  // DBのget_opening_balances_for_periodが、損益・事業主貸借を繰越先へ畳み込んで返す（ステップ2）。ここではBS区分だけを集計する。
  const sections = calculateSections(accounts, movements, prevMovements,
    ['CURRENT_ASSETS', 'FIXED_ASSETS', 'DEFERRED_ASSETS', 'OWNER_DRAWINGS', 'CURRENT_LIABILITIES', 'FIXED_LIABILITIES', 'OWNER_CONTRIBUTIONS', 'EQUITY'] as const,
    INDIVIDUAL_BS_LABELS, 'bs', opening, prevOpening ?? [])
  const totals = (previous: boolean): IndividualBSTotals => {
    const get = (category: IndividualBSCategory) => {
      const section = sections.find(section => section.category === category)!
      return (previous ? section.prev_subtotal : section.subtotal) ?? 0
    }
    const totalAssets = get('CURRENT_ASSETS') + get('FIXED_ASSETS') + get('DEFERRED_ASSETS') + get('OWNER_DRAWINGS')
    const totalLiabilities = get('CURRENT_LIABILITIES') + get('FIXED_LIABILITIES') + get('OWNER_CONTRIBUTIONS')
    const income = previous ? prevIncomeBeforeDeduction ?? 0 : incomeBeforeDeduction
    const capitalTotal = get('EQUITY') + income
    return { totalAssets, totalLiabilities, capitalTotal, totalLiabilitiesAndEquity: totalLiabilities + capitalTotal, incomeBeforeDeduction: income }
  }
  return { kind: 'INDIVIDUAL', sections, ...totals(false), prev: prevMovements !== null ? totals(true) : null }
}
