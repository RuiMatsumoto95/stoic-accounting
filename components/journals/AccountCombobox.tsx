'use client'

import { useState, useEffect, useRef, forwardRef } from 'react'
import { createPortal } from 'react-dom'
import { AccountWithAliases, searchAccounts, normalizeText } from '@/lib/account-search'
import { isImeInput, shouldReplaceAccountOnKey } from '@/lib/account-combobox-input'
import { applyImeFreeQueryKey } from '@/lib/ime-free-input'

type DropRect = { top: number; left: number; width: number }

const AccountCombobox = forwardRef<HTMLInputElement, {
  accounts: AccountWithAliases[]
  value: string
  onChange: (id: string) => void
  showCode?: boolean
  placeholder?: string
  openOnMount?: boolean
  initialQuery?: string
  replaceOnType?: boolean
  imeFree?: boolean
}>(function AccountCombobox({ accounts, value, onChange, showCode = true, placeholder = '', openOnMount = false, initialQuery, replaceOnType = false, imeFree = false }, ref) {
  const selectedAccount = accounts.find(a => a.id === value)
  const [query, setQuery] = useState(initialQuery ?? '')
  const [browsing, setBrowsing] = useState(initialQuery === undefined && openOnMount)
  const [open, setOpen] = useState(initialQuery !== undefined || openOnMount)
  const [highlightedIndex, setHighlightedIndex] = useState(() => initialQuery === undefined && openOnMount ? Math.max(0, accounts.findIndex(a => a.id === value)) : 0)
  const [dropRect, setDropRect] = useState<DropRect>({ top: 0, left: 0, width: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const centerOnOpen = useRef(initialQuery === undefined && openOnMount)
  const initialQueryFocus = useRef(initialQuery !== undefined)
  const composing = useRef(false)

  // 外部 ref と内部 inputRef をマージする
  useEffect(() => {
    if (!ref) return
    if (typeof ref === 'function') {
      ref(inputRef.current)
    } else {
      ref.current = inputRef.current
    }
  }, [ref])

  const filtered = searchAccounts(accounts, browsing ? '' : query)
  const displayValue = selectedAccount
    ? (showCode ? `${selectedAccount.code} ${selectedAccount.name}` : selectedAccount.name)
    : ''

  useEffect(() => {
    if (!open) return
    const list = listRef.current
    const el = list?.children[highlightedIndex] as HTMLElement | undefined
    if (!list || !el) return
    if (centerOnOpen.current) {
      list.scrollTop = el.offsetTop - (list.clientHeight - el.offsetHeight) / 2
      centerOnOpen.current = false
    } else {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [open, highlightedIndex])

  useEffect(() => {
    if (open && inputRef.current) {
      const r = inputRef.current.getBoundingClientRect()
      setDropRect({ top: r.bottom, left: r.left, width: Math.max(r.width, 280) })
      if (centerOnOpen.current || browsing) inputRef.current.select()
    }
  }, [open])

  const handleSelect = (id: string) => {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeInput(e.nativeEvent, composing.current)) {
      // Enter の変換確定は妨げず、親の保存・候補選択を防ぐ。
      // Tab は既定のフォーカス移動（行外への blur 保存）も防ぐ。
      if (e.key === 'Tab') e.preventDefault()
      e.stopPropagation()
      return
    }
    if (imeFree) {
      const nextState = applyImeFreeQueryKey({ open, browsing, query }, e.nativeEvent)
      if (nextState !== null) {
        e.preventDefault()
        setQuery(nextState.query)
        setOpen(nextState.open)
        setBrowsing(nextState.browsing)
        setHighlightedIndex(0)
        return
      }
    }
    if (!imeFree && replaceOnType && shouldReplaceAccountOnKey(open, e)) e.currentTarget.select()

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (open) e.stopPropagation()
      if (!open) {
        setBrowsing(true)
        setHighlightedIndex(Math.max(0, accounts.findIndex(a => a.id === value)))
        centerOnOpen.current = true
        setOpen(true)
      }
      else setHighlightedIndex(Math.max(0, Math.min(highlightedIndex + 1, filtered.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (open) e.stopPropagation()
      setHighlightedIndex(Math.max(highlightedIndex - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && filtered.length > 0) {
        e.stopPropagation()
        handleSelect(filtered[highlightedIndex].id)
      }
      // dropdown closed: let Enter bubble to tr-level handler
    } else if (e.key === 'Tab') {
      if (open && filtered.length > 0) {
        e.preventDefault()
        e.stopPropagation()
        handleSelect(filtered[highlightedIndex].id)
      }
      // dropdown closed: let Tab bubble to tr-level handler
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        readOnly={imeFree}
        className="h-9 w-full border rounded px-3 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        value={open && !browsing ? query : displayValue}
        onChange={e => { setBrowsing(false); setQuery(e.target.value); setHighlightedIndex(0); if (!open) setOpen(true) }}
        onFocus={() => {
          if (initialQueryFocus.current) {
            initialQueryFocus.current = false
            const input = inputRef.current
            input?.setSelectionRange(input.value.length, input.value.length)
          } else inputRef.current?.select()
        }}
        onBlur={() => { composing.current = false; setOpen(false); setQuery('') }}
        onCompositionStart={e => {
          composing.current = true
          // IME は keydown.key が Process / Unidentified になるため別途扱う。
          if (!imeFree && replaceOnType && !open) e.currentTarget.select()
        }}
        onCompositionEnd={() => { composing.current = false }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
      {open && createPortal(
        <ul
          ref={listRef}
          style={{
            position: 'fixed',
            top: dropRect.top,
            left: dropRect.left,
            width: dropRect.width,
            zIndex: 9999,
          }}
          className="max-h-60 overflow-y-auto border rounded bg-background shadow-md py-1"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">該当なし</li>
          ) : (
            filtered.map((a, i) => (
              <li
                key={a.id}
                className={
                  i === highlightedIndex
                    ? 'px-3 py-1.5 text-sm cursor-pointer bg-muted flex items-center gap-2'
                    : 'px-3 py-1.5 text-sm cursor-pointer hover:bg-muted flex items-center gap-2'
                }
                onMouseDown={e => { e.preventDefault(); handleSelect(a.id) }}
                onMouseEnter={() => setHighlightedIndex(i)}
              >
                <span className="flex-1">
                  {showCode ? `${a.code} ${a.name}` : a.name}
                </span>
                {!browsing && query !== '' && (() => {
                  const matched = a.account_aliases.find(
                    al => al.normalized_alias.startsWith(normalizeText(query))
                  )
                  return matched
                    ? <span className="text-muted-foreground">{matched.alias.toUpperCase()}</span>
                    : null
                })()}
              </li>
            ))
          )}
        </ul>,
        document.body
      )}
    </>
  )
})

export default AccountCombobox
