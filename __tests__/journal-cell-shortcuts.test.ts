import { describe, expect, it } from 'vitest'
import { getJournalCellInitialInput, shouldBubbleJournalCtrlDown } from '@/lib/journal-cell-shortcuts'
import { NAV_COLS } from '@/components/journals/journal-grid'

const key = (value: string, modifiers = {}) => ({ key: value, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...modifiers })
const editable = { isFirstRow: true, isOpeningBalance: false, showForm: false, editing: false }
const inputKey = (value: string, modifiers = {}) => ({ ...key(value), isComposing: false, keyCode: 0, repeat: false, ...modifiers })

describe('非編集セルの文字キーから編集を開始する判定', () => {
  it.each(NAV_COLS)('%s の受け付ける文字を判定する', field => {
    const numeric = ['date', 'debit_amount', 'credit_amount'].includes(field)
    const printable = ['debit_account', 'credit_account', 'description'].includes(field)
    for (const text of ['0', '1', '9', 's', 'S', '/', '.', '-', 'あ', '１']) {
      const accepted = printable || (numeric && /^[0-9]$/.test(text))
      expect(getJournalCellInitialInput(field, inputKey(text), editable)).toEqual(accepted ? { field, text } : null)
    }
  })

  it.each([' ', 'Tab', 'Enter', 'Escape', 'F1', 'F2', 'F12', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace', 'Process', 'Dead', 'Unidentified', '', '\n', '\t'])('%j は編集を始めない', value => {
    for (const field of NAV_COLS) expect(getJournalCellInitialInput(field, inputKey(value), editable)).toBeNull()
  })

  it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }, { repeat: true }])('%j の文字入力は無視する', modifiers => {
    for (const field of NAV_COLS) expect(getJournalCellInitialInput(field, inputKey('1', modifiers), editable)).toBeNull()
  })

  it.each([{ isFirstRow: false }, { isOpeningBalance: true }, { showForm: true }, { editing: true }])('%j のセルでは編集を始めない', context => {
    expect(getJournalCellInitialInput('description', inputKey('s'), { ...editable, ...context })).toBeNull()
  })

  it('Shift で生成した印字文字も受け付ける', () => {
    expect(getJournalCellInitialInput('description', inputKey('S', { shiftKey: true }), editable)).toEqual({ field: 'description', text: 'S' })
  })
})

describe('一覧セルから画面全体へ渡す Ctrl+↓', () => {
  it('Windows の Ctrl+↓ はセル内の末尾移動・通常の次行移動で消費しない', () => {
    expect(shouldBubbleJournalCtrlDown(key('ArrowDown', { ctrlKey: true }))).toBe(true)
  })

  it.each(['ArrowUp', 'ArrowLeft', 'ArrowRight'])('Ctrl+%s は既存のセル操作に残す', value => {
    expect(shouldBubbleJournalCtrlDown(key(value, { ctrlKey: true }))).toBe(false)
  })

  it.each([
    {},
    { metaKey: true },
    { ctrlKey: true, shiftKey: true },
    { ctrlKey: true, altKey: true },
    { ctrlKey: true, shiftKey: true, altKey: true },
  ])('修飾キー %j は対象外', modifiers => {
    expect(shouldBubbleJournalCtrlDown(key('ArrowDown', modifiers))).toBe(false)
  })
})
