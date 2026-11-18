import { assertActiveCompany, getRegisteredCompanyId } from './company-guard'
import { supabase } from '@/lib/supabase'
import { normalizeText } from '@/lib/account-search'
import { parseCsvAmount } from '@/lib/csv-amount'

// --- Public Types ---

export type StagingRow = {
  id: string
  raw_date: string
  raw_debit_account: string | null
  raw_debit_sub_account: string | null
  raw_debit_tax_code: string | null
  raw_debit_amount: number
  raw_credit_account: string | null
  raw_credit_sub_account: string | null
  raw_credit_tax_code: string | null
  raw_credit_amount: number
  raw_description: string
  predicted_account_id: string | null
  debit_sub_account_id: string | null
  debit_tax_code_id: string | null
  counter_account_id: string | null
  credit_sub_account_id: string | null
  credit_tax_code_id: string | null
  parse_warnings: string[] | null
  is_processed: boolean
}

export type CsvImportError = {
  row: number
  column: string
  value: string
  message: string
}

export type CsvImportWarning = {
  row: number
  column?: string
  value?: string
  message: string
}

// Shape inserted into import_staging (excludes generated 'id')
export type ParsedStagingRow = Omit<StagingRow, 'id'>

// --- Internal DB row types ---

export type ImportAccountRow = {
  id: string
  name: string
  parent_id: string | null
  account_aliases: { normalized_alias: string }[]
}

type TaxCodeRow = {
  id: string
  name: string
  short_name: string | null
}

type MappingRuleRow = {
  keyword: string
  account_id: string
}

// --- Date helpers ---

// 和暦の元号記号 → 西暦との差（西暦 = 差 + 和暦の年）。弥生の出力 CSV は「R.08/04/01」（令和8年4月1日）の形式
const ERA_YEAR_OFFSET: Record<string, number> = { M: 1867, T: 1911, S: 1925, H: 1988, R: 2018 }

// Accepts YYYY-MM-DD, YYYY/MM/DD, YYYY/M/D, YYYYMMDD, and 和暦 (M/T/S/H/R.YY/MM/DD)
// 暦として存在するか（2月30日・元号の境界など）は検証しない。本登録の RPC が日付として読めないものを拒否する
export function normalizeDate(text: string): string | null {
  const t = text.trim()
  const era = t.match(/^([MTSHR])\.(\d{1,2})\/(\d{1,2})\/(\d{1,2})$/i)
  if (era) {
    const eraYear = Number(era[2])
    if (eraYear < 1) return null
    const year = ERA_YEAR_OFFSET[era[1].toUpperCase()] + eraYear
    return `${year}-${era[3].padStart(2, '0')}-${era[4].padStart(2, '0')}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const slash = t.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (slash) {
    return `${slash[1]}-${slash[2].padStart(2, '0')}-${slash[3].padStart(2, '0')}`
  }
  if (/^\d{8}$/.test(t)) {
    return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
  }
  return null
}

// --- Lookup helpers (exported for use by yayoi parser) ---

export function lookupAccount(
  name: string,
  accounts: ImportAccountRow[],
  mappingRules: MappingRuleRow[]
): string | null {
  const normalized = normalizeText(name)

  const byName = accounts.find((a) => normalizeText(a.name) === normalized)
  if (byName) return byName.id

  for (const acc of accounts) {
    if (acc.account_aliases.some((al) => al.normalized_alias === normalized)) return acc.id
  }

  const byRule = mappingRules.find((r) => normalizeText(r.keyword) === normalized)
  if (byRule) return byRule.account_id

  return null
}

export function lookupSubAccount(
  name: string,
  parentId: string,
  accounts: ImportAccountRow[],
  mappingRules: MappingRuleRow[]
): string | null {
  const normalized = normalizeText(name)
  const subs = accounts.filter((a) => a.parent_id === parentId)

  const byName = subs.find((a) => normalizeText(a.name) === normalized)
  if (byName) return byName.id

  const byRule = mappingRules.find((r) => normalizeText(r.keyword) === normalized)
  if (byRule) {
    const matched = subs.find((a) => a.id === byRule.account_id)
    if (matched) return matched.id
  }

  return null
}

export function lookupTaxCode(name: string, taxCodes: TaxCodeRow[]): string | null {
  const normalized = normalizeText(name)
  return (
    taxCodes.find(
      (tc) =>
        normalizeText(tc.id) === normalized ||
        normalizeText(tc.name) === normalized ||
        (tc.short_name != null && normalizeText(tc.short_name) === normalized)
    )?.id ?? null
  )
}

// --- Shared data fetcher (exported for yayoi parser) ---

export async function fetchImportData(companyId = getRegisteredCompanyId()): Promise<{
  accounts: ImportAccountRow[]
  taxCodes: TaxCodeRow[]
  mappingRules: MappingRuleRow[]
}> {
  const [accountsRes, taxCodesRes, rulesRes] = await Promise.all([
    supabase
      .from('accounts')
      .select('id, name, parent_id, account_aliases(normalized_alias)').eq('company_id', companyId),
    supabase.from('tax_codes').select('id, name, short_name').eq('is_current', true),
    supabase.from('mapping_rules').select('keyword, account_id').eq('company_id', companyId),
  ])
  if (accountsRes.error) throw accountsRes.error
  if (taxCodesRes.error) throw taxCodesRes.error
  if (rulesRes.error) throw rulesRes.error

  return {
    accounts: (accountsRes.data ?? []) as ImportAccountRow[],
    taxCodes: (taxCodesRes.data ?? []) as TaxCodeRow[],
    mappingRules: (rulesRes.data ?? []) as MappingRuleRow[],
  }
}

// --- Main parser: 独自形式 ---
// Column order: 日付|借方科目|借方補助|借方税区分|借方金額|貸方科目|貸方補助|貸方税区分|貸方金額|摘要

export async function parseCsvFile(data: string[][], companyId = getRegisteredCompanyId()): Promise<{
  rows: ParsedStagingRow[]
  errors: CsvImportError[]
  warnings: CsvImportWarning[]
}> {
  const { accounts, taxCodes, mappingRules } = await fetchImportData(companyId)

  const rows: ParsedStagingRow[] = []
  const errors: CsvImportError[] = []
  const warnings: CsvImportWarning[] = []

  for (let i = 0; i < data.length; i++) {
    const rowNum = i + 2 // row 1 is header
    const cols = data[i]
    let hasError = false

    const rawDate = (cols[0] ?? '').trim()
    const normalizedDate = normalizeDate(rawDate)
    if (!normalizedDate) {
      errors.push({ row: rowNum, column: '日付', value: rawDate, message: '日付の形式が正しくありません' })
      hasError = true
    }

    const rawDebitAccount = cleanInput(cols[1] ?? '')
    const rawDebitSubAccount = cleanInput(cols[2] ?? '')
    const rawDebitTaxCode = cleanInput(cols[3] ?? '')
    const rawCreditAccount = cleanInput(cols[5] ?? '')
    const rawCreditSubAccount = cleanInput(cols[6] ?? '')
    const rawCreditTaxCode = cleanInput(cols[7] ?? '')
    const rawDescription = cleanInput(cols[9] ?? '')

    const debitResult = parseCsvAmount(cols[4] ?? '')
    const creditResult = parseCsvAmount(cols[8] ?? '')
    let debitAmount = 0
    let creditAmount = 0

    if (!debitResult.ok) {
      errors.push({ row: rowNum, column: '借方金額', value: cols[4] ?? '', message: debitResult.message })
      hasError = true
    } else {
      debitAmount = debitResult.value
    }
    if (!creditResult.ok) {
      errors.push({ row: rowNum, column: '貸方金額', value: cols[8] ?? '', message: creditResult.message })
      hasError = true
    } else {
      creditAmount = creditResult.value
    }
    if (!hasError && debitAmount === 0 && creditAmount === 0) {
      errors.push({
        row: rowNum,
        column: '借方金額',
        value: '0',
        message: '借方金額・貸方金額のどちらかに0より大きい値が必要です',
      })
      hasError = true
    }

    // 借方科目
    let debitAccountId: string | null = null
    if (!rawDebitAccount) {
      errors.push({ row: rowNum, column: '借方科目', value: '', message: '借方科目が空です' })
      hasError = true
    } else {
      debitAccountId = lookupAccount(rawDebitAccount, accounts, mappingRules)
      if (!debitAccountId) {
        errors.push({
          row: rowNum,
          column: '借方科目',
          value: rawDebitAccount,
          message: '科目が見つかりません。置換ルールを登録してください。',
        })
        hasError = true
      }
    }

    // 借方補助科目
    let debitSubAccountId: string | null = null
    if (rawDebitSubAccount && debitAccountId) {
      debitSubAccountId = lookupSubAccount(rawDebitSubAccount, debitAccountId, accounts, mappingRules)
      if (!debitSubAccountId) {
        errors.push({ row: rowNum, column: '借方補助科目', value: rawDebitSubAccount, message: '補助科目が見つかりません' })
        hasError = true
      }
    }

    // 借方税区分
    let debitTaxCodeId: string | null = null
    if (rawDebitTaxCode) {
      debitTaxCodeId = lookupTaxCode(rawDebitTaxCode, taxCodes)
      if (!debitTaxCodeId) {
        errors.push({ row: rowNum, column: '借方税区分', value: rawDebitTaxCode, message: '税区分が見つかりません' })
        hasError = true
      }
    }

    // 貸方科目
    let creditAccountId: string | null = null
    if (!rawCreditAccount) {
      errors.push({ row: rowNum, column: '貸方科目', value: '', message: '貸方科目が空です' })
      hasError = true
    } else {
      creditAccountId = lookupAccount(rawCreditAccount, accounts, mappingRules)
      if (!creditAccountId) {
        errors.push({
          row: rowNum,
          column: '貸方科目',
          value: rawCreditAccount,
          message: '科目が見つかりません。置換ルールを登録してください。',
        })
        hasError = true
      }
    }

    // 貸方補助科目
    let creditSubAccountId: string | null = null
    if (rawCreditSubAccount && creditAccountId) {
      creditSubAccountId = lookupSubAccount(rawCreditSubAccount, creditAccountId, accounts, mappingRules)
      if (!creditSubAccountId) {
        errors.push({ row: rowNum, column: '貸方補助科目', value: rawCreditSubAccount, message: '補助科目が見つかりません' })
        hasError = true
      }
    }

    // 貸方税区分
    let creditTaxCodeId: string | null = null
    if (rawCreditTaxCode) {
      creditTaxCodeId = lookupTaxCode(rawCreditTaxCode, taxCodes)
      if (!creditTaxCodeId) {
        errors.push({ row: rowNum, column: '貸方税区分', value: rawCreditTaxCode, message: '税区分が見つかりません' })
        hasError = true
      }
    }

    if (!hasError) {
      rows.push({
        raw_date: normalizedDate!,
        raw_debit_account: rawDebitAccount,
        raw_debit_sub_account: rawDebitSubAccount,
        raw_debit_tax_code: rawDebitTaxCode,
        raw_debit_amount: debitAmount,
        raw_credit_account: rawCreditAccount,
        raw_credit_sub_account: rawCreditSubAccount,
        raw_credit_tax_code: rawCreditTaxCode,
        raw_credit_amount: creditAmount,
        raw_description: rawDescription,
        predicted_account_id: debitAccountId,
        debit_sub_account_id: debitSubAccountId,
        debit_tax_code_id: debitTaxCodeId,
        counter_account_id: creditAccountId,
        credit_sub_account_id: creditSubAccountId,
        credit_tax_code_id: creditTaxCodeId,
        parse_warnings: [],
        is_processed: false,
      })
    }
  }

  return { rows, errors, warnings }
}

// Trim and normalize whitespace from CSV cell values
function cleanInput(text: string): string {
  return text.replace(/　/g, ' ').replace(/\s+/g, ' ').trim()
}

// --- DB insert ---

export async function insertStagingRows(rows: ParsedStagingRow[], companyId: string): Promise<void> {
  assertActiveCompany(companyId)
  const { error } = await supabase.from('import_staging').insert(
    rows.map((r) => ({
      company_id: companyId,
      raw_date: r.raw_date,
      raw_debit_account: r.raw_debit_account,
      raw_debit_sub_account: r.raw_debit_sub_account,
      raw_debit_tax_code: r.raw_debit_tax_code,
      raw_debit_amount: r.raw_debit_amount,
      raw_credit_account: r.raw_credit_account,
      raw_credit_sub_account: r.raw_credit_sub_account,
      raw_credit_tax_code: r.raw_credit_tax_code,
      raw_credit_amount: r.raw_credit_amount,
      raw_description: r.raw_description,
      predicted_account_id: r.predicted_account_id,
      debit_sub_account_id: r.debit_sub_account_id,
      debit_tax_code_id: r.debit_tax_code_id,
      counter_account_id: r.counter_account_id,
      credit_sub_account_id: r.credit_sub_account_id,
      credit_tax_code_id: r.credit_tax_code_id,
      parse_warnings: r.parse_warnings,
      is_processed: false,
    }))
  )
  if (error) throw error
}
