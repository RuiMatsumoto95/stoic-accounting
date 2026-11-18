'use client'

type LedgerRow = {
  id: string
  line_number: number
  date: string
  reference_number: number | null
  account_name: string
  entry_description: string
  counter_account_name: string | null
  side: 'DEBIT' | 'CREDIT'
  amount: number
  balance: number
}

type Props = {
  rows: LedgerRow[]
  openingBalance: number   // 0 = 前期なし or 期首残高ゼロ → 行を非表示
  isDebitNormal: boolean
  periodStartDate: string
}

export default function LedgerTable({ rows, openingBalance, isDebitNormal, periodStartDate }: Props) {
  const showOpeningRow = openingBalance !== 0
  const hasData = rows.length > 0 || showOpeningRow

  if (!hasData) {
    return (
      <p className="text-muted-foreground text-sm">
        この科目の仕訳データがありません。
      </p>
    )
  }

  // 期首残高の借方・貸方欄への振り分け
  // isDebitNormal(ASSET): 正の残高 → 借方、負の残高 → 貸方（異常残）
  // !isDebitNormal(LIABILITY/EQUITY): 正の残高 → 貸方、負の残高 → 借方（異常残）
  const openingDebit = isDebitNormal
    ? (openingBalance > 0 ? openingBalance : 0)
    : (openingBalance < 0 ? -openingBalance : 0)
  const openingCredit = isDebitNormal
    ? (openingBalance < 0 ? -openingBalance : 0)
    : (openingBalance > 0 ? openingBalance : 0)

  const totalDebit = openingDebit + rows.filter(r => r.side === 'DEBIT').reduce((s, r) => s + r.amount, 0)
  const totalCredit = openingCredit + rows.filter(r => r.side === 'CREDIT').reduce((s, r) => s + r.amount, 0)
  const closingBalance = rows.length > 0 ? rows[rows.length - 1].balance : openingBalance

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="p-2 w-28">日付</th>
            <th className="p-2 w-24">伝票番号</th>
            <th className="p-2 w-28">科目</th>
            <th className="p-2 w-36">相手科目</th>
            <th className="p-2">摘要</th>
            <th className="p-2 w-28 text-right">借方</th>
            <th className="p-2 w-28 text-right">貸方</th>
            <th className="p-2 w-28 text-right">残高</th>
          </tr>
        </thead>
        <tbody>
          {/* 前期繰越行（BS科目かつ期首残高あり） */}
          {showOpeningRow && (
            <tr className="border-b bg-muted/50">
              <td className="p-2">{periodStartDate}</td>
              <td className="p-2 text-muted-foreground">-</td>
              <td className="p-2 text-muted-foreground">-</td>
              <td className="p-2 text-muted-foreground">-</td>
              <td className="p-2 font-medium">前期繰越</td>
              <td className="p-2 text-right tabular-nums">
                {openingDebit > 0 ? openingDebit.toLocaleString() : ''}
              </td>
              <td className="p-2 text-right tabular-nums">
                {openingCredit > 0 ? openingCredit.toLocaleString() : ''}
              </td>
              <td className="p-2 text-right font-medium tabular-nums">
                {Math.abs(openingBalance).toLocaleString()}
              </td>
            </tr>
          )}

          {/* 明細行 */}
          {rows.map((row) => (
            <tr key={`${row.id}-${row.line_number}`} className="border-b hover:bg-muted/30">
              <td className="p-2">{row.date}</td>
              <td className="p-2">{row.reference_number ?? '-'}</td>
              <td className="p-2">{row.account_name}</td>
              <td className="p-2">{row.counter_account_name ?? '-'}</td>
              <td className="p-2">{row.entry_description}</td>
              <td className="p-2 text-right tabular-nums">
                {row.side === 'DEBIT' ? row.amount.toLocaleString() : ''}
              </td>
              <td className="p-2 text-right tabular-nums">
                {row.side === 'CREDIT' ? row.amount.toLocaleString() : ''}
              </td>
              <td className="p-2 text-right tabular-nums">
                {row.balance.toLocaleString()}
              </td>
            </tr>
          ))}

          {/* 合計行 */}
          <tr className="border-t-2 font-semibold bg-muted/50">
            <td className="p-2" colSpan={5}>合計</td>
            <td className="p-2 text-right tabular-nums">{totalDebit.toLocaleString()}</td>
            <td className="p-2 text-right tabular-nums">{totalCredit.toLocaleString()}</td>
            <td className="p-2 text-right tabular-nums">{closingBalance.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
