export type AmountSide = 'DEBIT' | 'CREDIT'

export type AmountSnapshot = {
  side: AmountSide
  value: string
}

export type AmountLine = {
  side: AmountSide
  amount: string
}

// journal-save.ts の AMOUNT_PATTERN と同じ形式。保存モジュール（Supabase）に依存させない。
const AMOUNT_PATTERN = /^[0-9]{1,13}(\.[0-9]{1,2})?$/

function toMinorUnits(value: string): bigint | null {
  const text = value.trim()
  if (!AMOUNT_PATTERN.test(text)) return null
  const [integer, fraction = ''] = text.split('.')
  return BigInt(integer) * BigInt(100) + BigInt(fraction.padEnd(2, '0'))
}

/** focus 時の値を基準に、単純仕訳の同期が続いている場合だけ反対側を更新する。 */
export function syncAmounts<T extends AmountLine>(lines: T[], snapshot: AmountSnapshot | null): T[] {
  if (!snapshot || lines.length !== 2) return lines
  const source = lines.find(line => line.side === snapshot.side)
  const opposite = lines.find(line => line.side !== snapshot.side)
  if (!source || !opposite) return lines

  const amount = toMinorUnits(source.amount)
  if (amount === null || amount <= BigInt(0)) return lines

  if (opposite.amount.trim() !== '') {
    const previous = toMinorUnits(snapshot.value)
    if (previous === null || toMinorUnits(opposite.amount) !== previous) return lines
  }

  if (opposite.amount === source.amount) return lines
  return lines.map(line => line === opposite ? { ...line, amount: source.amount } : line)
}
