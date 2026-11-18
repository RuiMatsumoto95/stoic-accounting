import { beforeEach, describe, expect, it, vi } from 'vitest'
import { companyDb } from './helpers/company-supabase'
import { chunkItems, readAllPages } from '@/lib/report-pagination'

let fixture: ReturnType<typeof companyDb>
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => fixture.client.from(table),
  rpc: async () => ({ data: [], error: null }),
} }))
import { fetchPLMovements, getPLData } from '@/lib/financial-statements'

beforeEach(() => { fixture = companyDb({}) })

describe('D: 取得の塊・ページ分割', () => {
  it('塊の境界・空配列・不正なサイズを扱う', () => {
    expect(chunkItems([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunkItems([], 100)).toEqual([])
    expect(() => chunkItems([], 0)).toThrow()
  })
  it('1000行ちょうどでも次ページを調べ、全行を返す', async () => {
    const rows = Array.from({ length: 2000 }, (_, index) => index)
    const read = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }))
    expect(await readAllPages(read)).toEqual(rows)
    expect(read.mock.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })
  it('空・null・途中の失敗を切り捨て結果と区別する', async () => {
    expect(await readAllPages(async () => ({ data: null, error: null }))).toEqual([])
    const failure = new Error('second page failed')
    await expect(readAllPages(async from => from === 0 ? { data: [1, 2], error: null } : { data: null, error: failure }, 2)).rejects.toBe(failure)
    await expect(readAllPages(async () => ({ data: [], error: null }), -1)).rejects.toThrow()
  })
  it('105仕訳を100件ずつ問い合わせ、同一塊内の1000行超と次の塊も集計する', async () => {
    fixture = companyDb({
      journal_entries: Array.from({ length: 105 }, (_, index) => ({ id: `e${String(index).padStart(4, '0')}`, period_id: 'p' })),
      journal_lines: [
        ...Array.from({ length: 1001 }, (_, index) => ({ id: `a${index}`, entry_id: 'e0000', account_id: 'bank', side: 'DEBIT', amount: 1 })),
        ...Array.from({ length: 104 }, (_, index) => ({ id: `b${index}`, entry_id: `e${String(index + 1).padStart(4, '0')}`, account_id: 'sales', side: 'CREDIT', amount: 2 })),
      ],
    })
    expect(await fetchPLMovements('p')).toEqual(expect.arrayContaining([
      { account_id: 'bank', total_debit: 1001, total_credit: 0 },
      { account_id: 'sales', total_debit: 0, total_credit: 208 },
    ]))
    const calls = fixture.calls.filter(call => call.table === 'journal_lines')
    expect(calls.map(call => (call.filters.find(([column]) => column === 'entry_id')![2] as string[]).length)).toEqual([100, 100, 5])
  })
  it('仕訳ID自体が1000件を超えても、別会社の仕訳を含めず全明細を集計する', async () => {
    fixture = companyDb({
      fiscal_periods: [{ id: 'p', company_id: 'a' }],
      accounts: [{ id: 'sales', company_id: 'a', code: '400', name: '売上', type: 'REVENUE', parent_id: null, pl_category: 'REVENUE', bs_category: null }],
      journal_entries: [...Array.from({ length: 1005 }, (_, index) => ({ id: `e${index}`, period_id: 'p' })), { id: 'other', period_id: 'other-period' }],
      journal_lines: [...Array.from({ length: 1005 }, (_, index) => ({ id: `line${index}`, entry_id: `e${index}`, account_id: 'sales', side: 'CREDIT', amount: 1 })), { id: 'other-line', entry_id: 'other', account_id: 'sales', side: 'CREDIT', amount: 99999 }],
    })
    expect((await getPLData('p', null)).revenueTotal).toBe(1005)
    expect(fixture.calls.filter(call => call.table === 'journal_entries')).toHaveLength(2)
  })
  it('仕訳が空なら明細を問い合わせず、取得エラーは伝播する', async () => {
    expect(await fetchPLMovements('empty')).toEqual([])
    expect(fixture.calls.some(call => call.table === 'journal_lines')).toBe(false)
    fixture.failWith(call => call.table === 'journal_entries' ? 'entry fetch failed' : undefined)
    await expect(fetchPLMovements('p')).rejects.toMatchObject({ message: 'entry fetch failed' })
  })
})
