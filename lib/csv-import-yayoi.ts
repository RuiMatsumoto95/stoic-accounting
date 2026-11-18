import { getRegisteredCompanyId } from './company-guard'
import { ERROR_CODES, ValidationError } from './errors'
import { getTaxMethod } from '@/lib/tax-codes'
import { parseCsvAmount } from '@/lib/csv-amount'
import { resolveYayoiTaxCode } from '@/lib/yayoi-tax'
import {
  fetchImportData,
  lookupAccount,
  lookupSubAccount,
  normalizeDate,
  ParsedStagingRow,
  CsvImportError,
  CsvImportWarning,
} from '@/lib/csv-import'

// --- Yayoi column indices (0-based) ---
// A(0) 識別フラグ  D(3) 日付  E(4) 借方勘定科目  F(5) 借方補助科目
// H(7) 借方税区分  I(8) 借方金額  K(10) 貸方勘定科目  L(11) 貸方補助科目
// N(13) 貸方税区分  O(14) 貸方金額  Q(16) 摘要

// Compound-entry rows to skip with a warning
const COMPOUND_FLAGS = new Set(['2110', '2100', '2101'])

// 単一仕訳として取り込む識別フラグ。2000＝伝票以外の仕訳、2111＝1行の伝票データ（弥生公式サポートの記載。
// 列構成は実サンプルで 2000 と同じことを確認）
const SINGLE_FLAGS = new Set(['2000', '2111'])

// 弥生の出力 CSV には見出し行がないため、既定では先頭のデータ行を 1 行目として行番号を数える
export async function parseYayoiCsvFile(
  data: string[][],
  firstRowNumber = 1,
  companyId = getRegisteredCompanyId(),
): Promise<{
  rows: ParsedStagingRow[]
  errors: CsvImportError[]
  warnings: CsvImportWarning[]
}> {
  if (!companyId) throw new ValidationError(ERROR_CODES.INVALID_COMPANY.code, '会社が選択されていません。会社を選択してからCSVを取り込んでください')
  const [{ accounts, mappingRules }, taxMethod] = await Promise.all([
    fetchImportData(companyId),
    getTaxMethod(companyId),
  ])

  const rows: ParsedStagingRow[] = []
  const errors: CsvImportError[] = []
  const warnings: CsvImportWarning[] = []

  for (let i = 0; i < data.length; i++) {
    const rowNum = i + firstRowNumber
    const cols = data[i]

    const flag = (cols[0] ?? '').trim()

    if (COMPOUND_FLAGS.has(flag)) {
      warnings.push({ row: rowNum, message: '複合仕訳のためスキップしました' })
      continue
    }

    if (!SINGLE_FLAGS.has(flag)) {
      // 黙って捨てると、取り込めなかった行に気づけない
      warnings.push({ row: rowNum, column: '識別フラグ', value: flag, message: '未対応の識別フラグのためスキップしました' })
      continue
    }

    let hasError = false
    const rowWarnings: string[] = []

    const rawDateStr = (cols[3] ?? '').trim()
    const normalizedDate = normalizeDate(rawDateStr)
    if (!normalizedDate) {
      errors.push({ row: rowNum, column: '取引日付', value: rawDateStr, message: '日付の形式が正しくありません' })
      hasError = true
    }

    const rawDebitAccount = (cols[4] ?? '').trim()
    const rawDebitSubAccount = (cols[5] ?? '').trim()
    const rawDebitTaxText = (cols[7] ?? '').trim()
    const rawCreditAccount = (cols[10] ?? '').trim()
    const rawCreditSubAccount = (cols[11] ?? '').trim()
    const rawCreditTaxText = (cols[13] ?? '').trim()
    const rawDescription = (cols[16] ?? '').trim()

    const debitResult = parseCsvAmount(cols[8] ?? '')
    const creditResult = parseCsvAmount(cols[14] ?? '')
    let debitAmount = 0
    let creditAmount = 0

    if (!debitResult.ok) {
      errors.push({ row: rowNum, column: '借方金額', value: cols[8] ?? '', message: debitResult.message })
      hasError = true
    } else {
      debitAmount = debitResult.value
    }
    if (!creditResult.ok) {
      errors.push({ row: rowNum, column: '貸方金額', value: cols[14] ?? '', message: creditResult.message })
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
      errors.push({ row: rowNum, column: '借方勘定科目', value: '', message: '借方科目が空です' })
      hasError = true
    } else {
      debitAccountId = lookupAccount(rawDebitAccount, accounts, mappingRules)
      if (!debitAccountId) {
        errors.push({
          row: rowNum,
          column: '借方勘定科目',
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

    // 借方税区分（弥生→対象会社の課税方式で変換）
    const debitTax = resolveYayoiTaxCode(rawDebitTaxText, taxMethod)
    if (debitTax.warning) {
      rowWarnings.push(`借方税区分「${rawDebitTaxText}」：${debitTax.warning}`)
      warnings.push({ row: rowNum, column: '借方税区分', value: rawDebitTaxText, message: debitTax.warning })
    }

    // 貸方科目
    let creditAccountId: string | null = null
    if (!rawCreditAccount) {
      errors.push({ row: rowNum, column: '貸方勘定科目', value: '', message: '貸方科目が空です' })
      hasError = true
    } else {
      creditAccountId = lookupAccount(rawCreditAccount, accounts, mappingRules)
      if (!creditAccountId) {
        errors.push({
          row: rowNum,
          column: '貸方勘定科目',
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
    const creditTax = resolveYayoiTaxCode(rawCreditTaxText, taxMethod)
    if (creditTax.warning) {
      rowWarnings.push(`貸方税区分「${rawCreditTaxText}」：${creditTax.warning}`)
      warnings.push({ row: rowNum, column: '貸方税区分', value: rawCreditTaxText, message: creditTax.warning })
    }

    if (!hasError) {
      rows.push({
        raw_date: normalizedDate!,
        raw_debit_account: rawDebitAccount,
        raw_debit_sub_account: rawDebitSubAccount,
        raw_debit_tax_code: rawDebitTaxText,
        raw_debit_amount: debitAmount,
        raw_credit_account: rawCreditAccount,
        raw_credit_sub_account: rawCreditSubAccount,
        raw_credit_tax_code: rawCreditTaxText,
        raw_credit_amount: creditAmount,
        raw_description: rawDescription,
        predicted_account_id: debitAccountId,
        debit_sub_account_id: debitSubAccountId,
        debit_tax_code_id: debitTax.id,
        counter_account_id: creditAccountId,
        credit_sub_account_id: creditSubAccountId,
        credit_tax_code_id: creditTax.id,
        parse_warnings: rowWarnings,
        is_processed: false,
      })
    }
  }

  return { rows, errors, warnings }
}
