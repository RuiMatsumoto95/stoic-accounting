import { describe, expect, it, vi } from 'vitest'
import { syncAmounts, type AmountLine, type AmountSide } from '@/lib/amount-sync'

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))
import { amountToRpcString } from '@/lib/journal-save'

describe.each<AmountSide>(['DEBIT', 'CREDIT'])('金額同期（%s 起点）', side => {
  const opposite: AmountSide = side === 'DEBIT' ? 'CREDIT' : 'DEBIT'
  const linesFor = (amount: string, other: string): AmountLine[] => [
    { side, amount }, { side: opposite, amount: other },
  ]
  const sync = (amount: string, other: string, previous: string) =>
    syncAmounts(linesFor(amount, other), { side, value: previous })

  it.each(['', '10000'])('反対側が空ならコピーする（編集前: %j）', previous => {
    expect(sync('12000', '', previous)[1].amount).toBe('12000')
  })

  it.each(['10000', '10000.00', '010000'])('編集前と数値として同額ならコピーする: %s', other => {
    expect(sync('12000', other, '10000')[1].amount).toBe('12000')
  })

  it.each(['10000.00', '010000'])('編集前の表記が異なっても同額ならコピーする: %s', previous => {
    expect(sync('12000', '10000', previous)[1].amount).toBe('12000')
  })

  it('意図的な不一致を上書きしない', () => {
    expect(sync('12000', '9999', '10000')[1].amount).toBe('9999')
  })

  const invalidAmounts = [
    '', ' ', '0', '0.00', '000', '-1', '1.001', '10000000000000',
    '00000000000001', '100abc', '1e3', '+1', 'NaN', 'Infinity', '1.', '.5', '1,000', '１００',
  ]
  it.each(invalidAmounts)('自分側が空・0・不正なら反対側を変えない: %j', amount => {
    const lines = linesFor(amount, '10000')
    expect(syncAmounts(lines, { side, value: '10000' })).toBe(lines)
    expect(sync(amount, '', '')[1].amount).toBe('')
    expect(() => amountToRpcString(amount, 1)).toThrow()
  })

  it.each(['0.01', '12000.50', '9999999999999.99', ' 12.50 '])('保存可能な正の金額をコピーする: %j', amount => {
    expect(() => amountToRpcString(amount, 1)).not.toThrow()
    expect(sync(amount, '', '')[1].amount).toBe(amount)
  })

  it('自分側を空にしても反対側は消さない', () => {
    expect(sync('', '10000', '10000')).toEqual(linesFor('', '10000'))
  })

  it.each<AmountSide>(['DEBIT', 'CREDIT'])('複合仕訳ではコピーしない（%s 行を追加）', addedSide => {
    const lines = [...linesFor('12000', '10000'), { side: addedSide, amount: '' }]
    expect(syncAmounts(lines, { side, value: '10000' })).toBe(lines)
  })

  it('initialInput の1文字目ではなく元の金額を基準にする', () => {
    expect(sync('2', '10000', '10000')[1].amount).toBe('2')
    expect(sync('2', '10000', '2')[1].amount).toBe('10000')
  })

  it('有効なスナップショットがなければ保存前でも帳尻を合わせない', () => {
    const lines = linesFor('12000', '10000')
    expect(syncAmounts(lines, null)).toBe(lines)
  })

  it('行数変更でスナップショットを破棄後、次のfocusの値で同期を再開できる', () => {
    const lines = linesFor('12000', '10000')
    expect(syncAmounts(lines, null)).toBe(lines)
    expect(syncAmounts(lines, { side, value: '10000' })[1].amount).toBe('12000')
  })

  it('元のデータを変更せず、保存に使う更新済みデータを返す', () => {
    const lines = linesFor('12000', '10000').map((line, i) => ({ ...line, account_id: `account-${i}` }))
    const result = syncAmounts(lines, { side, value: '10000' })
    expect(lines[1].amount).toBe('10000')
    expect(result).toEqual([
      { ...lines[0] }, { ...lines[1], amount: '12000' },
    ])
    expect(result[0]).toBe(lines[0])
    expect(result.map(line => amountToRpcString(line.amount, 1))).toEqual(['12000', '12000'])
  })

  it('最大金額付近でも1銭の違いを区別する', () => {
    expect(sync('2', '9999999999999.99', '9999999999999.98')[1].amount).toBe('9999999999999.99')
    expect(sync('2', '9999999999999.99', '9999999999999.99')[1].amount).toBe('2')
  })

  it.each(['10000abc', '10000.001', '-10000', '1e4'])('不正な比較値を同額として扱わない: %s', invalid => {
    expect(sync('12000', invalid, '10000')[1].amount).toBe(invalid)
    expect(sync('12000', '10000', invalid)[1].amount).toBe('10000')
  })

  it('借方・貸方の配列順に依存しない', () => {
    const lines = linesFor('12000', '10000').reverse()
    expect(syncAmounts(lines, { side, value: '10000' })[0].amount).toBe('12000')
  })
})

it('片側しかない場合は同期しない', () => {
  const lines: AmountLine[] = [{ side: 'DEBIT', amount: '12000' }, { side: 'DEBIT', amount: '' }]
  expect(syncAmounts(lines, { side: 'DEBIT', value: '' })).toBe(lines)
  expect(syncAmounts(lines.slice(0, 1), { side: 'DEBIT', value: '' })).toEqual(lines.slice(0, 1))
})
