import type { CSSProperties } from 'react'

export const NAV_COLS = [
  'date',
  'slip_number',
  'debit_account',
  'debit_sub',
  'debit_amount',
  'credit_account',
  'credit_sub',
  'credit_amount',
  'description',
] as const

export type NavCol = typeof NAV_COLS[number]
export type GridField = NavCol | 'select' | 'debit_tax' | 'credit_tax' | 'actions' | 'message'

export const JOURNAL_HEADERS = [
  { field: 'select', label: '', secondaryLabel: '' },
  { field: 'date', label: '日付', secondaryLabel: '伝票' },
  { field: 'debit_account', label: '借方科目', secondaryLabel: '補助' },
  { field: 'debit_amount', label: '借方金額', secondaryLabel: '税区分' },
  { field: 'credit_account', label: '貸方科目', secondaryLabel: '補助' },
  { field: 'credit_amount', label: '貸方金額', secondaryLabel: '税区分' },
  { field: 'description', label: '摘要', secondaryLabel: '補足' },
  { field: 'actions', label: '操作', secondaryLabel: '' },
] as const

export const JOURNAL_GRID_STYLE = {
  '--journal-compact-columns': '2.2em 5em minmax(6em, 1fr) 8em minmax(6em, 1fr) 8em',
  '--journal-full-columns': '2.2em 7.7em minmax(7em, 1fr) 8em minmax(7em, 1fr) 8em minmax(20em, 1.6fr) 8em',
} as CSSProperties

const cellPositions: Record<GridField, { column: string; second?: boolean }> = {
  select: { column: '1' },
  date: { column: '2' },
  slip_number: { column: '2', second: true },
  debit_account: { column: '3' },
  debit_sub: { column: '3', second: true },
  debit_amount: { column: '4' },
  debit_tax: { column: '4', second: true },
  credit_account: { column: '5' },
  credit_sub: { column: '5', second: true },
  credit_amount: { column: '6' },
  credit_tax: { column: '6', second: true },
  description: { column: 'var(--journal-summary-column)' },
  actions: { column: 'var(--journal-actions-column)' },
  message: { column: '1 / -1' },
}

export function journalCellStyle(field: GridField, displayIndex = 0): CSSProperties {
  const position = cellPositions[field]
  const isSummary = field === 'description' || field === 'actions'
  return {
    gridColumn: position.column,
    gridRow: field === 'select'
      ? `${displayIndex * 2 + 1} / span 2`
      : isSummary ? 'var(--journal-summary-row)' : displayIndex * 2 + (position.second ? 2 : 1),
  }
}

export function journalFragmentStyle(rowCount: number): CSSProperties {
  return { '--journal-description-row': rowCount * 2 + 1 } as CSSProperties
}
