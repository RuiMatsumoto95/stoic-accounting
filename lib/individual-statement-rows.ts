import type { PLLineItem, StatementSection } from './financial-statement-calculations'
import type { IndividualPLResult, IndividualBSResult } from './individual-financial-statements'

export type StatementRow = {
  key: string
  label: string
  kind: 'header' | 'item' | 'subtotal' | 'total'
  amount: number
  prevAmount: number | null
}
type Options = { showPrev: boolean; hideZero: boolean }

function sectionRows(section: StatementSection<string>, options: Options): StatementRow[] {
  const { category, label, items, subtotal, prev_subtotal } = section
  return [
    { key: `${category}-header`, label, kind: 'header', amount: 0, prevAmount: null },
    ...items.filter(item => !options.hideZero || item.amount !== 0 || (options.showPrev && (item.prev_amount ?? 0) !== 0))
      .map((item: PLLineItem): StatementRow => ({ key: item.account_id, label: item.account_name, kind: 'item', amount: item.amount, prevAmount: item.prev_amount })),
    { key: `${category}-subtotal`, label: `${label}合計`, kind: 'subtotal', amount: subtotal, prevAmount: prev_subtotal },
  ]
}
function total(key: string, label: string, amount: number, prevAmount: number | null): StatementRow {
  return { key, label, kind: 'total', amount, prevAmount }
}

/** 画面とPDFで共用する個人用PLの表示順序・見出し・小計。 */
export function buildIndividualPLRows(data: IndividualPLResult, options: Options): StatementRow[] {
  const section = (category: string) => sectionRows(data.sections.find(section => section.category === category)!, options)
  return [
    ...section('REVENUE'), ...section('COGS'),
    total('gross', '売上総損益', data.grossProfit, data.prev?.grossProfit ?? null),
    ...section('SGA'),
    total('balance', '差引金額', data.balanceAmount, data.prev?.balanceAmount ?? null),
    ...section('RESERVE_REVERSAL'), ...section('RESERVE_PROVISION'),
    total('income', '控除前所得金額', data.incomeBeforeDeduction, data.prev?.incomeBeforeDeduction ?? null),
  ]
}

/** 前期以前の累積損益の元入金への振替はステップ2の対象。 */
export function buildIndividualBSRows(data: IndividualBSResult, options: Options): StatementRow[] {
  const section = (category: string) => sectionRows(data.sections.find(section => section.category === category)!, options)
  const header = (key: string, label: string): StatementRow => ({ key, label, kind: 'header', amount: 0, prevAmount: null })
  return [
    header('assets', '資産の部'),
    ...section('CURRENT_ASSETS'), ...section('FIXED_ASSETS'), ...section('DEFERRED_ASSETS'), ...section('OWNER_DRAWINGS'),
    total('total-assets', '資産合計', data.totalAssets, data.prev?.totalAssets ?? null),
    header('liabilities', '負債の部'),
    ...section('CURRENT_LIABILITIES'), ...section('FIXED_LIABILITIES'), ...section('OWNER_CONTRIBUTIONS'),
    total('total-liabilities', '負債合計', data.totalLiabilities, data.prev?.totalLiabilities ?? null),
    header('capital', '資本の部'), ...section('EQUITY'),
    { key: 'income', label: '控除前所得金額', kind: 'item', amount: data.incomeBeforeDeduction, prevAmount: data.prev?.incomeBeforeDeduction ?? null },
    total('total-capital', '資本合計', data.capitalTotal, data.prev?.capitalTotal ?? null),
    total('total-liabilities-capital', '負債・資本合計', data.totalLiabilitiesAndEquity, data.prev?.totalLiabilitiesAndEquity ?? null),
  ]
}
