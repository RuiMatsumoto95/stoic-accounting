import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }))

import { supabase } from '@/lib/supabase'
import { readJournalEntries } from '@/lib/journal-fetch'
import { applyJournalFetch } from '@/lib/journal-order'
import type { JournalEntryWithLines } from '@/components/journals/JournalForm'

const params = { dateFrom: '', dateTo: '', amountMin: '', amountMax: '', keyword: '', accountId: '' }
const from = vi.mocked(supabase.from)
let entriesError: { message: string } | null
let linesError: { message: string } | null
let matchedLines: { entry_id: string }[]
const orders: [string, unknown][] = []

beforeEach(() => {
  entriesError = null
  linesError = null
  matchedLines = []
  orders.length = 0
  from.mockReset()
  from.mockImplementation(table => {
    const result = { data: table === 'journal_lines' ? matchedLines : [], error: table === 'journal_lines' ? linesError : entriesError }
    const query = {
      select: () => query, eq: () => query, gte: () => query, lte: () => query,
      ilike: () => query, in: () => query,
      order: (column: string, options: unknown) => { orders.push([column, options]); return query },
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    }
    return query as unknown as ReturnType<typeof supabase.from>
  })
})

describe('readJournalEntries', () => {
  it('日付→伝票番号（NULLは最後）→作成日時→IDで取得する', async () => {
    await readJournalEntries('period', params, [])
    expect(orders).toEqual([
      ['date', { ascending: true }],
      ['reference_number', { ascending: true, nullsFirst: false }],
      ['created_at', { ascending: true }],
      ['id', { ascending: true }],
    ])
  })

  it('正常な0件と取得失敗を区別する', async () => {
    expect(await readJournalEntries('period', params, [])).toEqual({ ok: true, entries: [] })
    entriesError = { message: '取得失敗' }
    expect(await readJournalEntries('period', params, [])).toEqual({ ok: false, error: entriesError })
  })

  it('金額・科目検索の明細取得エラーを0件にしない', async () => {
    linesError = { message: '明細取得失敗' }
    const result = await readJournalEntries('period', { ...params, amountMin: '100' }, [])
    expect(result).toEqual({ ok: false, error: linesError })
    expect(orders).toEqual([])
    const current = [{ id: 'visible' }] as JournalEntryWithLines[]
    expect(applyJournalFetch(current, result, { seq: 1, latestSeq: 1, keepIds: new Set(), keepOrder: false })).toBe(current)
  })

  it('明細が正常に0件の場合だけ成功の0件を返す', async () => {
    expect(await readJournalEntries('period', { ...params, accountId: 'account' }, [])).toEqual({ ok: true, entries: [] })
    expect(orders).toEqual([])
  })

  it('通信の例外も失敗として返す', async () => {
    const error = new Error('通信失敗')
    from.mockImplementation(() => { throw error })
    expect(await readJournalEntries('period', params, [])).toEqual({ ok: false, error })
  })
})
