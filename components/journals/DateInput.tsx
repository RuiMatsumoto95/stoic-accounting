'use client'
import { forwardRef, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { FiscalPeriod, resolveYearFromMonth } from '@/lib/fiscal-period'
import { resolveDateInput } from '@/lib/date-input'
import { applyImeFreeDateKey } from '@/lib/ime-free-input'

export type DateInputHandle = {
  // onChange の再レンダーを待たず、保存に使用する確定値を返す。不正なら null。
  commit: () => string | null
}

export type DateInputStatusHandle = {
  hasPendingInput: () => boolean
}

type Props = {
  value: string                        // "YYYY-MM-DD" 形式（空文字の場合あり）
  onChange: (value: string) => void    // "YYYY-MM-DD" 形式で返す
  period: FiscalPeriod
  error?: string
  initialInputText?: string
  imeFree?: boolean
  commitRef?: Ref<DateInputHandle>
  statusRef?: Ref<DateInputStatusHandle>
}

const DateInput = forwardRef<HTMLInputElement, Props>(function DateInput(
  { value, onChange, period, error, initialInputText, commitRef, statusRef, imeFree = false },
  ref
) {
  const [focused, setFocused] = useState(initialInputText !== undefined)
  const [inputText, setInputText] = useState(initialInputText ?? '')
  const [inputError, setInputError] = useState('')
  const pendingText = useRef(initialInputText ?? '')
  const initialFocus = useRef(initialInputText !== undefined)

  function commit(): string | null {
    const result = resolveDateInput(pendingText.current, value, month => resolveYearFromMonth(month, period), true)
    setInputError(result.error ?? '')
    if (result.value !== null) onChange(result.value)
    return result.value
  }

  useImperativeHandle(commitRef, () => ({ commit }))
  useImperativeHandle(statusRef, () => ({
    hasPendingInput: () => focused && pendingText.current.trim() !== '',
  }))

  // 非フォーカス時の表示: "MM/DD" 形式
  const displayValue = value ? `${value.slice(5, 7)}/${value.slice(8, 10)}` : ''

  function handleFocus() {
    setFocused(true)
    if (initialFocus.current) initialFocus.current = false
    else {
      pendingText.current = ''
      setInputText('')
    }
    setInputError('')
  }

  function handleBlur() {
    setFocused(false)
    if (commitRef) { commit(); return }
    if (!pendingText.current.trim()) return  // 入力なし→既存値を維持
    const result = resolveDateInput(pendingText.current, value, month => resolveYearFromMonth(month, period))
    setInputError(result.error ?? '')
    onChange(result.value ?? '')
  }

  const combinedError = error || inputError

  return (
    <div>
      <input
        ref={ref}
        type="text"
        className="h-9 w-24 border rounded px-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        value={focused || (commitRef && inputError) ? inputText : displayValue}
        placeholder={focused ? 'MMDD または M/D' : 'MM/DD'}
        readOnly={imeFree || !focused}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={e => { pendingText.current = e.target.value; setInputText(e.target.value) }}
        onKeyDown={e => {
          if (!imeFree) return
          const nextText = applyImeFreeDateKey(pendingText.current, e.nativeEvent)
          if (nextText === null) return
          e.preventDefault()
          pendingText.current = nextText
          setInputText(nextText)
        }}
      />
      {combinedError && (
        <p className="text-red-500 text-xs mt-1">{combinedError}</p>
      )}
    </div>
  )
})

export default DateInput
