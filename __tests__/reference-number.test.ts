import { describe, expect, it } from 'vitest'
import { parseReferenceNumberInput } from '@/lib/reference-number'

describe('parseReferenceNumberInput', () => {
  it.each<[string, number | null]>([
    ['', null], [' 　\t ', null], ['1', 1], ['999999999', 999999999],
    ['１２', 12], ['００７', 7], ['007', 7], [' １２ ', 12], [' 7\n', 7],
  ])('%j → %j', (input, value) => {
    expect(parseReferenceNumberInput(input)).toEqual({ ok: true, value })
  })

  it.each([
    '0', '-1', '+1', '1000000000', '1.5', '1e3', '1,2', '12a', '1 2', '１　２',
    '＋１', '－１', '１．５', '１ｅ３', '１，２', 'Infinity', 'NaN', '0x10', '9'.repeat(400),
  ])('不正値 %j は拒否する', input => {
    expect(parseReferenceNumberInput(input)).toEqual({ ok: false, message: '伝票番号は1〜999999999の整数で入力してください。' })
  })
})
