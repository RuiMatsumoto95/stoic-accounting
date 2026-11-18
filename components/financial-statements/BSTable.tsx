import { BSResult } from '@/lib/financial-statements'
import { SectionHeader } from './SectionHeader'
import { FinancialRow } from './FinancialRow'

interface Props {
  data: BSResult
  showPrev: boolean
  hideZero: boolean
}

function SubtotalRow({
  label,
  amount,
  prevAmount,
  showPrev,
  isBold,
}: {
  label: string
  amount: number
  prevAmount: number | null
  showPrev: boolean
  isBold?: boolean
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
      amountClassName={isBold ? 'font-bold' : ''}
    />
  )
}

export function BSTable({ data, showPrev, hideZero }: Props) {
  const colSpan = showPrev ? 5 : 2

  const getSection = (cat: BSResult['sections'][number]['category']) =>
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
          <th className="py-2 text-right pr-3 w-36">当期末</th>
          {showPrev && (
            <>
              <th className="py-2 text-right pr-3 w-36">前期末</th>
              <th className="py-2 text-right pr-3 w-36">増減額</th>
              <th className="py-2 text-right pr-3 w-24">増減率</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {/* ── 資産の部 ── */}
        <SectionHeader label="【資産の部】" colSpan={colSpan} />

        <SectionHeader label="流動資産" colSpan={colSpan} />
        {getSection('CURRENT_ASSETS').items
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
          label="流動資産合計"
          amount={data.currentAssetsTotal}
          prevAmount={data.prev?.currentAssetsTotal ?? null}
          showPrev={showPrev}
        />

        <SectionHeader label="固定資産" colSpan={colSpan} />
        {getSection('FIXED_ASSETS').items
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
          label="固定資産合計"
          amount={data.fixedAssetsTotal}
          prevAmount={data.prev?.fixedAssetsTotal ?? null}
          showPrev={showPrev}
        />

        <SectionHeader label="繰延資産" colSpan={colSpan} />
        {getSection('DEFERRED_ASSETS').items
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
          label="繰延資産合計"
          amount={data.deferredAssetsTotal}
          prevAmount={data.prev?.deferredAssetsTotal ?? null}
          showPrev={showPrev}
        />

        <SubtotalRow
          label="資産合計"
          amount={data.totalAssets}
          prevAmount={data.prev?.totalAssets ?? null}
          showPrev={showPrev}
          isBold
        />

        {/* ── 負債の部 ── */}
        <SectionHeader label="【負債の部】" colSpan={colSpan} />

        <SectionHeader label="流動負債" colSpan={colSpan} />
        {getSection('CURRENT_LIABILITIES').items
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
          label="流動負債合計"
          amount={data.currentLiabilitiesTotal}
          prevAmount={data.prev?.currentLiabilitiesTotal ?? null}
          showPrev={showPrev}
        />

        <SectionHeader label="固定負債" colSpan={colSpan} />
        {getSection('FIXED_LIABILITIES').items
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
          label="固定負債合計"
          amount={data.fixedLiabilitiesTotal}
          prevAmount={data.prev?.fixedLiabilitiesTotal ?? null}
          showPrev={showPrev}
        />

        <SubtotalRow
          label="負債合計"
          amount={data.totalLiabilities}
          prevAmount={data.prev?.totalLiabilities ?? null}
          showPrev={showPrev}
          isBold
        />

        {/* ── 純資産の部 ── */}
        <SectionHeader label="【純資産の部】" colSpan={colSpan} />

        <SectionHeader label="純資産" colSpan={colSpan} />
        {getSection('EQUITY').items
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
        {/* 当期純損益を純資産内に表示 */}
        <FinancialRow
          label="当期純損益"
          indent={1}
          amount={data.netIncome}
          prevAmount={data.prev?.netIncome ?? null}
          changeAmount={data.prev !== null ? data.netIncome - data.prev.netIncome : null}
          changeRate={
            data.prev !== null && data.prev.netIncome !== 0
              ? (data.netIncome - data.prev.netIncome) / Math.abs(data.prev.netIncome)
              : null
          }
          showPrev={showPrev}
          amountClassName={
            data.netIncome >= 0 ? 'text-blue-700' : 'text-red-700'
          }
        />
        <SubtotalRow
          label="純資産合計"
          amount={data.equityTotal}
          prevAmount={data.prev?.equityTotal ?? null}
          showPrev={showPrev}
          isBold
        />

        {/* 負債純資産合計 */}
        <SubtotalRow
          label="負債純資産合計"
          amount={data.totalLiabilitiesAndEquity}
          prevAmount={data.prev?.totalLiabilitiesAndEquity ?? null}
          showPrev={showPrev}
          isBold
        />
      </tbody>
    </table>
  )
}
