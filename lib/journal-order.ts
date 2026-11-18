import type { JournalEntryWithLines } from '@/components/journals/JournalForm'

type Entry = JournalEntryWithLines

export type JournalFetchResult =
  | { ok: true; entries: Entry[] }
  | { ok: false; error: unknown }

export function commitEntry(current: Entry[], tempId: string, real: Entry): Entry[] {
  const hasTemp = current.some(entry => entry.id === tempId)
  if (!hasTemp) return current.map(entry => entry.id === real.id ? real : entry)
  return current.flatMap(entry => entry.id === tempId ? [real] : entry.id === real.id ? [] : [entry])
}

export function keepCurrentOrder(current: Entry[], fetched: Entry[], keepIds: ReadonlySet<string>): Entry[] {
  const byId = new Map(fetched.map(entry => [entry.id, entry]))
  const currentIds = new Set(current.map(entry => entry.id))
  return [
    ...current.flatMap(entry => {
      const fresh = byId.get(entry.id)
      return fresh ? [fresh] : keepIds.has(entry.id) ? [entry] : []
    }),
    ...fetched.filter(entry => !currentIds.has(entry.id)),
  ]
}

export function reorderWithFetched(current: Entry[], fetched: Entry[], keepIds: ReadonlySet<string>): Entry[] {
  const fetchedIds = new Set(fetched.map(entry => entry.id))
  return [...fetched, ...current.filter(entry => keepIds.has(entry.id) && !fetchedIds.has(entry.id))]
}

export function getFetchKeepIds(pendingIds: ReadonlySet<string>, committedAt: ReadonlyMap<string, number>, seq: number): Set<string> {
  return new Set([...pendingIds, ...[...committedAt].filter(([, at]) => at >= seq).map(([id]) => id)])
}

export function isLatestFetch(seq: number, latestSeq: number): boolean {
  return seq === latestSeq
}

export function applyJournalFetch(current: Entry[], result: JournalFetchResult, {
  seq, latestSeq, keepIds, keepOrder,
}: { seq: number; latestSeq: number; keepIds: ReadonlySet<string>; keepOrder: boolean }): Entry[] {
  if (!result.ok || !isLatestFetch(seq, latestSeq)) return current
  return keepOrder
    ? keepCurrentOrder(current, result.entries, keepIds)
    : reorderWithFetched(current, result.entries, keepIds)
}

type F5Event = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'repeat' | 'isComposing'>

export function classifyF5(event: F5Event, { editing, formOpen, busy }: {
  editing: boolean; formOpen: boolean; busy: boolean
}): 'browser' | 'swallow' | 'reload' {
  if (event.key !== 'F5' || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return 'browser'
  if (event.repeat || event.isComposing || editing || formOpen || busy) return 'swallow'
  return 'reload'
}

export function shouldApplyReload({ seq, latestSeq, editing, formOpen, pendingFocus }: {
  seq: number; latestSeq: number; editing: boolean; formOpen: boolean; pendingFocus: boolean
}): boolean {
  return isLatestFetch(seq, latestSeq) && !editing && !formOpen && !pendingFocus
}
