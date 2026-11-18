import { describe, expect, it } from 'vitest'
import type { JournalEntryWithLines as Entry } from '@/components/journals/JournalForm'
import { applyJournalFetch, classifyF5, commitEntry, getFetchKeepIds, isLatestFetch, keepCurrentOrder, reorderWithFetched, shouldApplyReload } from '@/lib/journal-order'

const entry = (id: string, date = '2026-04-01'): Entry => ({
  id, date, description: id, reference_number: null, supplement: null, is_opening_balance: false, journal_lines: [],
})
const ids = (entries: Entry[]) => entries.map(entry => entry.id)

describe('commitEntry', () => {
  it('仮行の採番待ちを確定番号に置き換え、重複取得があっても入力位置を保つ', () => {
    const pending = { ...entry('temp'), referenceNumberPending: true }
    const real = { ...entry('real'), reference_number: 42 }
    const committed = commitEntry([entry('a'), pending, entry('b'), real], 'temp', real)
    expect(ids(committed)).toEqual(['a', 'real', 'b'])
    expect(committed[1].reference_number).toBe(42)
    expect(committed[1].referenceNumberPending).toBeUndefined()
  })
  it('日付順にせず仮IDの位置で差し替える', () => {
    const real = entry('real', '2026-01-01')
    expect(commitEntry([entry('a'), entry('temp'), entry('b')], 'temp', real)).toEqual([entry('a'), real, entry('b')])
  })

  it.each([
    ['real', 'a', 'temp', 'b'],
    ['a', 'temp', 'b', 'real'],
  ])('正式IDが取得済みでも仮IDの位置に1件だけ残す: %s', (...currentIds) => {
    expect(ids(commitEntry(currentIds.map(id => entry(id)), 'temp', entry('real')))).toEqual(['a', 'real', 'b'])
  })

  it('仮IDがなければ既存の正式IDの内容を更新する', () => {
    const real = { ...entry('real'), description: '更新後' }
    expect(commitEntry([entry('real')], 'temp', real)).toEqual([real])
  })
})

describe('keepCurrentOrder', () => {
  it('現在の位置で内容だけ更新し、新しいIDを末尾に追加する', () => {
    const changed = { ...entry('b'), description: '更新後' }
    expect(keepCurrentOrder([entry('b'), entry('a')], [entry('a'), changed, entry('new')], new Set())).toEqual([changed, entry('a'), entry('new')])
  })

  it('取得結果から消えたIDは除き、keepIdsだけは元の位置に残す', () => {
    expect(ids(keepCurrentOrder([entry('gone'), entry('temp'), entry('a')], [entry('a')], new Set(['temp'])))).toEqual(['temp', 'a'])
  })

  it('日付を変更しても位置を変えない', () => {
    const changed = entry('b', '2026-01-01')
    expect(keepCurrentOrder([entry('a'), entry('b')], [changed, entry('a')], new Set())).toEqual([entry('a'), changed])
  })
})

describe('reorderWithFetched', () => {
  it('取得結果の順に戻し、保持対象は末尾へ回す', () => {
    const current = [entry('june', '2026-06-05'), entry('temp'), entry('april'), entry('may', '2026-05-06'), entry('committed')]
    const fetched = [entry('april'), entry('may', '2026-05-06'), entry('june', '2026-06-05')]
    expect(reorderWithFetched(current, fetched, new Set(['temp', 'committed']))).toEqual([
      ...fetched, entry('temp'), entry('committed'),
    ])
  })
})

describe('classifyF5', () => {
  const event = { key: 'F5', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false }
  const ready = { editing: false, formOpen: false, busy: false }

  it('通常のF5で実行可能ならreload', () => {
    expect(classifyF5(event, ready)).toBe('reload')
  })

  it.each(['editing', 'formOpen', 'busy'] as const)('%sのときはブラウザ動作を抑止するだけ', key => {
    expect(classifyF5(event, { ...ready, [key]: true })).toBe('swallow')
  })

  it.each(['repeat', 'isComposing'] as const)('%sもブラウザ動作だけを抑止する', key => {
    expect(classifyF5({ ...event, [key]: true }, ready)).toBe('swallow')
  })

  it.each(['ctrlKey', 'shiftKey', 'altKey', 'metaKey'] as const)('%s付きは変換中・リピート中でもbrowser', key => {
    expect(classifyF5({ ...event, [key]: true }, ready)).toBe('browser')
    expect(classifyF5({ ...event, [key]: true, repeat: true, isComposing: true }, { editing: true, formOpen: true, busy: true })).toBe('browser')
  })

  it('F5以外は対象外', () => {
    expect(classifyF5({ ...event, key: 'F2' }, ready)).toBe('browser')
  })
})

describe('shouldApplyReload', () => {
  const ready = { seq: 2, latestSeq: 2, editing: false, formOpen: false, pendingFocus: false }

  it('最新の取得で操作中でなければ反映可能', () => {
    expect(shouldApplyReload(ready)).toBe(true)
  })

  it('古い取得は反映しない', () => {
    expect(shouldApplyReload({ ...ready, seq: 1 })).toBe(false)
  })

  it.each(['editing', 'formOpen', 'pendingFocus'] as const)('反映直前に%sなら破棄する', key => {
    expect(shouldApplyReload({ ...ready, [key]: true })).toBe(false)
  })
})

describe('取得順と保存完了の競合', () => {
  const current = [entry('april'), entry('temp', '2026-06-05')]
  const fetched = [entry('april')]

  it.each([true, false])('古い取得・失敗は現在の配列をそのまま返す（keepOrder=%s）', keepOrder => {
    const options = { seq: 1, latestSeq: 2, keepIds: new Set<string>(), keepOrder }
    expect(applyJournalFetch(current, { ok: true, entries: [] }, options)).toBe(current)
    expect(applyJournalFetch(current, { ok: false, error: new Error('失敗') }, { ...options, seq: 2 })).toBe(current)
  })

  it('最後に始めた取得だけ反映可能', () => {
    expect(isLatestFetch(1, 2)).toBe(false)
    expect(isLatestFetch(2, 2)).toBe(true)
    expect(applyJournalFetch(current, { ok: true, entries: fetched }, {
      seq: 2, latestSeq: 2, keepIds: new Set(), keepOrder: false,
    })).toEqual(fetched)
  })

  for (const merge of [keepCurrentOrder, reorderWithFetched]) {
    describe(merge.name, () => {
      it('検索条件外でも保存中の仮IDを残す', () => {
        const keepIds = getFetchKeepIds(new Set(['temp']), new Map(), 1)
        expect(ids(merge(current, fetched, keepIds))).toEqual(['april', 'temp'])
      })

      it('取得開始後に完了した正式IDを残し、次の取得では検索条件に従う', () => {
        const committed = commitEntry(current, 'temp', entry('real', '2026-06-05'))
        const at = new Map([['real', 1]])
        expect(ids(merge(committed, fetched, getFetchKeepIds(new Set(), at, 1)))).toEqual(['april', 'real'])
        expect(ids(merge(committed, fetched, getFetchKeepIds(new Set(), at, 2)))).toEqual(['april'])
      })

      it('取得結果に正式IDがあれば二重に追加しない', () => {
        const committed = commitEntry(current, 'temp', entry('real'))
        const result = merge(committed, [...fetched, entry('real')], new Set(['real']))
        expect(ids(result)).toEqual(['april', 'real'])
      })

      it('取得が先に完了して仮IDと正式IDが並んでも、commit後に重複を残さない', () => {
        const result = merge(current, [...fetched, entry('real')], new Set(['temp']))
        expect(ids(result)).toContain('temp')
        expect(ids(result)).toContain('real')
        expect(ids(commitEntry(result, 'temp', entry('real')))).toEqual(['april', 'real'])
      })

      it('保存失敗で仮IDを除いた後は再取得でも復活しない', () => {
        const rolledBack = current.filter(entry => entry.id !== 'temp')
        expect(merge(rolledBack, fetched, new Set())).toEqual(fetched)
      })
    })
  }
})
