import { isImeInput } from '@/lib/account-combobox-input'

type ImeFreeKey = {
  key: string
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  isComposing: boolean
  keyCode: number
}

type QueryState = {
  open: boolean
  browsing: boolean
  query: string
}

export function applyImeFreeDateKey(text: string, event: ImeFreeKey): string | null {
  if (isImeInput(event) || event.ctrlKey || event.altKey || event.metaKey) return null

  if (/^[0-9]$/.test(event.key)) return text.length < 5 ? text + event.key : text
  if (event.key === '/' && text !== '' && !text.includes('/')) return text.length < 5 ? text + '/' : text
  if (event.key === 'Backspace') return text.slice(0, -1)
  if (event.key === 'Delete') return ''
  return null
}

export function applyImeFreeQueryKey(state: QueryState, event: ImeFreeKey): QueryState | null {
  if (isImeInput(event) || event.ctrlKey || event.altKey || event.metaKey) return null

  if (/^[!-~]$/.test(event.key)) {
    return { query: !state.open || state.browsing ? event.key : state.query + event.key, open: true, browsing: false }
  }
  if (event.key === 'Backspace' && state.open && !state.browsing) {
    return { query: state.query.slice(0, -1), open: true, browsing: false }
  }
  return null
}

export function applyImeFreeAmountKey(text: string, event: ImeFreeKey, replaceAll: boolean): string | null {
  if (isImeInput(event) || event.ctrlKey || event.altKey || event.metaKey) return null

  if (event.key === 'Backspace') return replaceAll ? '' : text.slice(0, -1)
  if (event.key === 'Delete') return ''

  let nextText: string
  if (/^[0-9]$/.test(event.key)) nextText = replaceAll ? event.key : text + event.key
  else if (event.key === '/' || event.key === '.') {
    if (replaceAll || text === '') return text
    nextText = text + '000'
  } else return null

  return /^[0-9]{1,13}([.][0-9]{0,2})?$/.test(nextText) ? nextText : text
}
