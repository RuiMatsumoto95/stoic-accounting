import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactNode, type ReactElement, type ComponentProps } from 'react'

// DOM や新しいパッケージを使わず、親コンポーネントの実際のイベントハンドラーを検証する。
// 子コンポーネントは展開しない。ブラウザーのフォーカス・IME 自体は実機確認が必要。
const hooks = vi.hoisted(() => {
  let slots: unknown[] = []
  let cursor = 0
  let mounted = false
  let effects: (() => unknown)[] = []
  return {
    reset() { slots = []; cursor = 0; mounted = false; effects = [] },
    begin() { cursor = 0 },
    flush() { mounted = true; const pending = effects; effects = []; pending.forEach(effect => effect()) },
    useState<T>(initial: T | (() => T)) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial
      return [slots[index] as T, (next: T | ((current: T) => T)) => {
        slots[index] = typeof next === 'function' ? (next as (current: T) => T)(slots[index] as T) : next
      }] as const
    },
    useRef<T>(initial: T) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index] as { current: T }
    },
    useEffect(effect: () => unknown) { if (!mounted) effects.push(effect) },
  }
})

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: hooks.useState,
  useRef: hooks.useRef,
  useEffect: hooks.useEffect,
  useCallback: <T,>(callback: T) => callback,
  useImperativeHandle: () => {},
  forwardRef: <P,>(render: (props: P, ref: null) => ReactNode) => (props: P) => render(props, null),
}))
vi.mock('@/contexts/FiscalPeriodContext', () => ({ useCurrentPeriod: () => ({ period: { id: 'p', start_date: '2026-04-01', end_date: '2027-03-31' } }) }))
vi.mock('@/contexts/CompanyContext', () => ({ useCompany: () => ({ id: 'fixture-company' }) }))
vi.mock('@/contexts/DisplaySettingsContext', () => ({ useDisplaySettings: () => [{ showSubAccount: false, showTaxClass: false }] }))
vi.mock('@/lib/tax-codes', () => ({ getTaxMethod: async () => 'EXEMPT', getAllTaxCodes: async () => [], filterTaxCodes: () => [] }))
const saved = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/journal-save', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/journal-save')>(),
  createJournalEntry: saved.create, updateJournalEntry: saved.update,
}))
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ error: saved.toast }) }))

import JournalForm, { type JournalEntryWithLines } from '@/components/journals/JournalForm'
import InlineEditRow from '@/components/journals/InlineEditRow'
import InlineJournalForm from '@/components/journals/InlineJournalForm'
import JournalLineRow from '@/components/journals/JournalLineRow'
import DateInput from '@/components/journals/DateInput'
import { ValidationError } from '@/lib/errors'

type ElementProps = {
  children?: ReactNode
  placeholder?: string
  value?: unknown
  ref?: { current: unknown }
  onChange?: (event: { target: { value: string } }) => void
  onClick?: () => Promise<void>
  onKeyDown?: (event: unknown) => void
  onBlur?: (event: unknown) => void
  onFocus?: () => void
  type?: string
  className?: string
}

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  return Children.toArray(node).flatMap(child => isValidElement<ElementProps>(child)
    ? [child, ...elements(child.props.children)] : [])
}

function mount(render: () => ReactNode) {
  const rerender = () => { hooks.begin(); return render() }
  rerender()
  hooks.flush()
  return rerender
}

function find(node: ReactNode, placeholder: string) {
  const element = elements(node).find(item => item.props.placeholder === placeholder)
  if (!element) throw new Error(`入力欄がありません: ${placeholder}`)
  return element
}

function submit(node: ReactNode) {
  const button = elements(node).find(item => item.props.onClick && ['保存', '確定保存', '複製して保存'].includes(String(item.props.children)))
  if (!button?.props.onClick) throw new Error('保存ボタンがありません')
  return button.props.onClick()
}

const source: JournalEntryWithLines = {
  id: 'original', date: '2026-04-10', description: '元の摘要', supplement: '補足', reference_number: 7, is_opening_balance: false,
  journal_lines: [
    { id: 'd', line_number: 1, side: 'DEBIT', account_id: 'cash', amount: 100, tax_code: null, description: null, accounts: null },
    { id: 'c', line_number: 2, side: 'CREDIT', account_id: 'sales', amount: 100, tax_code: null, description: null, accounts: null },
  ],
}

function formProps(overrides: Partial<ComponentProps<typeof JournalForm>> = {}): ComponentProps<typeof JournalForm> {
  return { accounts: [], editTarget: null, duplicateSource: source, onNewAdd: vi.fn(), onNewCommit: vi.fn(), onNewRollback: vi.fn(), onEditSave: vi.fn(), onCancel: vi.fn(), onDuplicateSubmitted: vi.fn(), ...overrides }
}

beforeEach(() => {
  hooks.reset()
  vi.clearAllMocks()
  saved.create.mockResolvedValue({ id: 'created', referenceNumber: 42 })
  saved.update.mockResolvedValue(undefined)
})

describe('複合仕訳フォームの伝票番号', () => {
  it('通常の新規フォームでも不正番号を拒否して明細・摘要を保持する', async () => {
    const props = formProps({ duplicateSource: null })
    const render = mount(() => JournalForm(props))
    find(render(), '摘要を入力（Enterで保存）').props.onChange?.({ target: { value: '新規の摘要' } })
    for (const element of elements(render())) {
      if (element.type === DateInput && isValidElement<ComponentProps<typeof DateInput>>(element)) element.props.onChange('2026-04-10')
      if (element.type === JournalLineRow && isValidElement<ComponentProps<typeof JournalLineRow>>(element)) {
        element.props.onChange(element.props.index, 'account_id', element.props.index ? 'sales' : 'cash')
        element.props.onChange(element.props.index, 'amount', '100')
      }
    }
    find(render(), '空欄で自動採番').props.onChange?.({ target: { value: '1.5' } })
    await submit(render())
    expect(props.onNewAdd).not.toHaveBeenCalled()
    expect(saved.create).not.toHaveBeenCalled()
    expect(find(render(), '摘要を入力（Enterで保存）').props.value).toBe('新規の摘要')
    expect(elements(render()).some(item => String(item.props.children).includes('伝票番号は'))).toBe(true)
    for (const element of elements(render())) {
      if (element.type === JournalLineRow && isValidElement<ComponentProps<typeof JournalLineRow>>(element)) expect(element.props.line.amount).toBe('100')
    }
    // 修正後は仮行追加・フォームリセットを経て確定番号になる。
    find(render(), '空欄で自動採番').props.onChange?.({ target: { value: '' } })
    await submit(render())
    expect(props.onNewAdd).toHaveBeenCalledOnce()
    expect(props.onNewCommit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ reference_number: 42 }))
    expect(find(render(), '摘要を入力（Enterで保存）').props.value).toBe('')
  })
  it('編集で空欄を送信しても、保存後の画面データは元の番号を保つ', async () => {
    const props = formProps({ editTarget: source, duplicateSource: null })
    const render = mount(() => JournalForm(props))
    expect(find(render(), '空欄で変更なし').props.value).toBe('7')
    expect(find(render(), '空欄で変更なし').props.type).toBe('text')
    find(render(), '空欄で変更なし').props.onChange?.({ target: { value: '' } })
    await submit(render())
    expect(saved.update).toHaveBeenCalledWith(expect.objectContaining({ referenceNumber: null }))
    expect(props.onEditSave).toHaveBeenCalledWith(expect.objectContaining({ reference_number: 7 }))
  })

  it.each(['0', '1e3', '１２a'])('新規の不正番号 %s は仮行追加・リセット・RPCより前に拒否する', async input => {
    const props = formProps()
    const render = mount(() => JournalForm(props))
    find(render(), '空欄で自動採番').props.onChange?.({ target: { value: input } })
    await submit(render())
    expect(props.onNewAdd).not.toHaveBeenCalled()
    expect(props.onDuplicateSubmitted).not.toHaveBeenCalled()
    expect(saved.create).not.toHaveBeenCalled()
    expect(find(render(), '空欄で自動採番').props.value).toBe(input)
    expect(find(render(), '摘要を入力（Enterで保存）').props.value).toBe('元の摘要')
    expect(elements(render()).some(item => item.props.className?.includes('text-red-500') && String(item.props.children).includes('伝票番号は'))).toBe(true)
  })

  it.each(['', '００８'])('複製は元番号を引き継がず、入力 %j にかかわらずDB確定番号でコミットする', async input => {
    const onDuplicateSubmitted = vi.fn()
    const props = formProps({ onDuplicateSubmitted })
    const render = mount(() => JournalForm(props))
    expect(find(render(), '空欄で自動採番').props.value).toBe('')
    find(render(), '空欄で自動採番').props.onChange?.({ target: { value: input } })
    await submit(render())
    expect(props.onNewAdd).toHaveBeenCalledWith(expect.objectContaining({ reference_number: null, referenceNumberPending: true }))
    expect(saved.create).toHaveBeenCalledWith(expect.objectContaining({ referenceNumber: input ? 8 : null, description: '元の摘要' }))
    expect(onDuplicateSubmitted).toHaveBeenCalledOnce()
    expect(props.onNewCommit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ id: 'created', reference_number: 42 }))
    const committed = vi.mocked(props.onNewCommit).mock.calls[0][1]
    expect(committed.referenceNumberPending).toBeUndefined()
  })

  it('DBの重複エラーでは仮行をロールバックしてtoastを表示する', async () => {
    vi.spyOn(console, 'error').mockImplementationOnce(() => {})
    saved.create.mockRejectedValueOnce(new ValidationError('DUPLICATE_REFERENCE_NUMBER', '番号が使用済みです'))
    const props = formProps()
    const render = mount(() => JournalForm(props))
    await submit(render())
    expect(props.onNewRollback).toHaveBeenCalledWith(vi.mocked(props.onNewAdd).mock.calls[0][0].id)
    expect(props.onNewCommit).not.toHaveBeenCalled()
    expect(saved.toast).toHaveBeenCalledWith('番号が使用済みです')
  })
})

describe('下部インライン入力の自動採番', () => {
  it('番号入力を追加せず、仮行とDB確定行を区別して保存する', async () => {
    const props: ComponentProps<typeof InlineJournalForm> = {
      accounts: [], allTaxCodes: [], taxMethod: 'EXEMPT', onNewAdd: vi.fn(), onNewCommit: vi.fn(), onNewRollback: vi.fn(),
      duplicateRequest: { seq: 1, draft: { date: source.date, description: source.description, supplement: '', lines: [
        { side: 'DEBIT', account_id: 'cash', sub_account_id: '', amount: '100', tax_code: '' },
        { side: 'CREDIT', account_id: 'sales', sub_account_id: '', amount: '100', tax_code: '' },
      ] } },
    }
    const render = mount(() => InlineJournalForm(props))
    expect(elements(render()).some(item => item.props.placeholder?.includes('自動採番'))).toBe(false)
    await submit(render())
    expect(saved.create).toHaveBeenCalledWith(expect.objectContaining({ referenceNumber: null }))
    expect(props.onNewAdd).toHaveBeenCalledWith(expect.objectContaining({ reference_number: null, referenceNumberPending: true }))
    expect(props.onNewCommit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ id: 'created', reference_number: 42, referenceNumberPending: false }))
    expect(props.onNewRollback).not.toHaveBeenCalled()
  })
})

describe('インライン編集の伝票番号', () => {
  function setup() {
    const props: ComponentProps<typeof InlineEditRow> = {
      entry: source, accounts: [], allTaxCodes: [], taxMethod: 'EXEMPT',
      onSave: vi.fn().mockResolvedValue(true), onCancel: vi.fn(), onNavigate: vi.fn(),
    }
    const render = mount(() => InlineEditRow(props))
    const input = () => {
      const element = elements(render()).find(item => item.props.value === '7' && item.props.type === 'text')
      if (!element) throw new Error('伝票番号入力がありません')
      return element
    }
    const focus = vi.fn()
    const numberInput = input()
    if (numberInput.props.ref) numberInput.props.ref.current = { focus }
    return { props, render, change: (value: string) => numberInput.props.onChange?.({ target: { value } }), focus }
  }

  it.each(['Tab', 'Enter', 'blur'])('不正番号では %s による保存・移動を止める', async action => {
    const { props, render, change, focus } = setup()
    change('1e3')
    const node = render()
    const preventDefault = vi.fn()
    if (action === 'blur') {
      elements(node).find(item => item.props.onBlur)?.props.onBlur?.({ relatedTarget: null })
    } else {
      elements(node)[0].props.onKeyDown?.({ key: action, nativeEvent: { isComposing: false }, preventDefault, stopPropagation: vi.fn() })
      expect(preventDefault).toHaveBeenCalled()
    }
    await Promise.resolve()
    expect(props.onSave).not.toHaveBeenCalled()
    expect(props.onNavigate).not.toHaveBeenCalled()
    expect(focus).toHaveBeenCalled()
    expect(elements(render()).some(item => String(item.props.children).includes('伝票番号は'))).toBe(true)
  })

  it.each([['', null, 7], ['００８', 8, 8]] as const)('入力 %j のRPC値と画面値を分ける', async (input, rpcValue, displayValue) => {
    const { props, render, change } = setup()
    change(input)
    elements(render())[0].props.onKeyDown?.({ key: 'Enter', nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn() })
    await vi.waitFor(() => expect(props.onNavigate).toHaveBeenCalled())
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ reference_number: displayValue }), rpcValue)
  })

  it('DB拒否は番号入力を保ち、共通エラー欄を表示して移動しない', async () => {
    const { props, render, change } = setup()
    vi.mocked(props.onSave).mockRejectedValueOnce(new ValidationError('DUPLICATE_REFERENCE_NUMBER', '番号が使用済みです'))
    change('８')
    elements(render())[0].props.onKeyDown?.({ key: 'Enter', nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn() })
    await vi.waitFor(() => expect(elements(render()).some(item => item.props.children === '番号が使用済みです')).toBe(true))
    expect(elements(render()).some(item => item.props.value === '８')).toBe(true)
    expect(props.onNavigate).not.toHaveBeenCalled()
    expect(source.reference_number).toBe(7)
  })
})
