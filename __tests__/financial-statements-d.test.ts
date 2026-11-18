import { describe, expect, it } from 'vitest'
import { normalizeOpeningBalance } from '@/lib/account-balance'
import { aggregateMovementLines, calculatePLData, calculateBSData, type StatementAccount, type Movement, type OpeningBalance, type JournalMovementLine } from '@/lib/financial-statement-calculations'
import { calculateIndividualPLData, calculateIndividualBSData } from '@/lib/individual-financial-statements'
import { buildIndividualPLRows, buildIndividualBSRows } from '@/lib/individual-statement-rows'

function account(id: string, type: string, pl: StatementAccount['pl_category'], bs: StatementAccount['bs_category'], parent: string | null = null): StatementAccount {
  return { id, code: id, name: id, type, pl_category: pl, bs_category: bs, parent_id: parent }
}
function movement(account_id: string, debit: number, credit = 0): Movement {
  return { account_id, total_debit: debit, total_credit: credit }
}
const accounts: StatementAccount[] = [
  account('bank', 'ASSET', null, 'CURRENT_ASSETS'), account('A銀行', 'ASSET', null, null, 'bank'),
  account('sales', 'REVENUE', 'REVENUE', null), account('sales-sub', 'REVENUE', null, null, 'sales'),
  account('cogs', 'EXPENSE', 'COGS', null), account('expenses', 'EXPENSE', 'SGA', null),
  account('reversal', 'REVENUE', 'RESERVE_REVERSAL', null), account('810', 'EXPENSE', 'RESERVE_PROVISION', null),
  account('provision', 'EXPENSE', 'RESERVE_PROVISION', null),
  account('drawings', 'ASSET', null, 'OWNER_DRAWINGS'), account('draw-sub', 'ASSET', null, null, 'drawings'),
  account('loan', 'LIABILITY', null, 'FIXED_LIABILITIES'), account('loan-sub', 'LIABILITY', null, null, 'loan'),
  account('contributions', 'LIABILITY', null, 'OWNER_CONTRIBUTIONS'), account('contrib-sub', 'LIABILITY', null, null, 'contributions'),
  account('capital', 'EQUITY', null, 'EQUITY'), account('capital-sub', 'EQUITY', null, null, 'capital'),
  account('uncategorized', 'ASSET', null, null),
]
function individualMovements() {
  const lines: JournalMovementLine[] = []
  function tx(debit: string, credit: string, amount: number) {
    lines.push({ account_id: debit, side: 'DEBIT', amount }, { account_id: credit, side: 'CREDIT', amount })
  }
  tx('A銀行', 'capital-sub', 1000)
  tx('A銀行', 'loan-sub', 500)
  tx('A銀行', 'sales-sub', 2000)
  tx('cogs', 'A銀行', 300)
  tx('expenses', 'A銀行', 200)
  tx('loan-sub', 'reversal', 100)
  tx('810', 'A銀行', 150)
  tx('provision', 'loan-sub', 50)
  tx('draw-sub', 'A銀行', 120)
  tx('A銀行', 'contrib-sub', 80)
  return aggregateMovementLines(lines)
}
const movements = individualMovements()
const section = (result: { sections: { category: string; subtotal: number; prev_subtotal: number | null; items: { account_id: string; amount: number; prev_amount: number | null }[] }[] }, category: string) => result.sections.find(section => section.category === category)!

describe('D: 共通集計と個人PL/BS（純粋計算）', () => {
  it.each(['CORPORATION', 'INDIVIDUAL'])('%s の補助明細を親の売上・預金へ合算し、親区分を使う', kind => {
    const rows = [movement('bank', 10), movement('A銀行', 200), movement('sales-sub', 0, 200)]
    const pl = kind === 'INDIVIDUAL' ? calculateIndividualPLData(accounts, rows, null) : calculatePLData(accounts, rows, null)
    const bs = kind === 'INDIVIDUAL' ? calculateIndividualBSData(accounts, [], rows, null, null, 200, null) : calculateBSData(accounts, [], rows, null, null, 200, null)
    expect(pl.revenueTotal).toBe(200)
    expect(section(pl, 'REVENUE').items).toEqual([{ account_id: 'sales', account_code: 'sales', account_name: 'sales', amount: 200, prev_amount: null, change_amount: null, change_rate: null }])
    expect(section(bs, 'CURRENT_ASSETS').subtotal).toBe(210)
    expect(bs.sections.flatMap(s => s.items).some(item => item.account_id === 'A銀行')).toBe(false)
  })

  it.each(['CORPORATION', 'INDIVIDUAL'])('%s の貸方期首・補助期首を正規化し、前期比較も正の貸方残高にする', kind => {
    const opening: OpeningBalance[] = [{ account_id: 'bank', balance: 50 }, { account_id: 'A銀行', balance: 950 }, { account_id: 'loan', balance: -100 }, { account_id: 'loan-sub', balance: -200 }, { account_id: 'capital-sub', balance: -700 }]
    const prevOpening: OpeningBalance[] = [{ account_id: 'A銀行', balance: 400 }, { account_id: 'loan-sub', balance: -100 }, { account_id: 'capital-sub', balance: -300 }]
    const bs = kind === 'INDIVIDUAL' ? calculateIndividualBSData(accounts, opening, [], prevOpening, [], 0, 0) : calculateBSData(accounts, opening, [], prevOpening, [], 0, 0)
    expect(section(bs, 'CURRENT_ASSETS')).toMatchObject({ subtotal: 1000, prev_subtotal: 400 })
    expect(section(bs, 'FIXED_LIABILITIES')).toMatchObject({ subtotal: 300, prev_subtotal: 100 })
    expect(section(bs, 'EQUITY')).toMatchObject({ subtotal: 700, prev_subtotal: 300 })
    expect(bs.totalAssets).toBe(bs.totalLiabilitiesAndEquity)
    expect(bs.prev!.totalAssets).toBe(bs.prev!.totalLiabilitiesAndEquity)
  })

  it('正常残高変換は借方負・貸方負の逆残高も維持する', () => {
    expect(normalizeOpeningBalance(-12, 'ASSET')).toBe(-12)
    expect(normalizeOpeningBalance(-12, 'LIABILITY')).toBe(12)
    expect(normalizeOpeningBalance(12, 'EQUITY')).toBe(-12)
    expect(normalizeOpeningBalance(12, 'EXPENSE')).toBe(12)
  })

  it('個人の全式・専従者給与810・OWNER_*・RESERVE_*を含め、初年度の貸借が一致する', () => {
    const pl = calculateIndividualPLData(accounts, movements, movements)
    expect(pl).toMatchObject({ revenueTotal: 2000, cogsTotal: 300, grossProfit: 1700, expensesTotal: 200, balanceAmount: 1500, reserveReversalTotal: 100, reserveProvisionTotal: 200, incomeBeforeDeduction: 1400 })
    expect(pl.prev).toMatchObject({ grossProfit: 1700, balanceAmount: 1500, incomeBeforeDeduction: 1400 })
    expect(section(pl, 'RESERVE_PROVISION').items.find(item => item.account_id === '810')?.amount).toBe(150)
    const bs = calculateIndividualBSData(accounts, [], movements, [], movements, pl.incomeBeforeDeduction, pl.prev!.incomeBeforeDeduction)
    expect(bs).toMatchObject({ totalAssets: 2930, totalLiabilities: 530, capitalTotal: 2400, totalLiabilitiesAndEquity: 2930 })
    expect(section(bs, 'OWNER_DRAWINGS').subtotal).toBe(120)
    expect(section(bs, 'OWNER_CONTRIBUTIONS').subtotal).toBe(80)
    expect(bs.prev!.totalAssets).toBe(bs.prev!.totalLiabilitiesAndEquity)
  })

  it('旧RPC形式でPL行が期首に残る場合の不一致を示す（ステップ2ではDBが繰越先に畳み込む）', () => {
    const opening: OpeningBalance[] = [{ account_id: 'A銀行', balance: 1600 }, { account_id: 'capital-sub', balance: -1000 }, { account_id: 'sales-sub', balance: -900 }, { account_id: 'expenses', balance: 300 }]
    const pl = calculateIndividualPLData(accounts, movements, [])
    const bs = calculateIndividualBSData(accounts, opening, movements, opening, [], pl.incomeBeforeDeduction, 0)
    const cumulativePreviousIncome = 900 - 300
    expect(bs.totalAssets - bs.totalLiabilitiesAndEquity).toBe(cumulativePreviousIncome)
    expect(bs.prev!.totalAssets - bs.prev!.totalLiabilitiesAndEquity).toBe(cumulativePreviousIncome)
  })

  it('法人の8区分と従来の数値を維持する（補助・貸方期首なし）', () => {
    const cats = ['REVENUE', 'COGS', 'SGA', 'NON_OP_INCOME', 'NON_OP_EXPENSE', 'EXTRA_INCOME', 'EXTRA_LOSS', 'TAX'] as const
    const a = cats.map(cat => account(cat, ['REVENUE', 'NON_OP_INCOME', 'EXTRA_INCOME'].includes(cat) ? 'REVENUE' : 'EXPENSE', cat, null))
    a.push(account('cash', 'ASSET', null, 'CURRENT_ASSETS'), account('debt', 'LIABILITY', null, 'CURRENT_LIABILITIES'), account('equity', 'EQUITY', null, 'EQUITY'))
    const rows = [movement('REVENUE', 0, 1000), movement('COGS', 200), movement('SGA', 100), movement('NON_OP_INCOME', 0, 40), movement('NON_OP_EXPENSE', 10), movement('EXTRA_INCOME', 0, 20), movement('EXTRA_LOSS', 5), movement('TAX', 50), movement('cash', 1895), movement('debt', 0, 200), movement('equity', 0, 1000)]
    const pl = calculatePLData(a, rows, rows)
    expect(pl.sections.map(s => [s.category, s.label, s.subtotal, s.prev_subtotal])).toEqual([
      ['REVENUE', '売上高', 1000, 1000], ['COGS', '売上原価', 200, 200], ['SGA', '販売費及び一般管理費', 100, 100],
      ['NON_OP_INCOME', '営業外収益', 40, 40], ['NON_OP_EXPENSE', '営業外費用', 10, 10], ['EXTRA_INCOME', '特別利益', 20, 20], ['EXTRA_LOSS', '特別損失', 5, 5], ['TAX', '法人税等', 50, 50],
    ])
    const expected = { revenueTotal: 1000, cogsTotal: 200, grossProfit: 800, sgaTotal: 100, operatingIncome: 700, nonOpIncomeTotal: 40, nonOpExpenseTotal: 10, ordinaryIncome: 730, extraIncomeTotal: 20, extraLossTotal: 5, incomeBeforeTax: 745, taxTotal: 50, netIncome: 695 }
    expect(pl).toMatchObject(expected)
    expect(pl.prev).toEqual(expected)
    const bs = calculateBSData(a, [], rows, [], rows, pl.netIncome, pl.prev!.netIncome)
    const expectedBS = { currentAssetsTotal: 1895, fixedAssetsTotal: 0, deferredAssetsTotal: 0, totalAssets: 1895, currentLiabilitiesTotal: 200, fixedLiabilitiesTotal: 0, totalLiabilities: 200, equityTotal: 1695, totalLiabilitiesAndEquity: 1895, netIncome: 695 }
    expect(bs).toMatchObject(expectedBS)
    expect(bs.prev).toEqual(expectedBS)
    expect(bs.sections.map(s => s.label)).toEqual(['流動資産', '固定資産', '繰延資産', '流動負債', '固定負債', '純資産'])
  })

  it('所属不明の科目と区分なしの親は、明細・期首とも対象外にする', () => {
    const rows = [...movements, movement('other-company', 9999), movement('uncategorized', 9999)]
    const pl = calculateIndividualPLData(accounts, rows, null)
    const bs = calculateIndividualBSData(accounts, [{ account_id: 'other-company', balance: 9999 }, { account_id: 'uncategorized', balance: 9999 }], rows, null, null, pl.incomeBeforeDeduction, null)
    expect(bs.totalAssets).toBe(2930)
  })
})

describe('D: 個人表示の共通行組み立て', () => {
  const pl = calculateIndividualPLData(accounts, movements, [])
  const bs = calculateIndividualBSData(accounts, [], movements, [], [], pl.incomeBeforeDeduction, 0)
  const options = { showPrev: true, hideZero: false }
  it('PLの見出し・小計・損益の順序を画面/PDFで共有する', () => {
    const rows = buildIndividualPLRows(pl, options)
    expect(rows.filter(row => row.kind !== 'item').map(row => row.label)).toEqual([
      '収入金額', '収入金額合計', '売上原価', '売上原価合計', '売上総損益', '経費', '経費合計', '差引金額', '繰戻額等', '繰戻額等合計', '繰入額等', '繰入額等合計', '控除前所得金額',
    ])
    expect(rows.at(-1)).toMatchObject({ amount: 1400, prevAmount: 0 })
    expect(rows.find(row => row.key === '810')).toMatchObject({ kind: 'item', amount: 150 })
  })
  it('BSの事業主区分・元入金・控除前所得・各合計を順に並べる', () => {
    const rows = buildIndividualBSRows(bs, options)
    expect(rows.filter(row => row.kind !== 'item').map(row => row.label)).toEqual([
      '資産の部', '流動資産', '流動資産合計', '固定資産', '固定資産合計', '繰延資産', '繰延資産合計', '事業主貸', '事業主貸合計', '資産合計',
      '負債の部', '流動負債', '流動負債合計', '固定負債', '固定負債合計', '事業主借', '事業主借合計', '負債合計', '資本の部', '元入金', '元入金合計', '資本合計', '負債・資本合計',
    ])
    expect(rows.slice(-3).map(row => [row.label, row.amount])).toEqual([['控除前所得金額', 1400], ['資本合計', 2400], ['負債・資本合計', 2930]])
  })
  it('ゼロ非表示でも前期だけにある科目を前期比較時に残し、小計は変えない', () => {
    const previousOnly = calculateIndividualPLData(accounts, [], movements)
    const compared = buildIndividualPLRows(previousOnly, { showPrev: true, hideZero: true })
    const currentOnly = buildIndividualPLRows(previousOnly, { showPrev: false, hideZero: true })
    expect(compared.find(row => row.key === 'sales')).toMatchObject({ amount: 0, prevAmount: 2000 })
    expect(currentOnly.find(row => row.key === 'sales')).toBeUndefined()
    expect(compared.at(-1)).toMatchObject({ amount: 0, prevAmount: 1400 })
    expect(new Set(compared.map(row => row.key)).size).toBe(compared.length)
  })
})
