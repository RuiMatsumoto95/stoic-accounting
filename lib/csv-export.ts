export function buildCsv(headers: string[], rows: string[][]): string {
  const escape = (val: string) => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`
    }
    return val
  }
  const lines = [headers.map(escape).join(',')]
  for (const row of rows) lines.push(row.map(escape).join(','))
  return lines.join('\r\n')
}

export function downloadCsv(csv: string, filename: string): void {
  const bom = '﻿'
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function todayYYYYMMDD(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

export function formatDateSlash(date: string): string {
  return date.replace(/-/g, '/')
}

// 循環参照を避けるためこのファイル内で定義する
type CsvAccount = {
  id: string
  name: string
  parent_id: string | null
}

type CsvJournalLine = {
  line_number: number
  side: 'DEBIT' | 'CREDIT'
  account_id: string
  amount: number
  accounts: { id: string; name: string; parent_id: string | null } | null
}

type CsvJournalEntry = {
  id: string
  date: string
  description: string
  reference_number: number | null
  supplement: string | null
  is_opening_balance: boolean
  journal_lines: CsvJournalLine[]
}

export function buildJournalsCsv(
  entries: CsvJournalEntry[],
  accounts: CsvAccount[]
): string {
  function resolveAccountNames(
    line: CsvJournalLine | null
  ): { parentName: string; subName: string } {
    if (!line?.accounts) return { parentName: '', subName: '' }
    const account = line.accounts
    if (account.parent_id) {
      const parent = accounts.find(a => a.id === account.parent_id)
      return { parentName: parent?.name ?? '', subName: account.name }
    }
    return { parentName: account.name, subName: '' }
  }

  type DisplayRow = {
    entry: CsvJournalEntry
    debitLine: CsvJournalLine | null
    creditLine: CsvJournalLine | null
  }

  const allRows: DisplayRow[] = entries.flatMap(entry => {
    const debitLines = entry.journal_lines
      .filter(l => l.side === 'DEBIT')
      .sort((a, b) => a.line_number - b.line_number)
    const creditLines = entry.journal_lines
      .filter(l => l.side === 'CREDIT')
      .sort((a, b) => a.line_number - b.line_number)
    const rowCount = Math.max(debitLines.length, creditLines.length, 1)
    return Array.from({ length: rowCount }, (_, i) => ({
      entry,
      debitLine: debitLines[i] ?? null,
      creditLine: creditLines[i] ?? null,
    }))
  })

  const csvRows = allRows.map(row => {
    const debit = resolveAccountNames(row.debitLine)
    const credit = resolveAccountNames(row.creditLine)
    return [
      formatDateSlash(row.entry.date),
      String(row.entry.reference_number ?? ''),
      row.entry.description,
      row.entry.supplement ?? '',
      debit.parentName,
      debit.subName,
      row.debitLine ? String(row.debitLine.amount) : '',
      credit.parentName,
      credit.subName,
      row.creditLine ? String(row.creditLine.amount) : '',
    ]
  })

  const headers = [
    '日付', '伝票番号', '摘要', '補足',
    '借方科目', '借方補助科目', '借方金額',
    '貸方科目', '貸方補助科目', '貸方金額',
  ]

  return buildCsv(headers, csvRows)
}

export function exportJournalsToCsv(
  entries: CsvJournalEntry[],
  accounts: CsvAccount[]
): void {
  downloadCsv(buildJournalsCsv(entries, accounts), `journals_${todayYYYYMMDD()}.csv`)
}
