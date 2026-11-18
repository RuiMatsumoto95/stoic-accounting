import { getReportPeriod, assertReportAccount } from './scope'
import { getCompanyIdByPeriod } from '@/lib/company-scope'
import { supabase } from '@/lib/supabase'
import { getAllTaxCodes, type TaxCode } from '@/lib/tax-codes'

export function resolveTaxCodeLabel(
  taxCodes: readonly Pick<TaxCode, 'id' | 'short_name' | 'name'>[],
  id: string | null
): string | null {
  if (id === null) return null
  const found = taxCodes.find(code => code.id === id)
  return found?.short_name ?? found?.name ?? id
}

export type JournalDisplayRow = {
  isFirstRow: boolean
  isLastRowOfEntry: boolean
  entryId: string
  date: string
  referenceNumber: string | null
  description: string
  isOpeningBalance: boolean
  debitAccountDisplay: string
  debitAmount: number | null
  debitTaxCode: string | null
  creditAccountDisplay: string
  creditAmount: number | null
  creditTaxCode: string | null
}

export interface JournalReport {
  periodName: string
  filters: {
    dateFrom: string
    dateTo: string
    keyword: string
    accountName: string
  }
  rows: JournalDisplayRow[]
}

type SimpleAccount = { id: string; name: string; parent_id: string | null }

type RawLine = {
  id: string
  line_number: number
  side: string
  account_id: string
  amount: number
  tax_code: string | null
  description: string | null
  accounts: { id: string; name: string; parent_id: string | null } | null
}

type RawEntry = {
  id: string
  date: string
  description: string
  reference_number: number | null
  is_opening_balance: boolean
  journal_lines: RawLine[]
}

function formatAccountDisplay(
  lineAccount: { id: string; name: string; parent_id: string | null } | null,
  accountMap: Map<string, SimpleAccount>
): string {
  if (!lineAccount) return ''
  if (lineAccount.parent_id === null) return lineAccount.name
  const parent = accountMap.get(lineAccount.parent_id)
  return parent ? `${parent.name}/${lineAccount.name}` : lineAccount.name
}

export async function getJournalReport({
  periodId,
  periodName,
  dateFrom = '',
  dateTo = '',
  keyword = '',
  accountId = '',
  amountMin = '',
  amountMax = '',
}: {
  periodId: string
  periodName: string
  dateFrom?: string
  dateTo?: string
  keyword?: string
  accountId?: string
  amountMin?: string
  amountMax?: string
}): Promise<JournalReport> {
  const companyId = await getCompanyIdByPeriod(periodId)
  periodName = (await getReportPeriod(periodId)).name
  const taxCodes = await getAllTaxCodes()

  // 全科目を取得（科目名解決・補助科目展開に使用）
  const { data: accountsData, error: accountsError } = await supabase
    .from('accounts')
    .select('id, name, parent_id').eq('company_id', companyId)
    .order('code', { ascending: true })

  if (accountsError) throw new Error(accountsError.message)

  const allAccounts: SimpleAccount[] = accountsData ?? []
  const accountMap = new Map<string, SimpleAccount>(allAccounts.map(a => [a.id, a]))

  // 絞り込み科目IDの解決（親科目指定 → 補助科目も含める）
  let targetAccountIds: string[] = []
  let accountName = ''
  if (accountId) {
    const selected = allAccounts.find(a => a.id === accountId)
    assertReportAccount(companyId, selected ? { company_id: companyId } : null)
    if (selected) {
      if (selected.parent_id === null) {
        const subIds = allAccounts.filter(a => a.parent_id === accountId).map(a => a.id)
        targetAccountIds = [accountId, ...subIds]
        accountName = selected.name
      } else {
        targetAccountIds = [accountId]
        const parent = allAccounts.find(a => a.id === selected.parent_id)
        accountName = parent ? `${parent.name}/${selected.name}` : selected.name
      }
    }
  }

  // journal_entries クエリ
  let query = supabase
    .from('journal_entries')
    .select(`
      id,
      date,
      description,
      reference_number,
      is_opening_balance,
      journal_lines (
        id,
        line_number,
        side,
        account_id,
        amount,
        tax_code,
        description,
        accounts (
          id,
          name,
          parent_id
        )
      )
    `)
    .eq('period_id', periodId)

  if (dateFrom) query = query.gte('date', dateFrom)
  if (dateTo)   query = query.lte('date', dateTo)
  if (keyword)  query = query.ilike('description', `%${keyword}%`)

  // 金額・科目条件がある場合は journal_lines で entry_id を絞り込む
  if (amountMin || amountMax || targetAccountIds.length > 0) {
    let linesQuery = supabase.from('journal_lines').select('entry_id').eq('company_id', companyId)
    if (amountMin) linesQuery = linesQuery.gte('amount', Number(amountMin))
    if (amountMax) linesQuery = linesQuery.lte('amount', Number(amountMax))
    if (targetAccountIds.length > 0) {
      linesQuery = linesQuery.in('account_id', targetAccountIds)
    }

    const { data: matchedLines, error: linesError } = await linesQuery
    if (linesError) throw new Error(linesError.message)
    const matchedEntryIds = [
      ...new Set(
        ((matchedLines ?? []) as unknown as { entry_id: string }[]).map(l => l.entry_id)
      ),
    ]

    if (matchedEntryIds.length === 0) {
      return { periodName, filters: { dateFrom, dateTo, keyword, accountName }, rows: [] }
    }

    query = query.in('id', matchedEntryIds)
  }

  const { data: entries, error } = await query
    .order('date', { ascending: true })
    .order('reference_number', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw new Error(error.message)

  // 弥生方式に展開
  const rows: JournalDisplayRow[] = []
  const rawEntries = (entries ?? []) as unknown as RawEntry[]

  for (const entry of rawEntries) {
    const debitLines = entry.journal_lines
      .filter(l => l.side === 'DEBIT')
      .sort((a, b) => a.line_number - b.line_number)
    const creditLines = entry.journal_lines
      .filter(l => l.side === 'CREDIT')
      .sort((a, b) => a.line_number - b.line_number)
    const rowCount = Math.max(debitLines.length, creditLines.length, 1)

    for (let i = 0; i < rowCount; i++) {
      const debitLine = debitLines[i] ?? null
      const creditLine = creditLines[i] ?? null
      rows.push({
        isFirstRow: i === 0,
        isLastRowOfEntry: i === rowCount - 1,
        entryId: entry.id,
        date: entry.date,
        referenceNumber: entry.reference_number === null ? null : String(entry.reference_number),
        description: entry.description,
        isOpeningBalance: entry.is_opening_balance,
        debitAccountDisplay: formatAccountDisplay(debitLine?.accounts ?? null, accountMap),
        debitAmount: debitLine ? Number(debitLine.amount) : null,
        debitTaxCode: resolveTaxCodeLabel(taxCodes, debitLine?.tax_code ?? null),
        creditAccountDisplay: formatAccountDisplay(creditLine?.accounts ?? null, accountMap),
        creditAmount: creditLine ? Number(creditLine.amount) : null,
        creditTaxCode: resolveTaxCodeLabel(taxCodes, creditLine?.tax_code ?? null),
      })
    }
  }

  return { periodName, filters: { dateFrom, dateTo, keyword, accountName }, rows }
}
