import { describe, expect, it } from 'vitest'
import { getInlineFormNavigateUpColumn } from '@/lib/inline-form-navigation'
import type { GridField } from '@/components/journals/journal-grid'

const up = { key: 'ArrowUp', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, isComposing: false, keyCode: 38 }
const supportedFields = ['date', 'debit_account', 'debit_amount', 'credit_account', 'credit_amount'] as const

describe('入力フォームから最後の仕訳へ移動する ↑', () => {
  it.each(supportedFields)('先頭行の %s から同じ列へ移る', field => {
    expect(getInlineFormNavigateUpColumn(field, 0, up)).toBe(field)
  })

  it.each(['description', 'supplement', 'debit_sub', 'credit_sub', 'debit_tax', 'credit_tax', 'slip_number', 'select', 'actions', 'message'] as const)('%s は既存のキー操作に残す', field => {
    expect(getInlineFormNavigateUpColumn(field, 0, up)).toBeNull()
  })

  it.each([1, 2, 3, -1])('先頭以外の明細行 %i は対象外', rowIndex => {
    for (const field of supportedFields) expect(getInlineFormNavigateUpColumn(field, rowIndex, up)).toBeNull()
  })

  it.each(['ctrlKey', 'shiftKey', 'altKey', 'metaKey', 'isComposing'] as const)('%s のときは移動しない', modifier => {
    for (const field of supportedFields) expect(getInlineFormNavigateUpColumn(field, 0, { ...up, [modifier]: true })).toBeNull()
  })

  it('isComposing=false でも keyCode=229 はIMEとして除外する', () => {
    for (const field of supportedFields) expect(getInlineFormNavigateUpColumn(field, 0, { ...up, keyCode: 229 })).toBeNull()
  })

  it('閉じた科目欄が preventDefault 済みでも、親へ伝わった ↑ は移動に使う', () => {
    const preventedUp = { ...up, defaultPrevented: true }
    expect(getInlineFormNavigateUpColumn('debit_account', 0, preventedUp)).toBe('debit_account')
    expect(getInlineFormNavigateUpColumn('credit_account', 0, preventedUp)).toBe('credit_account')
  })

  it.each(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab', 'Escape', 'a', 'Process'])('%s は消費しない', key => {
    for (const field of supportedFields) expect(getInlineFormNavigateUpColumn(field, 0, { ...up, key })).toBeNull()
  })

  it('未確定の日付入力があれば移動せず、確定済み・未入力なら移動する', () => {
    expect(getInlineFormNavigateUpColumn('date', 0, up, true)).toBeNull()
    expect(getInlineFormNavigateUpColumn('date', 0, up, false)).toBe('date')
  })

  it.each(supportedFields.filter(field => field !== 'date'))('日付の入力途中でも %s の移動は妨げない', field => {
    expect(getInlineFormNavigateUpColumn(field, 0, up, true)).toBe(field)
  })

  it('未知の欄を渡しても移動しない', () => {
    expect(getInlineFormNavigateUpColumn('unknown' as GridField, 0, up)).toBeNull()
  })
})
