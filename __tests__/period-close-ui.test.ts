import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import type { FiscalPeriod } from '@/lib/fiscal-period'
import type { JournalEntryWithLines } from '@/components/journals/JournalForm'

// 実際のハンドラーとJSXを検証する。DOM・ブラウザ・IMEの実機確認を代替しない。
const hooks = vi.hoisted(() => {
  let slots: unknown[] = [], cursor = 0, mounted = false, effects: (() => unknown)[] = []
  return {
    reset() { slots = []; cursor = 0; mounted = false; effects = [] },
    begin() { cursor = 0 },
    flush() { mounted = true; const pending = effects; effects = []; pending.forEach(fn => fn()) },
    useState<T>(initial: T | (() => T)) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial
      return [slots[index] as T, (next: T | ((current: T) => T)) => { slots[index] = typeof next === 'function' ? (next as (current: T) => T)(slots[index] as T) : next }] as const
    },
    useRef<T>(initial: T) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index] as { current: T } },
    useEffect(fn: () => unknown) { if (!mounted) effects.push(fn) },
  }
})
const mocks = vi.hoisted(() => ({ check: vi.fn(), close: vi.fn(), reopen: vi.fn(), all: vi.fn(), from: vi.fn(), refresh: vi.fn(), error: vi.fn(), success: vi.fn(), period: { id: 'p', name: '2025年', start_date: '2025-01-01', end_date: '2025-12-31', is_current: true, closed_at: null as string | null } }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: hooks.useState, useRef: hooks.useRef,
  useEffect: hooks.useEffect, useCallback: <T,>(fn: T) => fn, useTransition: () => [false, (fn: () => unknown) => fn()] }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }))
vi.mock('@/lib/company-guard', () => ({ assertActiveCompany: vi.fn() }))
vi.mock('@/contexts/CompanyContext', () => ({ useCompany: () => ({ id: 'a' }) }))
vi.mock('@/contexts/FiscalPeriodContext', () => ({ useCurrentPeriod: () => ({ period: mocks.period, refresh: mocks.refresh }) }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ error: mocks.error, success: mocks.success }) }))
vi.mock('@/lib/fiscal-period', () => ({ getAllPeriods: mocks.all }))
vi.mock('@/lib/fiscal-period-operations', () => ({ getPeriodCloseCheck: mocks.check, closeFiscalPeriod: mocks.close, reopenFiscalPeriod: mocks.reopen }))
vi.mock('@/actions/fiscal-period-actions', () => ({ deletePeriod: vi.fn(), setCurrentPeriod: vi.fn() }))
vi.mock('@/components/journals/JournalList', () => ({ default: () => null }))
vi.mock('@/components/journals/JournalForm', () => ({ default: () => null }))
vi.mock('@/components/journals/InlineJournalForm', () => ({ default: () => null }))
vi.mock('@/components/settings/FiscalPeriodModal', () => ({ default: () => null }))

import FiscalPeriodSettings from '@/components/settings/FiscalPeriodSettings'
import JournalsPage from '@/app/journals/page'
import JournalList from '@/components/journals/JournalList'
import CsvImportPage from '@/app/csv-import/page'
import OpeningBalancesPage from '@/app/opening-balances/page'
import PeriodClosedNotice from '@/components/PeriodClosedNotice'
import { ERROR_CODES } from '@/lib/errors'

type Props = { children?: ReactNode; onClick?: () => unknown; onChange?: (event: { target: { value: string } }) => void; disabled?: boolean; role?: string; value?: string }
function elements(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap(child => isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : [])
}
function label(node: ReactNode): string { return Children.toArray(node).map(child => isValidElement<Props>(child) ? label(child.props.children) : String(child)).join('') }
function button(node: ReactNode, text: string) {
  const found = elements(node).find(e => e.props.onClick && label(e.props.children) === text)
  if (!found) throw new Error(`ボタンなし: ${text}`)
  return found
}
function renderWithHooks(render: () => ReactNode) { return () => { hooks.begin(); return render() } }
const period = (closed = false): FiscalPeriod => ({ ...mocks.period, closed_at: closed ? '2026-11-15T00:00:00Z' : null })
const entry = { id: 'e', is_opening_balance: false } as JournalEntryWithLines

beforeEach(() => {
  hooks.reset(); vi.clearAllMocks(); mocks.period.closed_at = null
  mocks.all.mockResolvedValue([period()])
  mocks.check.mockResolvedValue({ closed: false, errors: [], warnings: [] })
  mocks.close.mockResolvedValue({ period_id: 'p', closed_at: '2026-11-15T00:00:00Z', warnings: [] })
  mocks.reopen.mockResolvedValue({ period_id: 'p', closed_at: null })
})

describe('設定画面の確定・解除', () => {
  it('チェックのerrorsを表示し、確定RPCを呼ばない', async () => {
    mocks.check.mockResolvedValue({ closed: false, errors: ['E5: 期間が重なっています'], warnings: [] })
    const render = renderWithHooks(() => FiscalPeriodSettings({ initialPeriods: [period()] }))
    await button(render(), '確定').props.onClick!()
    expect(label(render())).toContain('E5: 期間が重なっています')
    expect(button(render(), 'この期を確定する').props.disabled).toBe(true)
    await button(render(), 'この期を確定する').props.onClick!()
    expect(mocks.close).not.toHaveBeenCalled()
  })
  it('warningsを表示して確認を待ち、任意メモを1期の確定RPCへ送る', async () => {
    mocks.check.mockResolvedValue({ closed: false, errors: [], warnings: ['W1: 未処理の取込があります', 'W3: 仕訳がありません'] })
    const render = renderWithHooks(() => FiscalPeriodSettings({ initialPeriods: [period()] }))
    await button(render(), '確定').props.onClick!()
    expect(mocks.check).toHaveBeenCalledWith(expect.anything(), 'a', 'p')
    expect(label(render())).toContain('W1: 未処理の取込があります')
    expect(label(render())).toContain('W3: 仕訳がありません')
    expect(mocks.close).not.toHaveBeenCalled()
    elements(render()).find(e => e.props.onChange && e.props.value === '')!.props.onChange!({ target: { value: '任意のメモ' } })
    await button(render(), 'この期を確定する').props.onClick!()
    expect(mocks.close).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'a', 'p', '任意のメモ')
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
  })
  it('チェック後にDBで拒否されても改行付きの理由を表示する', async () => {
    mocks.close.mockRejectedValue(new Error('確定できません\nE5: 重なっています'))
    const render = renderWithHooks(() => FiscalPeriodSettings({ initialPeriods: [period()] }))
    await button(render(), '確定').props.onClick!()
    await button(render(), 'この期を確定する').props.onClick!()
    expect(elements(render()).some(e => e.props.role === 'alert' && label(e).includes('E5: 重なっています'))).toBe(true)
  })
  it('確定済みバッジと解除の注意を表示し、確認してから1期を解除する', async () => {
    const render = renderWithHooks(() => FiscalPeriodSettings({ initialPeriods: [period(true)] }))
    expect(label(render())).toContain('確定済み')
    await button(render(), '解除').props.onClick!()
    expect(label(render())).toContain('この期以降の数字が動かせるようになります')
    expect(mocks.reopen).not.toHaveBeenCalled()
    await button(render(), 'この期の確定を解除する').props.onClick!()
    expect(mocks.reopen).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'a', 'p', '')
  })
})

describe('一覧の実際の削除ハンドラー', () => {
  function mountPage() {
    const outer = JournalsPage()
    const content = outer.props.children as ReactElement
    return renderWithHooks(() => (content.type as () => ReactNode)())
  }
  it.each(['single', 'bulk'])('%s削除のPERIOD_CLOSEDを日本語とDETAILで表示する', async mode => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = { data: null, error: { code: 'P0001', message: 'PERIOD_CLOSED', details: '期2025は確定済みです', hint: '' } }
    const query = { delete: () => query, eq: () => query, in: () => query, then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve) }
    mocks.from.mockReturnValue(query)
    const render = mountPage()
    const list = elements(render()).find(e => e.type === JournalList) as ReactElement<{ onDelete: (entry: JournalEntryWithLines) => void; onToggleSelect: (id: string) => void }>
    if (mode === 'single') list.props.onDelete(entry)
    else list.props.onToggleSelect('e')
    const buttons = elements(render()).filter(e => label(e.props.children) === '削除する')
    await buttons[mode === 'single' ? 0 : 1].props.onClick!()
    expect(mocks.error).toHaveBeenCalledWith(`${ERROR_CODES.PERIOD_CLOSED.message}（期2025は確定済みです）`)
    expect(mocks.error).not.toHaveBeenCalledWith('削除に失敗しました')
    vi.restoreAllMocks()
  })
  it('確定済みの一覧は編集不可として渡し、削除を送信しない', () => {
    mocks.period.closed_at = '2026-11-15T00:00:00Z'
    const render = mountPage()
    const list = elements(render()).find(e => e.type === JournalList) as ReactElement<{ readOnly: boolean; onDelete: (entry: JournalEntryWithLines) => void }>
    expect(list.props.readOnly).toBe(true)
    list.props.onDelete(entry)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith(ERROR_CODES.PERIOD_CLOSED.message)
  })
})

describe('確定済みの常時表示と入力の案内', () => {
  it('未確定・未取得なら何も表示せず、確定済みなら案内を表示する', () => {
    expect(PeriodClosedNotice({ period: period() })).toBeNull()
    expect(PeriodClosedNotice({ period: null })).toBeNull()
    expect(label(PeriodClosedNotice({ period: period(true) }))).toContain('この期は確定済みです（変更できません）')
  })
  it('CSV取込の上部に当期を渡し、アップロードと確認欄を無効にする', () => {
    mocks.period.closed_at = '2026-11-15T00:00:00Z'
    const render = renderWithHooks(CsvImportPage), node = render()
    expect(elements(node).some(e => e.type === PeriodClosedNotice)).toBe(true)
    expect(elements(node).filter(e => e.type === 'fieldset').map(e => e.props.disabled)).toEqual([true, true])
  })
  it('期首残高は画面で選んだ期の状態を表示し、当期と混同しない', async () => {
    mocks.all.mockResolvedValue([{ ...period(), id: 'selected', closed_at: '2026-11-15T00:00:00Z' }])
    const render = renderWithHooks(OpeningBalancesPage)
    render(); hooks.flush(); await Promise.resolve(); await Promise.resolve()
    const notice = elements(render()).find(e => e.type === PeriodClosedNotice) as ReactElement<{ period: FiscalPeriod }>
    expect(notice.props.period.id).toBe('selected')
    expect(notice.props.period.closed_at).not.toBeNull()
  })
})
