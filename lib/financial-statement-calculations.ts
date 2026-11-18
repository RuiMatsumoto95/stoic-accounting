import { normalizeOpeningBalance } from './account-balance'

export type PLCategory =
  | 'REVENUE'
  | 'COGS'
  | 'SGA'
  | 'NON_OP_INCOME'
  | 'NON_OP_EXPENSE'
  | 'EXTRA_INCOME'
  | 'EXTRA_LOSS'
  | 'TAX'

export type BSCategory =
  | 'CURRENT_ASSETS'
  | 'FIXED_ASSETS'
  | 'DEFERRED_ASSETS'
  | 'CURRENT_LIABILITIES'
  | 'FIXED_LIABILITIES'
  | 'EQUITY'

export interface AccountWithCategory {
  id: string
  code: string
  name: string
  type: string
  pl_category: PLCategory | null
  bs_category: BSCategory | null
  parent_id: string | null
}

export interface PLLineItem {
  account_id: string
  account_code: string
  account_name: string
  amount: number
  prev_amount: number | null
  change_amount: number | null
  change_rate: number | null
}

export interface PLSection {
  category: PLCategory
  label: string
  items: PLLineItem[]
  subtotal: number
  prev_subtotal: number | null
}

export interface PLResult {
  sections: PLSection[]
  revenueTotal: number
  cogsTotal: number
  grossProfit: number
  sgaTotal: number
  operatingIncome: number
  nonOpIncomeTotal: number
  nonOpExpenseTotal: number
  ordinaryIncome: number
  extraIncomeTotal: number
  extraLossTotal: number
  incomeBeforeTax: number
  taxTotal: number
  netIncome: number
  prev: {
    revenueTotal: number
    cogsTotal: number
    grossProfit: number
    sgaTotal: number
    operatingIncome: number
    nonOpIncomeTotal: number
    nonOpExpenseTotal: number
    ordinaryIncome: number
    extraIncomeTotal: number
    extraLossTotal: number
    incomeBeforeTax: number
    taxTotal: number
    netIncome: number
  } | null
}

export interface BSLineItem {
  account_id: string
  account_code: string
  account_name: string
  amount: number
  prev_amount: number | null
  change_amount: number | null
  change_rate: number | null
}

export interface BSSection {
  category: BSCategory
  label: string
  items: BSLineItem[]
  subtotal: number
  prev_subtotal: number | null
}

export interface BSResult {
  sections: BSSection[]
  currentAssetsTotal: number
  fixedAssetsTotal: number
  deferredAssetsTotal: number
  totalAssets: number
  currentLiabilitiesTotal: number
  fixedLiabilitiesTotal: number
  totalLiabilities: number
  equityTotal: number
  totalLiabilitiesAndEquity: number
  netIncome: number
  prev: {
    currentAssetsTotal: number
    fixedAssetsTotal: number
    deferredAssetsTotal: number
    totalAssets: number
    currentLiabilitiesTotal: number
    fixedLiabilitiesTotal: number
    totalLiabilities: number
    equityTotal: number
    totalLiabilitiesAndEquity: number
    netIncome: number
  } | null
}

export const PL_CATEGORY_LABELS: Record<PLCategory, string> = {
  REVENUE:        '売上高',
  COGS:           '売上原価',
  SGA:            '販売費及び一般管理費',
  NON_OP_INCOME:  '営業外収益',
  NON_OP_EXPENSE: '営業外費用',
  EXTRA_INCOME:   '特別利益',
  EXTRA_LOSS:     '特別損失',
  TAX:            '法人税等',
}

export const BS_CATEGORY_LABELS: Record<BSCategory, string> = {
  CURRENT_ASSETS:      '流動資産',
  FIXED_ASSETS:        '固定資産',
  DEFERRED_ASSETS:     '繰延資産',
  CURRENT_LIABILITIES: '流動負債',
  FIXED_LIABILITIES:   '固定負債',
  EQUITY:              '純資産',
}


export type IndividualPLCategory = 'REVENUE' | 'COGS' | 'SGA' | 'RESERVE_REVERSAL' | 'RESERVE_PROVISION'
export type IndividualBSCategory = BSCategory | 'OWNER_DRAWINGS' | 'OWNER_CONTRIBUTIONS'
export type StatementAccount = Omit<AccountWithCategory, 'pl_category' | 'bs_category'> & {
  pl_category: PLCategory | IndividualPLCategory | null
  bs_category: IndividualBSCategory | null
}
export type Movement = { account_id: string; total_debit: number; total_credit: number }
export type OpeningBalance = { account_id: string; balance: number }
export type JournalMovementLine = { account_id: string; side: string; amount: number }
export type StatementSection<C extends string> = Omit<PLSection, 'category'> & { category: C }

export function aggregateMovementLines(lines: readonly JournalMovementLine[]): Movement[] {
  const totals = new Map<string, Movement>()
  for (const line of lines) {
    const row = totals.get(line.account_id) ?? { account_id: line.account_id, total_debit: 0, total_credit: 0 }
    if (line.side === 'DEBIT') row.total_debit += Number(line.amount)
    else if (line.side === 'CREDIT') row.total_credit += Number(line.amount)
    totals.set(line.account_id, row)
  }
  return [...totals.values()]
}

/** 会社で絞った科目だけを受け付け、補助科目を親へ合算する。未知の科目は集計しない。 */
export function rollUpAccounts(accounts: readonly StatementAccount[], movements: readonly Movement[], opening: readonly OpeningBalance[] = []) {
  const accountMap = new Map(accounts.map(account => [account.id, account]))
  const parentId = (id: string) => {
    const account = accountMap.get(id)
    if (!account) return null
    const parent = accountMap.get(account.parent_id ?? id)
    return parent?.parent_id === null ? parent.id : null
  }
  const movementMap = new Map<string, Movement>()
  for (const row of movements) {
    const id = parentId(row.account_id)
    if (!id) continue
    const total = movementMap.get(id) ?? { account_id: id, total_debit: 0, total_credit: 0 }
    total.total_debit += Number(row.total_debit)
    total.total_credit += Number(row.total_credit)
    movementMap.set(id, total)
  }
  const openingMap = new Map<string, number>()
  for (const row of opening) {
    const id = parentId(row.account_id)
    if (id) openingMap.set(id, (openingMap.get(id) ?? 0) + Number(row.balance))
  }
  return { movementMap, openingMap }
}

/** 法人・個人で共用する行集計。区分・正常残高は親科目を使う。 */
export function calculateSections<C extends string>(
  accounts: readonly StatementAccount[], movements: readonly Movement[], prevMovements: readonly Movement[] | null,
  categories: readonly C[], labels: Record<C, string>, kind: 'pl' | 'bs',
  opening: readonly OpeningBalance[] = [], prevOpening: readonly OpeningBalance[] = [],
): StatementSection<C>[] {
  const current = rollUpAccounts(accounts, movements, opening)
  const previous = rollUpAccounts(accounts, prevMovements ?? [], prevOpening)
  const amountFor = (account: StatementAccount, category: string, values: typeof current) => {
    const movement = values.movementMap.get(account.id)
    const debit = movement?.total_debit ?? 0
    const credit = movement?.total_credit ?? 0
    if (kind === 'pl') {
      return ['REVENUE', 'NON_OP_INCOME', 'EXTRA_INCOME', 'RESERVE_REVERSAL'].includes(category) ? credit - debit : debit - credit
    }
    const debitNormal = ['CURRENT_ASSETS', 'FIXED_ASSETS', 'DEFERRED_ASSETS', 'OWNER_DRAWINGS'].includes(category)
    const normalizedOpening = normalizeOpeningBalance(values.openingMap.get(account.id) ?? 0, debitNormal ? 'ASSET' : 'LIABILITY')
    return normalizedOpening + (debitNormal ? debit - credit : credit - debit)
  }
  return categories.map(category => {
    const items = accounts.filter(account => account.parent_id === null && account[kind === 'pl' ? 'pl_category' : 'bs_category'] === category)
      .map(account => {
        const amount = amountFor(account, category, current)
        const prev_amount = prevMovements !== null ? amountFor(account, category, previous) : null
        return {
          account_id: account.id, account_code: account.code, account_name: account.name, amount, prev_amount,
          change_amount: prev_amount !== null ? amount - prev_amount : null,
          change_rate: prev_amount !== null && prev_amount !== 0 ? (amount - prev_amount) / Math.abs(prev_amount) : null,
        }
      })
    return {
      category, label: labels[category], items,
      subtotal: items.reduce((sum, item) => sum + item.amount, 0),
      prev_subtotal: prevMovements !== null ? items.reduce((sum, item) => sum + (item.prev_amount ?? 0), 0) : null,
    }
  })
}

export function calculatePLData(accounts: readonly StatementAccount[], movements: readonly Movement[], prevMovements: readonly Movement[] | null): PLResult {
  const sections = calculateSections(accounts, movements, prevMovements,
    ['REVENUE', 'COGS', 'SGA', 'NON_OP_INCOME', 'NON_OP_EXPENSE', 'EXTRA_INCOME', 'EXTRA_LOSS', 'TAX'] as const,
    PL_CATEGORY_LABELS, 'pl')
  const get = (cat: PLCategory) => sections.find(s => s.category === cat)!

  const revenueTotal      = get('REVENUE').subtotal
  const cogsTotal         = get('COGS').subtotal
  const grossProfit       = revenueTotal - cogsTotal
  const sgaTotal          = get('SGA').subtotal
  const operatingIncome   = grossProfit - sgaTotal
  const nonOpIncomeTotal  = get('NON_OP_INCOME').subtotal
  const nonOpExpenseTotal = get('NON_OP_EXPENSE').subtotal
  const ordinaryIncome    = operatingIncome + nonOpIncomeTotal - nonOpExpenseTotal
  const extraIncomeTotal  = get('EXTRA_INCOME').subtotal
  const extraLossTotal    = get('EXTRA_LOSS').subtotal
  const incomeBeforeTax   = ordinaryIncome + extraIncomeTotal - extraLossTotal
  const taxTotal          = get('TAX').subtotal
  const netIncome         = incomeBeforeTax - taxTotal

  const prev = prevMovements !== null ? (() => {
    const r   = get('REVENUE').prev_subtotal ?? 0
    const c   = get('COGS').prev_subtotal ?? 0
    const gp  = r - c
    const sg  = get('SGA').prev_subtotal ?? 0
    const oi  = gp - sg
    const ni  = get('NON_OP_INCOME').prev_subtotal ?? 0
    const ne  = get('NON_OP_EXPENSE').prev_subtotal ?? 0
    const or_ = oi + ni - ne
    const ei  = get('EXTRA_INCOME').prev_subtotal ?? 0
    const el  = get('EXTRA_LOSS').prev_subtotal ?? 0
    const ibt = or_ + ei - el
    const tx  = get('TAX').prev_subtotal ?? 0
    const net = ibt - tx
    return {
      revenueTotal: r, cogsTotal: c, grossProfit: gp,
      sgaTotal: sg, operatingIncome: oi,
      nonOpIncomeTotal: ni, nonOpExpenseTotal: ne, ordinaryIncome: or_,
      extraIncomeTotal: ei, extraLossTotal: el, incomeBeforeTax: ibt,
      taxTotal: tx, netIncome: net,
    }
  })() : null

  return {
    sections,
    revenueTotal, cogsTotal, grossProfit,
    sgaTotal, operatingIncome,
    nonOpIncomeTotal, nonOpExpenseTotal, ordinaryIncome,
    extraIncomeTotal, extraLossTotal, incomeBeforeTax,
    taxTotal, netIncome,
    prev,
  }
}

export function calculateBSData(
  accounts: readonly StatementAccount[], openingBalances: readonly OpeningBalance[], movements: readonly Movement[],
  prevOpeningBalances: readonly OpeningBalance[] | null, prevMovements: readonly Movement[] | null,
  netIncome: number, prevNetIncome: number | null,
): BSResult {
  // DBのget_opening_balances_for_periodが、損益・事業主貸借を繰越先へ畳み込んで返す（ステップ2）。ここではBS区分だけを集計する。
  const sections = calculateSections(accounts, movements, prevMovements,
    ['CURRENT_ASSETS', 'FIXED_ASSETS', 'DEFERRED_ASSETS', 'CURRENT_LIABILITIES', 'FIXED_LIABILITIES', 'EQUITY'] as const,
    BS_CATEGORY_LABELS, 'bs', openingBalances, prevOpeningBalances ?? [])
  const get = (cat: BSCategory) => sections.find(s => s.category === cat)!

  const currentAssetsTotal      = get('CURRENT_ASSETS').subtotal
  const fixedAssetsTotal        = get('FIXED_ASSETS').subtotal
  const deferredAssetsTotal     = get('DEFERRED_ASSETS').subtotal
  const totalAssets             = currentAssetsTotal + fixedAssetsTotal + deferredAssetsTotal
  const currentLiabilitiesTotal = get('CURRENT_LIABILITIES').subtotal
  const fixedLiabilitiesTotal   = get('FIXED_LIABILITIES').subtotal
  const totalLiabilities        = currentLiabilitiesTotal + fixedLiabilitiesTotal
  const equityTotal             = get('EQUITY').subtotal + netIncome
  const totalLiabilitiesAndEquity = totalLiabilities + equityTotal

  const prevCA  = get('CURRENT_ASSETS').prev_subtotal ?? 0
  const prevFA  = get('FIXED_ASSETS').prev_subtotal ?? 0
  const prevDA  = get('DEFERRED_ASSETS').prev_subtotal ?? 0
  const prevTA  = prevCA + prevFA + prevDA
  const prevCL  = get('CURRENT_LIABILITIES').prev_subtotal ?? 0
  const prevFL  = get('FIXED_LIABILITIES').prev_subtotal ?? 0
  const prevTL  = prevCL + prevFL
  const prevEQ  = (get('EQUITY').prev_subtotal ?? 0) + (prevNetIncome ?? 0)
  const prevTLE = prevTL + prevEQ

  return {
    sections,
    currentAssetsTotal,
    fixedAssetsTotal,
    deferredAssetsTotal,
    totalAssets,
    currentLiabilitiesTotal,
    fixedLiabilitiesTotal,
    totalLiabilities,
    equityTotal,
    totalLiabilitiesAndEquity,
    netIncome,
    prev: prevMovements !== null ? {
      currentAssetsTotal: prevCA,
      fixedAssetsTotal:   prevFA,
      deferredAssetsTotal: prevDA,
      totalAssets:        prevTA,
      currentLiabilitiesTotal: prevCL,
      fixedLiabilitiesTotal:   prevFL,
      totalLiabilities:   prevTL,
      equityTotal:        prevEQ,
      totalLiabilitiesAndEquity: prevTLE,
      netIncome:          prevNetIncome ?? 0,
    } : null,
  }
}
