import { describe, expect, it } from 'vitest'
import { canStartNavDrag, getNavDragScroll, links } from '@/components/layout/NavLinks'

it('期首残高を追加し、既存ナビの順序とラベルを保つ', () => {
  expect(links.filter(link => link.href !== '/opening-balances')).toEqual([
    { href: '/journals', label: '仕訳日記帳' }, { href: '/ledger', label: '総勘定元帳' },
    { href: '/trial-balance', label: '残高試算表（貸借）' }, { href: '/pl-trial-balance', label: '残高試算表（損益）' },
    { href: '/subsidiary-ledger', label: '補助元帳' }, { href: '/subsidiary-balance', label: '補助残高一覧' },
    { href: '/tax-summary', label: '消費税集計表' }, { href: '/income-statement', label: '損益計算書' },
    { href: '/balance-sheet', label: '貸借対照表' }, { href: '/csv-import', label: 'CSVインポート' }, { href: '/settings', label: '設定' },
  ])
  expect(links).toContainEqual({ href: '/opening-balances', label: '期首残高' })
})

describe('ナビのドラッグ開始条件', () => {
  it.each([
    ['mouse', 0, 1001, 1000, true],
    ['mouse', 0, 1000, 1000, false],
    ['mouse', 0, 999, 1000, false],
    ['mouse', 1, 1001, 1000, false],
    ['mouse', 2, 1001, 1000, false],
    ['touch', 0, 1001, 1000, false],
    ['pen', 0, 1001, 1000, false],
  ])('%s・button=%i・幅 %i/%i → %s', (pointerType, button, scrollWidth, clientWidth, expected) => {
    expect(canStartNavDrag(pointerType, button, scrollWidth, clientWidth)).toBe(expected)
  })
})

describe('ナビのマウスドラッグ閾値とスクロール位置', () => {
  it.each([0, 1, -1, 4, -4, 4.9, -4.9])('移動量 %s px では通常クリックを維持する', distance => {
    expect(getNavDragScroll(100, 100 + distance, 50)).toBeNull()
  })

  it.each([
    [5, 45], [-5, 55], [30, 20], [-30, 80], [80, -30],
  ])('移動量 %s px では開始位置からスクロールする', (distance, expected) => {
    expect(getNavDragScroll(100, 100 + distance, 50)).toBe(expected)
  })
})
