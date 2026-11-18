import type { JournalEntryWithLines } from '@/components/journals/JournalForm'

type JournalLine = JournalEntryWithLines['journal_lines'][number]

export type DisplayRow = {
  isFirstRow: boolean
  rowIndex: number
  entry: JournalEntryWithLines
  debitLine: JournalLine | null
  creditLine: JournalLine | null
}

export type JournalViewport = {
  topIndex: number
  cell: { rowOffset: number; colIndex: number } | null
}

export type ReloadViewportRequest = { seq: number; viewport: JournalViewport }

export function pickFocusRow(rows: DisplayRow[], rowOffset: number): DisplayRow | null {
  let closest: DisplayRow | null = null
  let distance = Infinity
  rows.forEach((row, index) => {
    const nextDistance = Math.abs(index - rowOffset)
    // 同距離なら先に見つかった（同じ位置以前の）1行目を優先する。
    if (row.isFirstRow && nextDistance < distance) {
      closest = row
      distance = nextDistance
    }
  })
  return closest
}

export function restoreJournalViewport(entries: JournalEntryWithLines[], viewport: JournalViewport, maxRows = 12) {
  const window = getJournalWindow(entries, viewport.topIndex, maxRows)
  const row = viewport.cell ? pickFocusRow(window.rows, viewport.cell.rowOffset) : null
  return {
    topEntryId: window.entries[0]?.id ?? null,
    focusCell: row && viewport.cell ? { entryId: row.entry.id, colIndex: viewport.cell.colIndex } : null,
  }
}

export function expandEntry(entry: JournalEntryWithLines): DisplayRow[] {
  const debitLines = entry.journal_lines
    .filter(l => l.side === 'DEBIT')
    .sort((a, b) => a.line_number - b.line_number)
  const creditLines = entry.journal_lines
    .filter(l => l.side === 'CREDIT')
    .sort((a, b) => a.line_number - b.line_number)
  const rowCount = Math.max(debitLines.length, creditLines.length, 1)

  return Array.from({ length: rowCount }, (_, i) => ({
    isFirstRow: i === 0,
    rowIndex: i,
    entry,
    debitLine: debitLines[i] ?? null,
    creditLine: creditLines[i] ?? null,
  }))
}

export function resolveTopEntryIndex(entries: JournalEntryWithLines[], topEntryId: string | null, previousIndex: number): number {
  if (topEntryId === null) return 0
  const index = entries.findIndex(entry => entry.id === topEntryId)
  return index === -1 ? previousIndex : index
}

export function getJournalWindow(entries: JournalEntryWithLines[], requestedTopIndex = 0, maxRows = 12) {
  const expanded = entries.map(expandEntry)
  const rowCounts = expanded.map(rows => rows.length)
  const totalRows = rowCounts.reduce((sum, count) => sum + count, 0)
  let lastTopIndex = Math.max(0, entries.length - 1)
  let lastRows = rowCounts[lastTopIndex] ?? 0
  while (lastTopIndex > 0 && lastRows + rowCounts[lastTopIndex - 1] <= maxRows) {
    lastRows += rowCounts[--lastTopIndex]
  }
  const topIndex = Math.max(0, Math.min(requestedTopIndex, lastTopIndex))
  let endEntryIndex = topIndex
  let rowCount = rowCounts[topIndex] ?? 0
  while (endEntryIndex + 1 < entries.length && rowCount + rowCounts[endEntryIndex + 1] <= maxRows) {
    rowCount += rowCounts[++endEntryIndex]
  }
  const rows = expanded.slice(topIndex, endEntryIndex + 1).flat()
  const startIndex = rowCounts.slice(0, topIndex).reduce((sum, count) => sum + count, 0)
  return {
    entries: entries.slice(topIndex, endEntryIndex + 1), rows, topIndex, endEntryIndex,
    startRow: rows.length ? startIndex + 1 : 0, endRow: startIndex + rows.length,
    totalRows, lastTopIndex,
  }
}

export function slideJournalWindow(entries: JournalEntryWithLines[], topIndex: number, targetIndex: number, maxRows = 12): number {
  let window = getJournalWindow(entries, topIndex, maxRows)
  if (targetIndex < window.topIndex) return getJournalWindow(entries, targetIndex, maxRows).topIndex
  while (targetIndex > window.endEntryIndex && window.topIndex < window.lastTopIndex) {
    window = getJournalWindow(entries, window.topIndex + 1, maxRows)
  }
  return window.topIndex
}

export function jumpJournalWindow(entries: JournalEntryWithLines[], topIndex: number, direction: 'first' | 'prev' | 'next' | 'last', maxRows = 12): number {
  const window = getJournalWindow(entries, topIndex, maxRows)
  if (direction === 'first') return 0
  if (direction === 'last') return window.lastTopIndex
  if (direction === 'next') return getJournalWindow(entries, window.endEntryIndex + 1, maxRows).topIndex
  let previousTop = Math.max(0, window.topIndex - 1)
  let rows = entries[previousTop] ? expandEntry(entries[previousTop]).length : 0
  while (previousTop > 0) {
    const count = expandEntry(entries[previousTop - 1]).length
    if (rows + count > maxRows) break
    rows += count
    previousTop--
  }
  return previousTop
}

export function findPrevFirstRow(rows: DisplayRow[], fromIdx: number): number | null {
  for (let i = fromIdx - 1; i >= 0; i--) {
    if (rows[i].isFirstRow) return i
  }
  return null
}

export function findNextFirstRow(rows: DisplayRow[], fromIdx: number): number | null {
  for (let i = fromIdx + 1; i < rows.length; i++) {
    if (rows[i].isFirstRow) return i
  }
  return null
}

export type EntryFragment = {
  entry: JournalEntryWithLines
  startRowIndex: number
  hasFirstRow: boolean
  rows: DisplayRow[]
}

// 表示範囲外の明細を混ぜないよう、渡された行だけをまとめる。
export function fragmentPageRows(rows: DisplayRow[]): EntryFragment[] {
  const fragments: EntryFragment[] = []
  rows.forEach((row, localIndex) => {
    const previous = fragments[fragments.length - 1]
    if (previous?.entry.id === row.entry.id) {
      previous.rows.push(row)
    } else {
      fragments.push({
        entry: row.entry,
        startRowIndex: localIndex,
        hasFirstRow: row.isFirstRow,
        rows: [row],
      })
    }
  })
  return fragments
}
