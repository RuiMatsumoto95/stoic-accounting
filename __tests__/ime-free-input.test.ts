import { describe, expect, it } from 'vitest'
import { applyImeFreeAmountKey, applyImeFreeDateKey, applyImeFreeQueryKey } from '@/lib/ime-free-input'

const keyEvent = (key: string, overrides = {}) => ({ key, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, keyCode: 0, ...overrides })
const searching = { open: true, browsing: false, query: 'sho' }

describe('IMEを使わない日付キー入力', () => {
  it.each(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])('%s を末尾に追加する', key => {
    expect(applyImeFreeDateKey('12', keyEvent(key))).toBe('12' + key)
  })

  it('空でない文字列に区切りを1つだけ追加する', () => {
    expect(applyImeFreeDateKey('12', keyEvent('/'))).toBe('12/')
    expect(applyImeFreeDateKey('', keyEvent('/'))).toBeNull()
    expect(applyImeFreeDateKey('12/', keyEvent('/'))).toBeNull()
  })

  it('Backspaceは末尾1文字、Deleteは全部を消す', () => {
    expect(applyImeFreeDateKey('12/05', keyEvent('Backspace'))).toBe('12/0')
    expect(applyImeFreeDateKey('12/05', keyEvent('Delete'))).toBe('')
    expect(applyImeFreeDateKey('', keyEvent('Backspace'))).toBe('')
    expect(applyImeFreeDateKey('', keyEvent('Delete'))).toBe('')
  })

  it('5文字まで追加し、上限では変更せずキーを消費する', () => {
    expect(applyImeFreeDateKey('12/0', keyEvent('5'))).toBe('12/05')
    expect(applyImeFreeDateKey('12/05', keyEvent('6'))).toBe('12/05')
    expect(applyImeFreeDateKey('12345', keyEvent('/'))).toBe('12345')
  })

  it.each(['Tab', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', ' ', '１', 'あ', '!', 'Process'])('%j を処理しない', key => {
    expect(applyImeFreeDateKey('12', keyEvent(key))).toBeNull()
  })
})

describe('IMEを使わない科目検索キー入力', () => {
  it('閉じた欄の最初の文字で置き換えて開く', () => {
    expect(applyImeFreeQueryKey({ ...searching, open: false }, keyEvent('k'))).toEqual({ query: 'k', open: true, browsing: false })
  })

  it('検索語に末尾追加する', () => {
    expect(applyImeFreeQueryKey(searching, keyEvent('u'))).toEqual({ ...searching, query: 'shou' })
  })

  it('閲覧モードからは1文字で置き換える', () => {
    expect(applyImeFreeQueryKey({ ...searching, browsing: true }, keyEvent('1'))).toEqual({ query: '1', open: true, browsing: false })
  })

  it.each(['!', '/', '~'])('印字可能なASCII記号 %s も追加する', key => {
    expect(applyImeFreeQueryKey(searching, keyEvent(key))?.query).toBe('sho' + key)
  })

  it('Backspaceで末尾を削除し、空になっても開いたままにする', () => {
    expect(applyImeFreeQueryKey(searching, keyEvent('Backspace'))).toEqual({ ...searching, query: 'sh' })
    for (const query of ['k', '']) {
      expect(applyImeFreeQueryKey({ ...searching, query }, keyEvent('Backspace'))).toEqual({ ...searching, query: '' })
    }
  })

  it('閉じた欄・閲覧モードのBackspaceでは選択を消さない', () => {
    expect(applyImeFreeQueryKey({ ...searching, open: false }, keyEvent('Backspace'))).toBeNull()
    expect(applyImeFreeQueryKey({ ...searching, browsing: true }, keyEvent('Backspace'))).toBeNull()
  })

  it.each([' ', '　', '１', 'あ', 'Tab', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'F1', 'Delete', 'Process'])('%j を処理しない', key => {
    expect(applyImeFreeQueryKey(searching, keyEvent(key))).toBeNull()
  })
})

describe('IMEを使わない金額キー入力', () => {
  it.each(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])('%s を末尾に追加し、全選択時は置き換える', key => {
    expect(applyImeFreeAmountKey('120', keyEvent(key), false)).toBe('120' + key)
    expect(applyImeFreeAmountKey('120', keyEvent(key), true)).toBe(key)
    expect(applyImeFreeAmountKey('', keyEvent(key), false)).toBe(key)
  })

  it.each(['/', '.'])('%s は000を1回追加し、空欄・全選択時は変更せず消費する', key => {
    expect(applyImeFreeAmountKey('12', keyEvent(key), false)).toBe('12000')
    expect(applyImeFreeAmountKey('', keyEvent(key), false)).toBe('')
    expect(applyImeFreeAmountKey('12', keyEvent(key), true)).toBe('12')
    expect(applyImeFreeAmountKey('', keyEvent(key), true)).toBe('')
  })

  it('Backspaceは末尾1文字、全選択時は全部消す', () => {
    expect(applyImeFreeAmountKey('120', keyEvent('Backspace'), false)).toBe('12')
    expect(applyImeFreeAmountKey('120', keyEvent('Backspace'), true)).toBe('')
    expect(applyImeFreeAmountKey('', keyEvent('Backspace'), false)).toBe('')
  })

  it.each([false, true])('Deleteは全選択=%sでも全部消す', replaceAll => {
    expect(applyImeFreeAmountKey('120', keyEvent('Delete'), replaceAll)).toBe('')
    expect(applyImeFreeAmountKey('', keyEvent('Delete'), replaceAll)).toBe('')
  })

  it('整数部は13桁まで追加でき、上限でもキーは消費する', () => {
    expect(applyImeFreeAmountKey('123456789012', keyEvent('3'), false)).toBe('1234567890123')
    expect(applyImeFreeAmountKey('1234567890123', keyEvent('4'), false)).toBe('1234567890123')
    expect(applyImeFreeAmountKey('1234567890123', keyEvent('4'), true)).toBe('4')
    expect(applyImeFreeAmountKey('0000000000000', keyEvent('1'), false)).toBe('0000000000000')
  })

  it.each(['/', '.'])('%s の000追加でも13桁の上限を守る', key => {
    expect(applyImeFreeAmountKey('1234567890', keyEvent(key), false)).toBe('1234567890000')
    expect(applyImeFreeAmountKey('12345678901', keyEvent(key), false)).toBe('12345678901')
  })

  it('DBから読んだ小数は2桁まで追加できる', () => {
    expect(applyImeFreeAmountKey('12.3', keyEvent('4'), false)).toBe('12.34')
    expect(applyImeFreeAmountKey('12.34', keyEvent('5'), false)).toBe('12.34')
    expect(applyImeFreeAmountKey('1234567890123.4', keyEvent('5'), false)).toBe('1234567890123.45')
    expect(applyImeFreeAmountKey('12.34', keyEvent('5'), true)).toBe('5')
    expect(applyImeFreeAmountKey('0.01', keyEvent('2'), false)).toBe('0.01')
  })

  it('小数の末尾を削除し、小数点が末尾に残っても数字を追記できる', () => {
    const first = applyImeFreeAmountKey('12.3', keyEvent('Backspace'), false)
    expect(first).toBe('12.')
    expect(applyImeFreeAmountKey(first!, keyEvent('4'), false)).toBe('12.4')
    expect(applyImeFreeAmountKey(first!, keyEvent('Backspace'), false)).toBe('12')
  })

  it.each(['/', '.'])('小数に %s で000を追加して2桁を超える場合は変更せず消費する', key => {
    expect(applyImeFreeAmountKey('12.3', keyEvent(key), false)).toBe('12.3')
    expect(applyImeFreeAmountKey('12.34', keyEvent(key), false)).toBe('12.34')
  })

  it.each(['Tab', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', ' ', '１', 'あ', '-', '+', 'e', 'Process'])('%j を処理しない', key => {
    expect(applyImeFreeAmountKey('12', keyEvent(key), false)).toBeNull()
    expect(applyImeFreeAmountKey('12', keyEvent(key), true)).toBeNull()
  })
})

describe.each([
  { ctrlKey: true }, { altKey: true }, { metaKey: true },
  { isComposing: true }, { keyCode: 229 },
])('修飾キー・IME入力 %j', overrides => {
  it.each(['1', '/', 'Backspace', 'Delete'])('日付の %s を処理しない', key => {
    expect(applyImeFreeDateKey('12', keyEvent(key, overrides))).toBeNull()
  })

  it.each(['1', '/', '.', 'Backspace', 'Delete'])('金額の %s を処理しない', key => {
    expect(applyImeFreeAmountKey('12', keyEvent(key, overrides), false)).toBeNull()
    expect(applyImeFreeAmountKey('12', keyEvent(key, overrides), true)).toBeNull()
  })

  it.each(['k', '1', '/', 'Backspace'])('科目の %s を処理しない', key => {
    expect(applyImeFreeQueryKey(searching, keyEvent(key, overrides))).toBeNull()
  })
})
