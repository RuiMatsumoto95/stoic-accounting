import { describe, expect, it } from 'vitest'
import { resolveDateInput } from '@/lib/date-input'

const originalDate = '2026-06-05'
const yearForMonth = (month: number) => month >= 4 ? 2026 : 2027

describe('インライン保存に渡す日付の同期確定', () => {
  it.each(['1207', '12/07'])('%s は親の日付が変更前でも確定した12/07を返す', text => {
    expect(resolveDateInput(text, originalDate, yearForMonth, true)).toEqual({ value: '2026-12-07', error: null })
  })

  it.each(['1', '12', '120', '1207'])('入力途中の %s を確定できるか判定する', text => {
    const result = resolveDateInput(text, originalDate, yearForMonth, true)
    if (text.length < 3) expect(result.value).toBeNull()
    else expect(result.value).toBe(text === '120' ? '2027-01-20' : '2026-12-07')
  })

  it.each(['', '   '])('追加入力なし %j は既存値を維持する', text => {
    expect(resolveDateInput(text, originalDate, yearForMonth, true)).toEqual({ value: originalDate, error: null })
  })

  it.each(['12', '1301', '1200', '0230', '0431', '0229', '12/32', '12x07', '12/7abc', '12/7/1'])('%s は変更前の日付を返さず、エラーにする', text => {
    const result = resolveDateInput(text, originalDate, yearForMonth, true)
    expect(result.value).toBeNull()
    expect(result.error).toBeTruthy()
  })

  it('期をまたぐ月と閏年を扱う', () => {
    expect(resolveDateInput('107', originalDate, yearForMonth, true).value).toBe('2027-01-07')
    expect(resolveDateInput('0229', originalDate, () => 2028, true).value).toBe('2028-02-29')
  })

  it('空の既存日付は入力なしで復元しない', () => {
    expect(resolveDateInput('', '', yearForMonth, true).value).toBe('')
  })
})

describe('他画面で使う日付入力の従来の解釈', () => {
  it.each(['605', '0605', '6/5', '06/05'])('%s は06/05に確定する', text => {
    expect(resolveDateInput(text, originalDate, yearForMonth)).toEqual({ value: originalDate, error: null })
  })

  it('既存フォームの緩い解釈は変更しない', () => {
    expect(resolveDateInput('0230', originalDate, yearForMonth).value).toBe('2027-02-30')
    expect(resolveDateInput('6x05', originalDate, yearForMonth).value).toBe(originalDate)
  })
})
