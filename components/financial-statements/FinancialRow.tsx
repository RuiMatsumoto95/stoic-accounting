import { formatAmount, formatRate } from '@/lib/financial-statements-ui'

interface Props {
  label: string
  indent?: number
  amount: number
  prevAmount: number | null
  changeAmount: number | null
  changeRate: number | null
  isSubtotal?: boolean
  showPrev: boolean
  amountClassName?: string
}

export function FinancialRow({
  label,
  indent = 0,
  amount,
  prevAmount,
  changeAmount,
  changeRate,
  isSubtotal = false,
  showPrev,
  amountClassName,
}: Props) {
  const indentClass = indent === 1 ? 'pl-8' : 'pl-3'
  const weightClass = isSubtotal
    ? 'font-semibold bg-muted/30 border-t border-border'
    : ''

  return (
    <tr className={`border-b text-sm ${weightClass}`}>
      <td className={`py-1.5 pr-4 ${indentClass}`}>{label}</td>
      <td
        className={`py-1.5 text-right tabular-nums w-36 pr-3 ${
          amountClassName ?? ''
        }`}
      >
        {formatAmount(amount)}
      </td>
      {showPrev && (
        <>
          <td className="py-1.5 text-right tabular-nums w-36 pr-3 text-muted-foreground">
            {prevAmount !== null ? formatAmount(prevAmount) : '—'}
          </td>
          <td
            className={`py-1.5 text-right tabular-nums w-36 pr-3 ${
              (changeAmount ?? 0) >= 0 ? 'text-blue-600' : 'text-red-600'
            }`}
          >
            {changeAmount !== null ? formatAmount(changeAmount, true) : '—'}
          </td>
          <td
            className={`py-1.5 text-right tabular-nums w-24 pr-3 ${
              (changeRate ?? 0) >= 0 ? 'text-blue-600' : 'text-red-600'
            }`}
          >
            {changeRate !== null ? formatRate(changeRate) : '—'}
          </td>
        </>
      )}
    </tr>
  )
}
