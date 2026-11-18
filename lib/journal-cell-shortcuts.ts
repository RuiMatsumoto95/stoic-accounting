import type { NavCol } from '@/components/journals/journal-grid'
import { isImeInput } from './account-combobox-input'

// 一覧の通常の ↓ 移動より先に判定し、preventDefault / stopPropagation せず返す。
export function shouldBubbleJournalCtrlDown(event: {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}): boolean {
  return event.ctrlKey && !event.shiftKey && !event.altKey && event.key === 'ArrowDown'
}

export type JournalInitialInput = {
  field: NavCol
  text: string
}

export function getJournalCellInitialInput(
  field: NavCol,
  event: {
    key: string
    ctrlKey: boolean
    altKey: boolean
    metaKey: boolean
    isComposing: boolean
    keyCode: number
    repeat: boolean
  },
  context: { isFirstRow: boolean; isOpeningBalance: boolean; showForm: boolean; editing: boolean },
): JournalInitialInput | null {
  if (!context.isFirstRow || context.isOpeningBalance || context.showForm || context.editing
    || isImeInput(event) || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return null
  if (event.key.length !== 1 || event.key === ' ' || /[\u0000-\u001f\u007f-\u009f]/.test(event.key)) return null

  switch (field) {
    case 'date':
    case 'debit_amount':
    case 'credit_amount':
      return /^[0-9]$/.test(event.key) ? { field, text: event.key } : null
    case 'debit_account':
    case 'credit_account':
    case 'description':
      return { field, text: event.key }
    default:
      return null
  }
}
