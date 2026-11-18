import { supabase } from './supabase'
import { normalizeOpeningBalance } from './account-balance'
import { normalizeAmountText } from './csv-amount'
import { assertActiveCompany } from './company-guard'
import { getCompanyIdByPeriod } from './company-scope'
import { ConflictError, ERROR_CODES, ValidationError } from './errors'
import { translateSupabaseError } from './supabase-error-handler'
import { readAllPages } from './report-pagination'
import { BS_CATEGORY_LABELS } from './financial-statement-calculations'
import { INDIVIDUAL_BS_LABELS } from './individual-financial-statements'
import type { Company } from './company'
import type { PostgrestError } from '@supabase/supabase-js'

export type OpeningAccount = {
  id: string; code: string; name: string; type: string; bs_category: string | null; parent_id: string | null
}
export type OpeningLine = { account_id: string; balance: string }
export type OpeningBalanceState = {
  companyId: string; kind: Company['kind']; carryForwardAccountId: string | null; carryForwardAccountName: string | null
  manualSet: { id: string; memo: string | null } | null; manualLines: OpeningLine[]; derivedLines: OpeningLine[]; accounts: OpeningAccount[]
}

export function eligibleOpeningAccounts(accounts: readonly OpeningAccount[], kind: Company['kind']): OpeningAccount[] {
  return accounts.filter(account => ['ASSET', 'LIABILITY', 'EQUITY'].includes(account.type) && account.bs_category !== null &&
    (kind !== 'INDIVIDUAL' || !['OWNER_DRAWINGS', 'OWNER_CONTRIBUTIONS'].includes(account.bs_category)))
}

export function buildOpeningRows(accounts: readonly OpeningAccount[], kind: Company['kind']) {
  const eligible = eligibleOpeningAccounts(accounts, kind)
  const labels = kind === 'INDIVIDUAL' ? INDIVIDUAL_BS_LABELS : BS_CATEGORY_LABELS
  const sorted = [...eligible].sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id))
  // 財務諸表と同じ区分順。補助はコードにかかわらず親の直下に置く。
  return Object.entries(labels).map(([category, label]) => {
    const rows: (OpeningAccount & { depth: number })[] = []
    const seen = new Set<string>()
    const append = (account: OpeningAccount, depth: number) => {
      if (seen.has(account.id)) return
      seen.add(account.id)
      rows.push({ ...account, depth })
      sorted.filter(child => child.parent_id === account.id && child.bs_category === category).forEach(child => append(child, depth + 1))
    }
    const members = sorted.filter(account => account.bs_category === category)
    members.filter(account => !members.some(parent => parent.id === account.parent_id)).forEach(account => append(account, 0))
    members.forEach(account => append(account, 0))
    return { category, label, rows }
  }).filter(group => group.rows.length > 0)
}

export function centsToAmount(cents: bigint): string {
  const magnitude = cents < BigInt(0) ? -cents : cents
  return `${cents < BigInt(0) ? '-' : ''}${magnitude / BigInt(100)}.${String(magnitude % BigInt(100)).padStart(2, '0')}`
}

export function parseOpeningAmount(text: string): { ok: true; cents: bigint; value: string } | { ok: false; message: string } {
  const normalized = normalizeAmountText(text, true)
  if (normalized === '') return { ok: true, cents: BigInt(0), value: '0.00' }
  if (!/^-?[0-9]{1,13}(\.[0-9]{1,2})?$/.test(normalized)) {
    return { ok: false, message: '金額は13桁以内・小数第2位までの数で入力してください（負数可）' }
  }
  const [integer, fraction = ''] = normalized.replace(/^-/, '').split('.')
  const magnitude = BigInt(integer) * BigInt(100) + BigInt(fraction.padEnd(2, '0'))
  const cents = normalized.startsWith('-') ? -magnitude : magnitude
  return { ok: true, cents, value: centsToAmount(cents) }
}

function amountCents(text: string): bigint {
  // 導出・合計・差は入力の13桁を超えうる。入力の上限検証とは分ける。
  if (!/^-?[0-9]+(\.[0-9]{1,2})?$/.test(text)) throw new ValidationError(ERROR_CODES.OPENING_BALANCE_INVALID_LINES.code, ERROR_CODES.OPENING_BALANCE_INVALID_LINES.message)
  const [integer, fraction = ''] = text.replace(/^-/, '').split('.')
  const cents = BigInt(integer) * BigInt(100) + BigInt(fraction.padEnd(2, '0'))
  return text.startsWith('-') ? -cents : cents
}

/** 正常残高方向の変換は逆変換も同じ。符号の定義はnormalizeOpeningBalanceだけに置く。 */
export function convertOpeningBalance(amount: string, type: string): string {
  return centsToAmount(amountCents(amount) * BigInt(normalizeOpeningBalance(1, type)))
}

export function openingInputValues(accounts: readonly OpeningAccount[], lines: readonly OpeningLine[]): Record<string, string> {
  const values = new Map(lines.map(line => [line.account_id, line.balance]))
  return Object.fromEntries(accounts.map(account => [account.id, convertOpeningBalance(values.get(account.id) ?? '0', account.type)]))
}

export function buildOpeningLines(accounts: readonly OpeningAccount[], inputs: Readonly<Record<string, string>>) {
  const errors: Record<string, string> = {}
  const lines: OpeningLine[] = []
  for (const account of accounts) {
    const parsed = parseOpeningAmount(inputs[account.id] ?? '')
    if (!parsed.ok) { errors[account.id] = parsed.message; continue }
    if (parsed.cents !== BigInt(0)) lines.push({ account_id: account.id, balance: convertOpeningBalance(parsed.value, account.type) })
  }
  return { lines, errors, valid: Object.keys(errors).length === 0 }
}

export function openingTotals(lines: readonly OpeningLine[]) {
  let debit = BigInt(0), credit = BigInt(0)
  for (const line of lines) {
    const cents = amountCents(line.balance)
    if (cents > BigInt(0)) debit += cents
    else credit -= cents
  }
  return { debit: centsToAmount(debit), credit: centsToAmount(credit), difference: centsToAmount(debit - credit), balanced: debit === credit }
}

export function openingDifferences(manual: readonly OpeningLine[], derived: readonly OpeningLine[]) {
  const differences = new Map<string, bigint>()
  for (const line of manual) differences.set(line.account_id, (differences.get(line.account_id) ?? BigInt(0)) + amountCents(line.balance))
  for (const line of derived) differences.set(line.account_id, (differences.get(line.account_id) ?? BigInt(0)) - amountCents(line.balance))
  return { byAccount: new Map([...differences].map(([id, value]) => [id, centsToAmount(value)])), count: [...differences.values()].filter(value => value !== BigInt(0)).length }
}

export function openingSaveDecision(valid: boolean, lines: readonly OpeningLine[]): 'invalid' | 'confirm' | 'save' {
  return !valid ? 'invalid' : openingTotals(lines).balanced ? 'save' : 'confirm'
}

function assertTargetCompany(expected: string, actual: string) {
  if (expected !== actual) throw new ConflictError(ERROR_CODES.COMPANY_MISMATCH.code, ERROR_CODES.COMPANY_MISMATCH.message)
}

function decodeLines(data: unknown): OpeningLine[] {
  if (!Array.isArray(data)) throw new Error('期首残高の取得結果が不正です')
  return data.map((line: unknown) => {
    if (typeof line !== 'object' || line === null || !('account_id' in line) || typeof line.account_id !== 'string' ||
      !('balance' in line) || !['string', 'number'].includes(typeof line.balance)) throw new Error('期首残高の取得結果が不正です')
    try { return { account_id: line.account_id, balance: centsToAmount(amountCents(String(line.balance))) } }
    catch { throw new Error('期首残高の取得結果が不正です') }
  })
}

function readOpeningPages<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>) {
  return readAllPages<T>(async (from, to) => {
    const result = await read(from, to)
    if (result.error) throw translateSupabaseError(result.error)
    return result
  })
}

export async function fetchOpeningBalanceState(periodId: string): Promise<OpeningBalanceState> {
  const companyId = await getCompanyIdByPeriod(periodId)
  assertActiveCompany(companyId)
  const [companyResult, setsResult, accounts] = await Promise.all([
    supabase.from('companies').select('kind, carry_forward_account_id').eq('id', companyId).single(),
    supabase.from('period_opening_balance_sets').select('id, memo').eq('company_id', companyId).eq('period_id', periodId).limit(1),
    readOpeningPages<OpeningAccount>((from, to) => supabase.from('accounts').select('id, code, name, type, bs_category, parent_id').eq('company_id', companyId).order('code').order('id').range(from, to)),
  ])
  if (companyResult.error) throw translateSupabaseError(companyResult.error)
  if (setsResult.error) throw translateSupabaseError(setsResult.error)
  const company = companyResult.data
  if (!company || !['CORPORATION', 'INDIVIDUAL'].includes(company.kind)) throw new Error('会社の区分を取得できませんでした')
  assertActiveCompany(companyId)
  const derived = await supabase.rpc('get_derived_opening_balances_for_period', { target_period_id: periodId })
  if (derived.error) throw translateSupabaseError(derived.error)
  const manualSet = setsResult.data?.[0] as OpeningBalanceState['manualSet'] ?? null
  const manualLines = manualSet ? await readOpeningPages<OpeningLine>((from, to) => supabase.from('period_opening_balance_lines').select('account_id, balance').eq('company_id', companyId).eq('period_id', periodId).order('account_id').range(from, to)) : []
  assertActiveCompany(companyId)
  return { companyId, kind: company.kind, carryForwardAccountId: company.carry_forward_account_id,
    carryForwardAccountName: accounts.find(account => account.id === company.carry_forward_account_id)?.name ?? null,
    manualSet, manualLines: decodeLines(manualLines), derivedLines: decodeLines(derived.data), accounts: eligibleOpeningAccounts(accounts, company.kind) }
}

export async function saveOpeningBalances(input: { companyId: string; periodId: string; lines: readonly OpeningLine[]; memo?: string | null; autoBalance: boolean }) {
  assertActiveCompany(input.companyId)
  assertTargetCompany(input.companyId, await getCompanyIdByPeriod(input.periodId))
  assertActiveCompany(input.companyId)
  const lines = input.lines.map(line => {
    const parsed = parseOpeningAmount(line.balance)
    if (!parsed.ok) throw new ValidationError(ERROR_CODES.OPENING_BALANCE_INVALID_LINES.code, ERROR_CODES.OPENING_BALANCE_INVALID_LINES.message)
    return { account_id: line.account_id, balance: parsed.value }
  }).filter(line => line.balance !== '0.00')
  if (typeof input.autoBalance !== 'boolean') throw new ValidationError(ERROR_CODES.OPENING_BALANCE_INVALID_LINES.code, ERROR_CODES.OPENING_BALANCE_INVALID_LINES.message)
  const { data, error } = await supabase.rpc('save_period_opening_balances', { p_period_id: input.periodId, p_lines: lines, p_memo: input.memo ?? null, p_auto_balance: input.autoBalance })
  if (error) throw translateSupabaseError(error)
  if (typeof data !== 'object' || data === null || data.period_id !== input.periodId || !Number.isInteger(data.line_count) || data.line_count < 0 ||
    typeof data.auto_balanced !== 'boolean' || !['number', 'string'].includes(typeof data.adjustment) || !parseOpeningAmount(String(data.adjustment)).ok) {
    throw new Error('期首残高保存RPCの戻り値が不正です。再読み込みして保存結果を確認してください')
  }
  return data as { period_id: string; line_count: number; auto_balanced: boolean; adjustment: string | number }
}

export async function clearOpeningBalances(input: { companyId: string; periodId: string }): Promise<void> {
  assertActiveCompany(input.companyId)
  assertTargetCompany(input.companyId, await getCompanyIdByPeriod(input.periodId))
  assertActiveCompany(input.companyId)
  const { data, error } = await supabase.rpc('clear_period_opening_balances', { p_period_id: input.periodId })
  if (error) throw translateSupabaseError(error)
  if (data !== null && data !== undefined) throw new Error('期首残高解除RPCの戻り値が不正です。再読み込みして解除結果を確認してください')
}
