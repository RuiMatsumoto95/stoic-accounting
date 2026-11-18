export function formatAmount(amount: number, showSign = false): string {
  if (amount < 0) {
    return `△${Math.abs(amount).toLocaleString()}`
  }
  if (showSign && amount > 0) {
    return `+${amount.toLocaleString()}`
  }
  return amount.toLocaleString()
}

export function formatRate(rate: number): string {
  const sign = rate >= 0 ? '+' : ''
  return `${sign}${(rate * 100).toFixed(1)}%`
}
