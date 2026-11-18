export const fmt = (n: number) => n.toLocaleString('ja-JP')

export const fmtAmount = (n: number): string => {
  if (n === 0) return '-'
  if (n < 0) return `△${fmt(Math.abs(n))}`
  return fmt(n)
}

export const fmtDiff = (current: number, prev: number): string => {
  const diff = current - prev
  if (diff === 0) return '-'
  if (diff < 0) return `△${fmt(Math.abs(diff))}`
  return fmt(diff)
}

// 期首残高・期末残高表示：ゼロなら '—'、非ゼロなら絶対値
export const fmtOb = (n: number): string =>
  n !== 0 ? Math.abs(n).toLocaleString('ja-JP') : '—'
