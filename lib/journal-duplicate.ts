export type InlineLine = {
  side: 'DEBIT' | 'CREDIT'
  account_id: string
  sub_account_id: string
  amount: string
  tax_code: string
}

export type InlineDraft = {
  date: string
  description: string
  supplement: string
  lines: InlineLine[]
}

type EntryWithSides = {
  journal_lines: { side: 'DEBIT' | 'CREDIT' }[]
}

export function isSimpleEntry(entry: EntryWithSides): boolean {
  const debitLines  = entry.journal_lines.filter(l => l.side === 'DEBIT')
  const creditLines = entry.journal_lines.filter(l => l.side === 'CREDIT')
  return debitLines.length === 1 && creditLines.length === 1
}

type DuplicateEntry = {
  date: string
  description: string
  supplement: string | null
  journal_lines: {
    side: 'DEBIT' | 'CREDIT'
    account_id: string
    amount: number
    tax_code: string | null
  }[]
}

export function entryToInlineDraft(
  entry: DuplicateEntry,
  accounts: { id: string; parent_id: string | null }[]
): InlineDraft {
  if (!isSimpleEntry(entry)) {
    throw new Error('単純仕訳以外はインライン入力に複製できません')
  }

  return {
    date: entry.date,
    description: entry.description,
    supplement: entry.supplement ?? '',
    lines: (['DEBIT', 'CREDIT'] as const).map(side => {
      // 単純仕訳の確認済みなので、借方・貸方はそれぞれ必ず1行ある。
      const line = entry.journal_lines.find(l => l.side === side)!
      const account = accounts.find(a => a.id === line.account_id)
      const parent = account?.parent_id
        ? accounts.find(a => a.id === account.parent_id)
        : null
      return {
        side,
        account_id: account ? (account.parent_id ? parent?.id ?? '' : account.id) : '',
        sub_account_id: parent && account ? account.id : '',
        amount: String(line.amount),
        tax_code: line.tax_code ?? '',
      }
    }),
  }
}
