import { describe, expect, it } from 'vitest'
import { parseCsvAmount } from '@/lib/csv-amount'

const FORMAT_ERROR = '金額の形式が正しくありません（半角数字のみ・13桁まで）'
const DECIMAL_ERROR = '小数点以下は指定できません（整数円のみ）'

const ok = (value: number) => ({ ok: true, value })
const ng = (message: string) => ({ ok: false, message })

describe('parseCsvAmount: 指定ケース（Codex への指示表 21件）', () => {
  it.each<[string, string, unknown]>([
    [' 1', '', ok(0)],
    [' 2', '1,000', ok(1000)],
    [' 3', '1000.00', ok(1000)],
    [' 4', '1000.000', ok(1000)],
    [' 5', '0', ok(0)],
    [' 6', '0.00', ok(0)],
    [' 7', '1000.01', ng(DECIMAL_ERROR)],
    [' 8', '0.01', ng(DECIMAL_ERROR)],
    [' 9', '100.5', ng(DECIMAL_ERROR)],
    ['10', '100.004', ng(DECIMAL_ERROR)],
    ['11', '1e3', ng(FORMAT_ERROR)],
    ['12', '0x10', ng(FORMAT_ERROR)],
    ['13', 'Infinity', ng(FORMAT_ERROR)],
    ['14', '-100', ng(FORMAT_ERROR)],
    ['15', '+100', ng(FORMAT_ERROR)],
    ['16', '１００', ng(FORMAT_ERROR)],
    ['17', '¥100', ng(FORMAT_ERROR)],
    ['18', '100.', ng(FORMAT_ERROR)],
    ['19', '.5', ng(FORMAT_ERROR)],
    ['20', '9999999999999', ok(9999999999999)],
    ['21', '10000000000000', ng(FORMAT_ERROR)],
  ])('#%s %j', (_no, input, expected) => {
    expect(parseCsvAmount(input)).toEqual(expected)
  })
})

describe('parseCsvAmount: 境界ケース（追加確認 13件）', () => {
  it.each<[string, string, unknown]>([
    [' 1', '  1,000.000  ', ok(1000)],
    [' 2', '\t\n', ok(0)],
    [' 3', ',', ok(0)],
    [' 4', ',1,0,0,0,', ok(1000)],
    [' 5', '0000000000001', ok(1)],
    [' 6', '9999999999999.' + '0'.repeat(10000), ok(9999999999999)],
    [' 7', '1,000.0,0', ok(1000)],
    [' 8', '1 000', ng(FORMAT_ERROR)],
    [' 9', '1\n000', ng(FORMAT_ERROR)],
    ['10', '1.0.0', ng(FORMAT_ERROR)],
    ['11', '00000000000001', ng(FORMAT_ERROR)],
    ['12', 'NaN', ng(FORMAT_ERROR)],
    ['13', '100.' + '0'.repeat(10000) + '4', ng(DECIMAL_ERROR)],
  ])('#%s %j', (_no, input, expected) => {
    expect(parseCsvAmount(input)).toEqual(expected)
  })
})

describe('parseCsvAmount: カンマの扱い（現行仕様の固定）', () => {
  // カンマは桁区切りの位置を検証せず、すべて除去する。厳密化する場合はこのテストを意図的に変更すること
  it('位置に関係なくすべて除去する', () => {
    expect(parseCsvAmount('1,2,3')).toEqual(ok(123))
    expect(parseCsvAmount('12,34')).toEqual(ok(1234))
  })
})
