import { describe, expect, it } from 'vitest'
import { calculateBSData, calculatePLData, aggregateMovementLines, type StatementAccount, type OpeningBalance } from '@/lib/financial-statement-calculations'
import { calculateIndividualBSData, calculateIndividualPLData } from '@/lib/individual-financial-statements'

const account = (id: string, type: string, bs: StatementAccount['bs_category'], pl: StatementAccount['pl_category'] = null): StatementAccount => ({ id, code: id, name: id, type, bs_category: bs, pl_category: pl, parent_id: null })
const accounts = [account('bank', 'ASSET', 'CURRENT_ASSETS'), account('debt', 'LIABILITY', 'CURRENT_LIABILITIES'),
  account('capital', 'EQUITY', 'EQUITY'), account('retained', 'EQUITY', 'EQUITY'),
  account('drawings', 'ASSET', 'OWNER_DRAWINGS'), account('contributions', 'LIABILITY', 'OWNER_CONTRIBUTIONS'),
  account('sales', 'REVENUE', null, 'REVENUE'), account('expense', 'EXPENSE', null, 'SGA')]

describe('新RPC形式の2期目BS', () => {
  it('法人：前期損益600が繰越利益に畳み込まれ、当期利益だけを加算して貸借一致する', () => {
    // 前期：資本金1000、借入200、売上900、費用300。RPCはPL行を返さない。
    const opening: OpeningBalance[] = [{ account_id: 'bank', balance: 1800 }, { account_id: 'debt', balance: -200 }, { account_id: 'capital', balance: -1000 }, { account_id: 'retained', balance: -600 }]
    const movements = aggregateMovementLines([
      { account_id: 'bank', side: 'DEBIT', amount: 400 }, { account_id: 'sales', side: 'CREDIT', amount: 400 },
      { account_id: 'expense', side: 'DEBIT', amount: 100 }, { account_id: 'bank', side: 'CREDIT', amount: 100 },
    ])
    const pl = calculatePLData(accounts, movements, null)
    const bs = calculateBSData(accounts, opening, movements, null, null, pl.netIncome, null)
    expect(pl.netIncome).toBe(300)
    expect(bs).toMatchObject({ totalAssets: 2100, totalLiabilities: 200, equityTotal: 1900, totalLiabilitiesAndEquity: 2100, netIncome: 300 })
    expect(bs.totalAssets).toBe(bs.totalLiabilitiesAndEquity)
    expect(bs.sections.flatMap(section => section.items).find(item => item.account_id === 'retained')?.amount).toBe(600)
  })
  it('個人：前期損益600・事業主貸120・事業主借80を元入金1560に畳み込み、貸借一致する', () => {
    // 元入金1000 + 前期所得600 - 事業主貸120 + 事業主借80 = 1560。
    // RPCは損益・事業主貸借の行を含めず、預金1760・借入200・元入金1560だけを返す。
    const opening: OpeningBalance[] = [{ account_id: 'bank', balance: 1760 }, { account_id: 'debt', balance: -200 }, { account_id: 'capital', balance: -1560 }]
    const movements = aggregateMovementLines([
      { account_id: 'bank', side: 'DEBIT', amount: 400 }, { account_id: 'sales', side: 'CREDIT', amount: 400 },
      { account_id: 'expense', side: 'DEBIT', amount: 100 }, { account_id: 'bank', side: 'CREDIT', amount: 100 },
      { account_id: 'drawings', side: 'DEBIT', amount: 50 }, { account_id: 'bank', side: 'CREDIT', amount: 50 },
      { account_id: 'bank', side: 'DEBIT', amount: 20 }, { account_id: 'contributions', side: 'CREDIT', amount: 20 },
    ])
    const pl = calculateIndividualPLData(accounts, movements, null)
    const bs = calculateIndividualBSData(accounts, opening, movements, null, null, pl.incomeBeforeDeduction, null)
    expect(pl.incomeBeforeDeduction).toBe(300)
    expect(bs).toMatchObject({ totalAssets: 2080, totalLiabilities: 220, capitalTotal: 1860, totalLiabilitiesAndEquity: 2080 })
    expect(bs.totalAssets).toBe(bs.totalLiabilitiesAndEquity)
    expect(bs.sections.find(section => section.category === 'OWNER_DRAWINGS')?.subtotal).toBe(50)
    expect(bs.sections.find(section => section.category === 'OWNER_CONTRIBUTIONS')?.subtotal).toBe(20)
    expect(bs.sections.find(section => section.category === 'EQUITY')?.subtotal).toBe(1560)
  })
})
