import type { FiscalPeriod } from './fiscal-period'

export function isPeriodClosed(period: Pick<FiscalPeriod, 'closed_at'> | null | undefined): boolean {
  return period?.closed_at != null
}

type Availability = { enabled: boolean; reason: string | null }

export function getPeriodCloseActions(period: FiscalPeriod, periods: FiscalPeriod[]): { close: Availability; reopen: Availability } {
  const ordered = [...periods].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id))
  const index = ordered.findIndex(p => p.id === period.id)
  if (index < 0) {
    const unavailable = { enabled: false, reason: '会計期間が見つかりません' }
    return { close: unavailable, reopen: unavailable }
  }
  const previous = ordered[index - 1]
  const next = ordered[index + 1]
  const closeReason = isPeriodClosed(period) ? 'この期は既に確定されています'
    : previous && !isPeriodClosed(previous) ? '前の期を先に確定してください' : null
  const reopenReason = !isPeriodClosed(period) ? 'この期は確定されていません'
    : next && isPeriodClosed(next) ? '次の期を先に解除してください' : null
  return { close: { enabled: closeReason === null, reason: closeReason }, reopen: { enabled: reopenReason === null, reason: reopenReason } }
}
