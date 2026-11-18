import { PLResult } from '@/lib/financial-statements'
import { SectionHeader } from './SectionHeader'
import { FinancialRow } from './FinancialRow'

interface Props {
  data: PLResult
  showPrev: boolean
  hideZero: boolean
}

function SubtotalRow({
  label,
  amount,
  prevAmount,
  showPrev,
  isProfit,
}: {
  label: string
  amount: number
  prevAmount: number | null
  showPrev: boolean
  isProfit?: boolean
}) {
  const change = prevAmount !== null ? amount - prevAmount : null
  const rate =
    prevAmount !== null && prevAmount !== 0
      ? (amount - prevAmount) / Math.abs(prevAmount)
      : null

  return (
    <FinancialRow
      label={label}
      amount={amount}
      prevAmount={prevAmount}
      changeAmount={change}
      changeRate={rate}
      isSubtotal
      showPrev={showPrev}
      amountClassName={
        isProfit
          ? amount >= 0
            ? 'text-blue-700 font-bold'
            : 'text-red-700 font-bold'
          : ''
      }
    />
  )
}

export function PLTable({ data, showPrev, hideZero }: Props) {
  const colSpan = showPrev ? 5 : 2

  const getSection = (cat: PLResult['sections'][number]['category']) =>
    data.sections.find(s => s.category === cat)!

  const shouldShowItem = (item: { amount: number; prev_amount: number | null }) => {
    if (!hideZero) return true
    if (showPrev) return item.amount !== 0 || (item.prev_amount ?? 0) !== 0
    return item.amount !== 0
  }

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b text-xs text-muted-foreground">
          <th className="py-2 text-left pl-3">科目</th>
          <th className="py-2 text-right pr-3 w-36">当期</th>
          {showPrev && (
            <>
              <th className="py-2 text-right pr-3 w-36">前期</th>
              <th className="py-2 text-right pr-3 w-36">増減額</th>
              <th className="py-2 text-right pr-3 w-24">増減率</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {/* 売上高 */}
        <SectionHeader label="売上高" colSpan={colSpan} />
        {getSection('REVENUE').items
          .filter(shouldShowItem)
          .map(item => (
          <FinancialRow
            key={item.account_id}
            label={item.account_name}
            indent={1}
            amount={item.amount}
            prevAmount={item.prev_amount}
            changeAmount={item.change_amount}
            changeRate={item.change_rate}
            showPrev={showPrev}
          />
        ))}
        <SubtotalRow
          label="売上高合計"
          amount={data.revenueTotal}
          prevAmount={data.prev?.revenueTotal ?? null}
          showPrev={showPrev}
        />

        {/* 売上原価 */}
        <SectionHeader label="売上原価" colSpan={colSpan} />
        {getSection('COGS').items
          .filter(shouldShowItem)
          .map(item => (
          <FinancialRow
            key={item.account_id}
            label={item.account_name}
            indent={1}
            amount={item.amount}
            prevAmount={item.prev_amount}
            changeAmount={item.change_amount}
            changeRate={item.change_rate}
            showPrev={showPrev}
          />
        ))}
        <SubtotalRow
          label="売上原価合計"
          amount={data.cogsTotal}
          prevAmount={data.prev?.cogsTotal ?? null}
          showPrev={showPrev}
        />

        {/* 売上総利益 */}
        <SubtotalRow
          label="売上総利益"
          amount={data.grossProfit}
          prevAmount={data.prev?.grossProfit ?? null}
          showPrev={showPrev}
          isProfit
        />

        {/* 販売費及び一般管理費 */}
        <SectionHeader label="販売費及び一般管理費" colSpan={colSpan} />
        {getSection('SGA').items
          .filter(shouldShowItem)
          .map(item => (
          <FinancialRow
            key={item.account_id}
            label={item.account_name}
            indent={1}
            amount={item.amount}
            prevAmount={item.prev_amount}
            changeAmount={item.change_amount}
            changeRate={item.change_rate}
            showPrev={showPrev}
          />
        ))}
        <SubtotalRow
          label="販売管理費計"
          amount={data.sgaTotal}
          prevAmount={data.prev?.sgaTotal ?? null}
          showPrev={showPrev}
        />

        {/* 営業損益 */}
        <SubtotalRow
          label="営業損益"
          amount={data.operatingIncome}
          prevAmount={data.prev?.operatingIncome ?? null}
          showPrev={showPrev}
          isProfit
        />

        {/* 営業外収益 */}
        <SectionHeader label="営業外収益" colSpan={colSpan} />
        {getSection('NON_OP_INCOME').items
          .filter(shouldShowItem)
          .map(item => (
          <FinancialRow
            key={item.account_id}
            label={item.account_name}
            indent={1}
            amount={item.amount}
            prevAmount={item.prev_amount}
            changeAmount={item.change_amount}
            changeRate={item.change_rate}
            showPrev={showPrev}
          />
        ))}
        <SubtotalRow
          label="営業外収益合計"
          amount={data.nonOpIncomeTotal}
          prevAmount={data.prev?.nonOpIncomeTotal ?? null}
          showPrev={showPrev}
        />

        {/* 営業外費用 */}
        <SectionHeader label="営業外費用" colSpan={colSpan} />
        {getSection('NON_OP_EXPENSE').items
          .filter(shouldShowItem)
          .map(item => (
          <FinancialRow
            key={item.account_id}
            label={item.account_name}
            indent={1}
            amount={item.amount}
            prevAmount={item.prev_amount}
            changeAmount={item.change_amount}
            changeRate={item.change_rate}
            showPrev={showPrev}
          />
        ))}
        <SubtotalRow
          label="営業外費用合計"
          amount={data.nonOpExpenseTotal}
          prevAmount={data.prev?.nonOpExpenseTotal ?? null}
          showPrev={showPrev}
        />

        {/* 経常損益 */}
        <SubtotalRow
          label="経常損益"
          amount={data.ordinaryIncome}
          prevAmount={data.prev?.ordinaryIncome ?? null}
          showPrev={showPrev}
          isProfit
        />

        {/* 特別利益 */}
        <SectionHeader label="特別利益" colSpan={colSpan} />
        {getSection('EXTRA_INCOME').items
          .filter(shouldShowItem)
          .map(item => (
          <FinancialRow
            key={item.account_id}
            label={item.account_name}
            indent={1}
            amount={item.amount}
            prevAmount={item.prev_amount}
            changeAmount={item.change_amount}
            changeRate={item.change_rate}
            showPrev={showPrev}
          />
        ))}
        <SubtotalRow
          label="特別利益合計"
          amount={data.extraIncomeTotal}
          prevAmount={data.prev?.extraIncomeTotal ?? null}
          showPrev={showPrev}
        />

        {/* 特別損失 */}
        <SectionHeader label="特別損失" colSpan={colSpan} />
        {getSection('EXTRA_LOSS').items
          .filter(shouldShowItem)
          .map(item => (
          <FinancialRow
            key={item.account_id}
            label={item.account_name}
            indent={1}
            amount={item.amount}
            prevAmount={item.prev_amount}
            changeAmount={item.change_amount}
            changeRate={item.change_rate}
            showPrev={showPrev}
          />
        ))}
        <SubtotalRow
          label="特別損失合計"
          amount={data.extraLossTotal}
          prevAmount={data.prev?.extraLossTotal ?? null}
          showPrev={showPrev}
        />

        {/* 税引前当期損益 */}
        <SubtotalRow
          label="税引前当期損益"
          amount={data.incomeBeforeTax}
          prevAmount={data.prev?.incomeBeforeTax ?? null}
          showPrev={showPrev}
          isProfit
        />

        {/* 法人税等 */}
        <SectionHeader label="法人税等" colSpan={colSpan} />
        {getSection('TAX').items
          .filter(shouldShowItem)
          .map(item => (
          <FinancialRow
            key={item.account_id}
            label={item.account_name}
            indent={1}
            amount={item.amount}
            prevAmount={item.prev_amount}
            changeAmount={item.change_amount}
            changeRate={item.change_rate}
            showPrev={showPrev}
          />
        ))}
        <SubtotalRow
          label="法人税等合計"
          amount={data.taxTotal}
          prevAmount={data.prev?.taxTotal ?? null}
          showPrev={showPrev}
        />

        {/* 当期純損益 */}
        <SubtotalRow
          label="当期純損益"
          amount={data.netIncome}
          prevAmount={data.prev?.netIncome ?? null}
          showPrev={showPrev}
          isProfit
        />
      </tbody>
    </table>
  )
}
