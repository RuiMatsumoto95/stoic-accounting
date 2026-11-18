import { beforeEach, describe, expect, it, vi } from 'vitest'
import { companyDb } from './helpers/company-supabase'

let fixture: ReturnType<typeof companyDb>
let cookieId: string | undefined
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => fixture.client.from(table) } }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (table: string) => fixture.client.from(table) }) }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => cookieId ? { value: cookieId } : undefined }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getAllPeriods, getCurrentPeriod } from '@/lib/fiscal-period'
import { getPreviousPeriod } from '@/lib/balance-calculator'
import { createPeriod, deletePeriod, setCurrentPeriod, updatePeriod } from '@/actions/fiscal-period-actions'
import { isIndividualFiscalPeriod } from '@/lib/company-period'

beforeEach(() => {
  cookieId = 'a'
  fixture = companyDb({
    companies: [{ id: 'a', kind: 'CORPORATION' }, { id: 'b', kind: 'CORPORATION' }, { id: 'c', kind: 'INDIVIDUAL' }],
    fiscal_periods: [
      { id: 'a-old', company_id: 'a', start_date: '2024-01-01', end_date: '2024-12-31', is_current: false },
      { id: 'a-current', company_id: 'a', start_date: '2025-01-01', end_date: '2025-12-31', is_current: true },
      { id: 'a-next', company_id: 'a', start_date: '2026-01-01', end_date: '2026-12-31', is_current: false },
      { id: 'b-current', company_id: 'b', start_date: '2025-07-01', end_date: '2026-06-30', is_current: true },
      { id: 'b-future', company_id: 'b', start_date: '2030-01-01', end_date: '2030-12-31', is_current: false },
    ], journal_entries: [{ id: 'b-entry', company_id: 'b', period_id: 'b-current' }],
  })
})
const input = { name: '次の期', start_date: '2027-01-01', end_date: '2027-12-31' }

describe('期の読み取り', () => {
  it('2社それぞれの当期を取得し、一覧にも他社を含めない', async () => {
    expect((await getCurrentPeriod('a')).id).toBe('a-current')
    expect((await getCurrentPeriod('b')).id).toBe('b-current')
    expect((await getAllPeriods('a')).map(period => period.id)).toEqual(['a-next', 'a-current', 'a-old'])
  })
  it('前期を同じ会社の内側で探す', async () => {
    expect((await getPreviousPeriod('a-next'))?.id).toBe('a-current')
    expect(await getPreviousPeriod('a-old')).toBeNull()
  })
})

describe('当期切替', () => {
  it('他社の当期を解除しない', async () => {
    expect(await setCurrentPeriod('a', 'a-next')).toEqual({})
    expect(fixture.tables.fiscal_periods.filter(row => row.is_current).map(row => row.id)).toEqual(['a-next', 'b-current'])
  })
  it('他社の期への切替を解除前に拒否する', async () => {
    expect((await setCurrentPeriod('a', 'b-current')).error).toBeTruthy()
    expect(fixture.calls.filter(call => call.operation === 'update')).toEqual([])
  })
  it('1回目の更新の失敗を検出し、2回目は実行しない', async () => {
    fixture.failWith(call => call.operation === 'update' && call.values && !Array.isArray(call.values) && call.values.is_current === false ? '解除失敗' : undefined)
    expect((await setCurrentPeriod('a', 'a-next')).error).toBe('解除失敗')
    expect(fixture.tables.fiscal_periods.find(row => row.id === 'a-current')?.is_current).toBe(true)
    expect(fixture.calls.filter(call => call.operation === 'update')).toHaveLength(1)
  })
  it('2回目の更新が失敗したら元の当期へ戻し、失敗を返す', async () => {
    fixture.failWith(call => call.operation === 'update' && call.filters.some(([column, , value]) => column === 'id' && value === 'a-next') ? '切替失敗' : undefined)
    expect((await setCurrentPeriod('a', 'a-next')).error).toBe('切替失敗')
    expect(fixture.tables.fiscal_periods.filter(row => row.is_current).map(row => row.id)).toEqual(['a-current', 'b-current'])
  })
  it('復元自体の失敗も隠さない', async () => {
    fixture.failWith(call => call.operation === 'update' && call.values && !Array.isArray(call.values) && call.values.is_current === true ? '更新失敗' : undefined)
    expect((await setCurrentPeriod('a', 'a-next')).error).toContain('元の当期の復元にも失敗しました')
  })
  it('切替先が途中で消えて更新0件になった場合も元の当期を復元する', async () => {
    fixture.failWith(call => {
      if (call.operation === 'update' && call.filters.some(([column, , value]) => column === 'id' && value === 'a-next')) {
        fixture.tables.fiscal_periods = fixture.tables.fiscal_periods.filter(row => row.id !== 'a-next')
      }
      return undefined
    })
    expect((await setCurrentPeriod('a', 'a-next')).error).toBe('切替先の期間が見つかりません')
    expect(fixture.tables.fiscal_periods.filter(row => row.is_current).map(row => row.id)).toEqual(['a-current', 'b-current'])
  })
})

describe('作成・更新・削除', () => {
  it('前期の翌日を自社で判定し、company_id を付ける', async () => {
    expect(await createPeriod('a', input)).toEqual({})
    expect(fixture.tables.fiscal_periods.at(-1)).toMatchObject({ ...input, company_id: 'a', is_current: false })
  })
  it('不連続の作成を拒否する', async () => {
    expect((await createPeriod('a', { ...input, start_date: '2028-01-01' })).error).toContain('2027-01-01')
  })
  it('他社の次期は終了日変更を妨げない。自社の次期は判定する', async () => {
    expect(await updatePeriod('a', 'a-next', { ...input, end_date: '2027-03-31' })).toEqual({})
    expect((await updatePeriod('a', 'a-current', { ...input, end_date: '2026-03-31' })).error).toContain('次の期間')
    expect((await updatePeriod('a', 'b-current', input)).error).toBeTruthy()
  })
  it('他社の未来の期があっても自社の最新期を削除できる', async () => {
    expect(await deletePeriod('a', 'a-next')).toEqual({})
    expect(fixture.tables.fiscal_periods.find(row => row.id === 'b-future')).toBeDefined()
  })
  it('他社・最新でない期・当期・仕訳のある期を削除しない', async () => {
    expect((await deletePeriod('a', 'b-future')).error).toBeTruthy()
    expect((await deletePeriod('a', 'a-old')).error).toBeTruthy()
    fixture.tables.fiscal_periods = fixture.tables.fiscal_periods.filter(row => row.id !== 'a-next')
    expect((await deletePeriod('a', 'a-current')).error).toContain('現在')
    fixture.tables.fiscal_periods.find(row => row.id === 'a-current')!.is_current = false
    fixture.tables.journal_entries.push({ id: 'a-entry', company_id: 'a', period_id: 'a-current' })
    expect((await deletePeriod('a', 'a-current')).error).toContain('仕訳')
  })
  it('照会失敗を空の期一覧として扱って保存しない', async () => {
    fixture.failWith(call => call.operation === 'read' ? '読取失敗' : undefined)
    expect((await createPeriod('a', input)).error).toBe('読取失敗')
    expect((await updatePeriod('a', 'a-current', input)).error).toBe('読取失敗')
    expect((await deletePeriod('a', 'a-next')).error).toBe('読取失敗')
    expect(fixture.calls.some(call => call.operation !== 'read')).toBe(false)
  })
})

describe('Server Actions の cookie 照合', () => {
  it.each(['b', undefined])('cookie=%s の旧画面から全操作を拒否する', async value => {
    cookieId = value
    for (const result of await Promise.all([setCurrentPeriod('a', 'a-next'), createPeriod('a', input), updatePeriod('a', 'a-next', input), deletePeriod('a', 'a-next')])) {
      expect(result).toMatchObject({ code: 'STALE_COMPANY' })
    }
    expect(fixture.calls).toEqual([])
  })
})

describe('個人の期', () => {
  beforeEach(() => {
    cookieId = 'c'
    fixture.tables.fiscal_periods.push(
      { id: 'c-current', company_id: 'c', start_date: '2025-01-01', end_date: '2025-12-31', is_current: true },
      { id: 'c-next', company_id: 'c', start_date: '2026-01-01', end_date: '2026-12-31', is_current: false },
    )
  })
  it.each([
    ['2026-01-01', '2026-12-31', true], ['2024-01-01', '2024-12-31', true],
    ['2026-04-01', '2027-03-31', false], ['2026-01-01', '2027-12-31', false],
    ['2026-01-01', '2026-12-30', false], ['2026-1-1', '2026-12-31', false],
    ['0000-01-01', '0000-12-31', false], ['', '', false],
  ])('純粋関数 %s〜%s', (start, end, valid) => {
    expect(isIndividualFiscalPeriod(start, end)).toBe(valid)
  })
  it('作成・終了日変更の両方で個人の1年を検証する', async () => {
    expect((await createPeriod('c', { ...input, end_date: '2028-03-31' })).error).toContain('1月1日')
    expect(await createPeriod('c', input)).toEqual({})
    expect(fixture.tables.fiscal_periods.at(-1)).toMatchObject({ ...input, company_id: 'c' })
    // 入力の開始日を偽っても、DBの開始日（2027-01-01）で検証する。
    expect((await updatePeriod('c', 'created-0', { ...input, start_date: '2028-01-01', end_date: '2028-12-31' })).error).toContain('1月1日')
    expect(await updatePeriod('c', 'created-0', input)).toEqual({})
  })
  it('個人の当期切替・削除はその会社だけに作用する', async () => {
    const others = structuredClone(fixture.tables.fiscal_periods.filter(row => row.company_id !== 'c'))
    expect(await setCurrentPeriod('c', 'c-next')).toEqual({})
    expect((await deletePeriod('c', 'c-next')).error).toContain('現在')
    expect(await setCurrentPeriod('c', 'c-current')).toEqual({})
    expect(await deletePeriod('c', 'c-next')).toEqual({})
    expect(fixture.tables.fiscal_periods.filter(row => row.company_id !== 'c')).toEqual(others)
  })
  it('個人でも当期切替失敗を検出して元へ復元する', async () => {
    fixture.failWith(call => call.operation === 'update' && call.filters.some(([column, , value]) => column === 'id' && value === 'c-next') ? '切替失敗' : undefined)
    expect((await setCurrentPeriod('c', 'c-next')).error).toBe('切替失敗')
    expect(fixture.tables.fiscal_periods.find(row => row.id === 'c-current')?.is_current).toBe(true)
  })
  it('個人の期の作成・削除のDB失敗を隠さない', async () => {
    fixture.failWith(call => call.operation === 'insert' || call.operation === 'delete' ? '保存失敗' : undefined)
    expect((await createPeriod('c', input)).error).toBe('保存失敗')
    expect((await deletePeriod('c', 'c-next')).error).toBe('保存失敗')
    expect(fixture.tables.fiscal_periods.find(row => row.id === 'c-next')).toBeDefined()
    expect(fixture.tables.fiscal_periods.some(row => row.start_date === input.start_date)).toBe(false)
  })
})
