import { describe, expect, it } from 'vitest'
import type { JournalEntryWithLines } from '@/components/journals/JournalForm'
import { expandEntry, getJournalWindow, resolveTopEntryIndex, slideJournalWindow, jumpJournalWindow, fragmentPageRows, findPrevFirstRow, findNextFirstRow, pickFocusRow, restoreJournalViewport } from '@/lib/journal-paging'

function entry(id: string, debitCount = 1, creditCount = 1): JournalEntryWithLines {
  const lines = (side: 'DEBIT' | 'CREDIT', count: number, offset: number) => Array.from({ length: count }, (_, i) => ({
    id: `${id}-${side}-${i + 1}`,
    line_number: offset + i + 1,
    side,
    account_id: `${side}-account`,
    amount: side === 'DEBIT' ? 100 * creditCount : 100 * debitCount,
    tax_code: 'OUT_OF_SCOPE',
    description: null,
    accounts: { id: `${side}-account`, name: `テスト${side}`, parent_id: null },
  }))
  return {
    id,
    date: '2026-04-01',
    description: `テスト仕訳 ${id}`,
    reference_number: 7,
    supplement: null,
    is_opening_balance: false,
    journal_lines: [...lines('DEBIT', debitCount, 0), ...lines('CREDIT', creditCount, debitCount)],
  }
}

describe('F5後の画面上の位置', () => {
  const entries = [entry('a', 3, 1), entry('b'), entry('c', 2, 1)]
  const rows = entries.flatMap(expandEntry)

  it('同じ行が仕訳の1行目ならその行を選ぶ', () => {
    expect(pickFocusRow(rows, 3)?.entry.id).toBe('b')
  })

  it('継続行なら最も近い1行目を選ぶ', () => {
    expect(pickFocusRow(rows, 1)?.entry.id).toBe('a')
    expect(pickFocusRow(rows, 2)?.entry.id).toBe('b')
  })

  it('同距離なら同じ位置以前の1行目を優先する', () => {
    const tied = [entry('before', 2, 1), entry('after')].flatMap(expandEntry)
    expect(pickFocusRow(tied, 1)?.entry.id).toBe('before')
  })

  it('範囲を超えたら最後の仕訳の1行目、空ならnull', () => {
    expect(pickFocusRow(rows, 99)?.entry.id).toBe('c')
    expect(pickFocusRow(rows, 99)?.isFirstRow).toBe(true)
    expect(pickFocusRow([], 0)).toBeNull()
  })

  it('仕訳IDではなく先頭indexと窓内の表示行・列を保つ', () => {
    const before = Array.from({ length: 30 }, (_, i) => entry(String(i)))
    const after = [...before].reverse()
    const restored = restoreJournalViewport(after, { topIndex: 12, cell: { rowOffset: 2, colIndex: 4 } })
    expect(restored).toEqual({ topEntryId: '17', focusCell: { entryId: '15', colIndex: 4 } })
  })

  it('件数が減ったら窓を丸め、最後の仕訳へ同じ列で戻す', () => {
    expect(restoreJournalViewport(entries, { topIndex: 99, cell: { rowOffset: 10, colIndex: 4 } })).toEqual({
      topEntryId: 'a', focusCell: { entryId: 'c', colIndex: 4 },
    })
  })

  it('入力フォームなど一覧セル以外のフォーカスには触れない', () => {
    expect(restoreJournalViewport(entries, { topIndex: 0, cell: null })).toEqual({ topEntryId: 'a', focusCell: null })
    expect(restoreJournalViewport([], { topIndex: 20, cell: { rowOffset: 3, colIndex: 4 } })).toEqual({ topEntryId: null, focusCell: null })
  })

  it('F5後の追加は再び最後の窓に入る', () => {
    const current = Array.from({ length: 20 }, (_, i) => entry(String(i)))
    const added = [...current, entry('new', 2, 1)]
    const last = jumpJournalWindow(added, 0, 'last')
    const window = getJournalWindow(added, last)
    expect(window.entries.at(-1)?.id).toBe('new')
    expect(window.rows.at(-1)?.entry.id).toBe('new')
  })
})

describe('expandEntry', () => {
  it('通常の仕訳は借方・貸方を組にした1表示行になる', () => {
    const source = entry('normal')
    expect(expandEntry(source)).toEqual([{
      isFirstRow: true, rowIndex: 0, entry: source,
      debitLine: source.journal_lines[0], creditLine: source.journal_lines[1],
    }])
  })

  it('複合仕訳は借貸の多い側の行数となり、不足する側はnullになる', () => {
    const source = entry('compound', 1, 3)
    const rows = expandEntry(source)
    expect(rows.map(row => [row.rowIndex, row.isFirstRow, row.debitLine?.id ?? null, row.creditLine?.id])).toEqual([
      [0, true, 'compound-DEBIT-1', 'compound-CREDIT-1'],
      [1, false, null, 'compound-CREDIT-2'],
      [2, false, null, 'compound-CREDIT-3'],
    ])
  })

  it('借貸をそれぞれ明細番号で並べ、入力配列は変更しない', () => {
    const source = entry('unsorted', 3, 2)
    source.journal_lines.reverse()
    const original = [...source.journal_lines]
    expect(expandEntry(source).map(row => [row.debitLine?.line_number, row.creditLine?.line_number ?? null])).toEqual([
      [1, 4], [2, 5], [3, null],
    ])
    expect(source.journal_lines).toEqual(original)
  })

  it('明細なしの期首残高仕訳も従来どおり1表示行を保つ', () => {
    const source = { ...entry('opening', 0, 0), is_opening_balance: true }
    expect(expandEntry(source)).toEqual([{
      isFirstRow: true, rowIndex: 0, entry: source, debitLine: null, creditLine: null,
    }])
  })

  it('明細のある期首残高仕訳も同じ規則で展開する', () => {
    const source = { ...entry('opening-lines', 2, 1), is_opening_balance: true }
    const rows = expandEntry(source)
    expect(rows).toHaveLength(2)
    expect(rows.every(row => row.entry.is_opening_balance)).toBe(true)
  })

  it('補足の有無・文字数・改行で表示行数を増やさない', () => {
    const source = entry('supplement', 2, 1)
    const supplemented = { ...source, supplement: '補足\n' + '長いメモ'.repeat(100) }
    const rows = expandEntry(supplemented)
    expect(rows).toHaveLength(expandEntry(source).length)
    expect(rows.map(row => row.debitLine?.id)).toEqual(['supplement-DEBIT-1', 'supplement-DEBIT-2'])
    expect(rows.every(row => row.entry === supplemented)).toBe(true)
  })
})

describe('仕訳単位の窓', () => {
  const simpleEntries = (count: number) => Array.from({ length: count }, (_, i) => entry(String(i)))

  it('空の一覧は0行で、移動しても空のまま', () => {
    expect(getJournalWindow([], 99)).toEqual({
      entries: [], rows: [], topIndex: 0, endEntryIndex: 0,
      startRow: 0, endRow: 0, totalRows: 0, lastTopIndex: 0,
    })
    for (const direction of ['first', 'prev', 'next', 'last'] as const) {
      expect(jumpJournalWindow([], 0, direction)).toBe(0)
    }
    expect(slideJournalWindow([], 0, 0)).toBe(0)
    expect(fragmentPageRows(getJournalWindow([]).rows)).toEqual([])
  })

  it('複合仕訳を途中で切らず、開始・終了の表示行番号を返す', () => {
    const entries = [...simpleEntries(11), entry('compound', 3, 1), entry('after')]
    const first = getJournalWindow(entries)
    expect(first.entries.map(entry => entry.id)).toEqual(simpleEntries(11).map(entry => entry.id))
    expect(first.rows).toHaveLength(11)
    expect([first.startRow, first.endRow, first.totalRows]).toEqual([1, 11, 15])
    const next = getJournalWindow(entries, 3)
    expect([next.topIndex, next.lastTopIndex, next.startRow, next.endRow]).toEqual([3, 3, 4, 15])
    const compound = fragmentPageRows(next.rows).find(fragment => fragment.entry.id === 'compound')!
    expect(compound.hasFirstRow).toBe(true)
    expect(compound.rows.map(row => row.rowIndex)).toEqual([0, 1, 2])
  })

  it.each([13, 25, 37])('%i表示行の複合仕訳は全行と全明細を同じ窓に保持する', count => {
    const source = entry('long', count, count - 1)
    const entries = [entry('before'), source, entry('after')]
    const window = getJournalWindow(entries, 1)
    expect(window.entries).toEqual([source])
    expect(window.rows).toEqual(expandEntry(source))
    expect([window.startRow, window.endRow, window.totalRows]).toEqual([2, count + 1, count + 2])
    const lineIds = window.rows.flatMap(row => [row.debitLine, row.creditLine].filter(line => line !== null).map(line => line.id))
    expect(lineIds.sort()).toEqual(source.journal_lines.map(line => line.id).sort())
    expect(getJournalWindow([source], 99).rows).toHaveLength(count)
  })

  it('最終仕訳を含む12行以内の最長の窓より後ろへは進めない', () => {
    const entries = [...simpleEntries(15), entry('last', 3, 1)]
    const window = getJournalWindow(entries, 99)
    expect([window.topIndex, window.lastTopIndex, window.startRow, window.endRow]).toEqual([6, 6, 7, 18])
    expect(window.rows).toHaveLength(12)
    expect(getJournalWindow(entries, -9).topIndex).toBe(0)
    expect(getJournalWindow(simpleEntries(5), 99).topIndex).toBe(0)
  })

  it('単純仕訳への下スライドは1件進め、窓内への移動では進めない', () => {
    const entries = simpleEntries(30)
    expect(slideJournalWindow(entries, 0, 11)).toBe(0)
    expect(slideJournalWindow(entries, 0, 12)).toBe(1)
    expect(slideJournalWindow(entries, 18, 29)).toBe(18)
  })

  it('複合仕訳が全部入るまで先頭を複数件進める', () => {
    const entries = [...simpleEntries(12), entry('compound', 4, 1), ...simpleEntries(8).map(e => ({ ...e, id: 'after-' + e.id }))]
    const top = slideJournalWindow(entries, 0, 12)
    expect(top).toBe(4)
    const window = getJournalWindow(entries, top)
    expect(window.rows).toHaveLength(12)
    expect(window.entries.at(-1)?.id).toBe('compound')
    expect(window.rows.filter(row => row.entry.id === 'compound')).toHaveLength(4)
  })

  it('13行以上の仕訳へ下スライドするとその仕訳だけを表示する', () => {
    const entries = [...simpleEntries(12), entry('long', 13, 1), entry('after')]
    const top = slideJournalWindow(entries, 0, 12)
    expect(top).toBe(12)
    expect(getJournalWindow(entries, top).entries.map(e => e.id)).toEqual(['long'])
    expect(slideJournalWindow(entries, top, 13)).toBe(13)
  })

  it('上スライドは対象仕訳を先頭にする', () => {
    const entries = simpleEntries(30)
    expect(slideJournalWindow(entries, 8, 7)).toBe(7)
    expect(slideJournalWindow(entries, 8, 2)).toBe(2)
  })

  it('次・前・最初・最後の窓へジャンプする', () => {
    const entries = simpleEntries(30)
    expect(jumpJournalWindow(entries, 0, 'next')).toBe(12)
    expect(jumpJournalWindow(entries, 12, 'next')).toBe(18)
    expect(jumpJournalWindow(entries, 18, 'next')).toBe(18)
    expect(jumpJournalWindow(entries, 18, 'prev')).toBe(6)
    expect(jumpJournalWindow(entries, 6, 'prev')).toBe(0)
    expect(jumpJournalWindow(entries, 0, 'prev')).toBe(0)
    expect(jumpJournalWindow(entries, 12, 'first')).toBe(0)
    expect(jumpJournalWindow(entries, 0, 'last')).toBe(18)
  })

  it('前ジャンプは現在の先頭の直前の仕訳までを12行以内に収める', () => {
    const entries = [entry('a', 5, 1), entry('b', 5, 1), entry('c', 3, 1), ...simpleEntries(20)]
    const top = jumpJournalWindow(entries, 3, 'prev')
    expect(top).toBe(1)
    expect(getJournalWindow(entries, top).entries.map(e => e.id)).toEqual(['b', 'c', '0', '1', '2', '3'])
    // 前の窓の先頭は、直前の仕訳を終端として逆算する。描画時は後続も入るだけ表示する。
    expect(getJournalWindow(entries, top).rows.length).toBe(12)
  })

  it('前ジャンプの直前が13行以上の複合仕訳なら、その全行を表示する', () => {
    const entries = [entry('before'), entry('long', 13), ...simpleEntries(20)]
    const top = jumpJournalWindow(entries, 2, 'prev')
    expect(top).toBe(1)
    expect(getJournalWindow(entries, top).rows).toEqual(expandEntry(entries[1]))
  })

  it('同じ仕訳の連続行だけを断片にまとめ、行配列を変更しない', () => {
    const rows = [entry('a', 2), entry('b'), entry('c', 1, 2)].flatMap(expandEntry)
    const original = [...rows]
    const fragments = fragmentPageRows(rows)
    expect(fragments.map(fragment => [fragment.entry.id, fragment.startRowIndex, fragment.rows.length, fragment.hasFirstRow])).toEqual([
      ['a', 0, 2, true], ['b', 2, 1, true], ['c', 3, 2, true],
    ])
    expect(rows).toEqual(original)
    expect(fragments.flatMap(fragment => fragment.rows)).toEqual(rows)
  })

  it('異なる行数の仕訳をジャンプで巡回しても全仕訳へ到達できる', () => {
    const entries = [entry('a', 8), entry('b', 5), entry('c', 13), entry('d', 4), entry('e', 9), entry('f')]
    const visited = new Set<string>()
    let top = 0
    for (;;) {
      const window = getJournalWindow(entries, top)
      expect(fragmentPageRows(window.rows).every(fragment => fragment.hasFirstRow)).toBe(true)
      window.entries.forEach(e => visited.add(e.id))
      if (top === window.lastTopIndex) break
      const next = jumpJournalWindow(entries, top, 'next')
      expect(next).toBeGreaterThan(top)
      top = next
    }
    expect([...visited]).toEqual(entries.map(e => e.id))
  })

  it('先頭IDが再取得・並び替え後も存在すればその位置を使う', () => {
    const entries = simpleEntries(30)
    const reordered = [...entries.slice(10), ...entries.slice(0, 10)]
    const index = resolveTopEntryIndex(reordered, '12', 12)
    expect(index).toBe(2)
    expect(getJournalWindow(reordered, index).entries[0].id).toBe('12')
    expect(resolveTopEntryIndex(reordered, null, 12)).toBe(0)
  })

  it('先頭IDが見つからない場合は直前のindexを使い、最終窓で丸める', () => {
    const entries = simpleEntries(30)
    expect(resolveTopEntryIndex(entries, 'deleted', 5)).toBe(5)
    expect(getJournalWindow(entries, resolveTopEntryIndex(entries, 'deleted', 29)).topIndex).toBe(18)
    expect(getJournalWindow([], resolveTopEntryIndex([], 'deleted', 29)).topIndex).toBe(0)
  })

  it('行数上限を変えても仕訳を分割せず、入力配列も変更しない', () => {
    const entries = [entry('a', 3), entry('b', 5), entry('c', 2)]
    const original = [...entries]
    const window = getJournalWindow(entries, 0, 7)
    expect(window.entries.map(e => e.id)).toEqual(['a'])
    expect(window.lastTopIndex).toBe(1)
    expect(entries).toEqual(original)
    expect(window.rows).toEqual(expandEntry(entries[0]))
  })
})

describe('先頭表示行への移動', () => {
  const rows = [entry('a', 3, 1), entry('b'), entry('c', 2, 1)].flatMap(expandEntry)

  it('次の仕訳へは継続行を飛ばす', () => {
    expect(findNextFirstRow(rows, 0)).toBe(3)
    expect(findNextFirstRow(rows, 1)).toBe(3)
    expect(findNextFirstRow(rows, 3)).toBe(4)
  })

  it('前の仕訳へも継続行を飛ばす', () => {
    expect(findPrevFirstRow(rows, 4)).toBe(3)
    expect(findPrevFirstRow(rows, 3)).toBe(0)
    expect(findPrevFirstRow(rows, 2)).toBe(0)
  })

  it('先頭・末尾の外側には移動先がない', () => {
    expect(findPrevFirstRow(rows, 0)).toBeNull()
    expect(findNextFirstRow(rows, 4)).toBeNull()
    expect(findNextFirstRow([], 0)).toBeNull()
    expect(findPrevFirstRow([], 0)).toBeNull()
  })

  it('継続行だけの配列には移動先を作らない', () => {
    const continuationRows = expandEntry(entry('long', 25, 1)).slice(12, 24)
    expect(findPrevFirstRow(continuationRows, continuationRows.length - 1)).toBeNull()
    expect(findNextFirstRow(continuationRows, 0)).toBeNull()
  })
})
