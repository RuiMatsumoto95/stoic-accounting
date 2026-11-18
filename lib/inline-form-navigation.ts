import type { GridField, NavCol } from '@/components/journals/journal-grid'
import { isImeInput } from './account-combobox-input'

export function getInlineFormNavigateUpColumn(
  field: GridField | 'supplement',
  rowIndex: number,
  event: {
    key: string
    ctrlKey: boolean
    shiftKey: boolean
    altKey: boolean
    metaKey: boolean
    isComposing: boolean
    keyCode: number
  },
  hasPendingDateInput = false,
): NavCol | null {
  if (rowIndex !== 0 || event.key !== 'ArrowUp'
    || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || isImeInput(event)) return null

  switch (field) {
    case 'date':
      return hasPendingDateInput ? null : field
    case 'debit_account':
    case 'debit_amount':
    case 'credit_account':
    case 'credit_amount':
      return field
    // 摘要はネイティブ datalist の ↑ 操作を優先する。
    default:
      return null
  }
}
