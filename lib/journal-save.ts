import { assertActiveCompany } from './company-guard'
// 仕訳の保存は DB 関数（RPC）に集約している。ヘッダーと明細を1トランザクションで保存し、
// 借貸一致・金額・会計期間のチェックは DB 側で行う。
// 実体: supabase/manual-migrations/20261101180000_atomic_journal_save.sql
// 補足: supabase/manual-migrations/20261104180000_add_entry_supplement.sql
//
// ・編集は update_journal_entry の中で「ヘッダー UPDATE → 明細 DELETE → 明細 INSERT」の順に行われる。
//   訂正履歴（journal_entry_logs）は、この順序（ヘッダー UPDATE から始まること）に依存している。
//   journal_entries / journal_lines を直接書き換える保存処理を新たに作らないこと。
// ・画面側の入力チェックは即時フィードバック用。最終判定は DB が行い、エラーは AppError に変換される。

import { supabase } from '@/lib/supabase'
import { ConflictError, ERROR_CODES, ValidationError } from '@/lib/errors'
import { translateSupabaseError } from '@/lib/supabase-error-handler'
import { getCompanyIdByEntry, getCompanyIdByPeriod } from './company-scope'

// 認証・RLSではなく、アプリが意図した会社の対象を操作しているかの確認。
// 対象は各操作につき1回読み、照会中のcookie切替もRPC直前に再照合する。
// 読み取りとRPCは別リクエストであり、DB側の会社ID不変制約も引き続き前提とする。
function assertTargetCompany(expected: string, actual: string): void {
  if (expected !== actual) throw new ConflictError(ERROR_CODES.COMPANY_MISMATCH.code, ERROR_CODES.COMPANY_MISMATCH.message)
}

export type SaveLineInput = {
  side: 'DEBIT' | 'CREDIT'
  account_id: string
  // 入力欄の文字列、または数値。DB には必ず文字列（小数第2位まで）で送る
  amount: string | number
  tax_code?: string | null
}

type EntryFields = {
  companyId: string
  date: string
  description: string
  referenceNumber?: number | null
  supplement?: string | null
  lines: SaveLineInput[]
}

// numeric(15,2) に丸めなしで収まる正の金額だけを許可する。丸め・桁あふれを黙って通さない
const AMOUNT_PATTERN = /^[0-9]{1,13}(\.[0-9]{1,2})?$/

function invalidAmount(lineNumber: number): ValidationError {
  return new ValidationError(
    ERROR_CODES.INVALID_JOURNAL_LINES.code,
    `${ERROR_CODES.INVALID_JOURNAL_LINES.message}（${lineNumber}行目: 金額は小数第2位までの正の数で入力してください）`,
  )
}

export function amountToRpcString(amount: string | number, lineNumber: number): string {
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e13) throw invalidAmount(lineNumber)
    const s = amount.toFixed(2)
    // 小数第3位以下を含む値は丸めて保存せずエラーにする（2桁の文字列から作られた double なら必ず元に戻る）
    if (Number(s) !== amount) throw invalidAmount(lineNumber)
    return s
  }
  const s = amount.trim()
  if (!AMOUNT_PATTERN.test(s) || Number(s) <= 0) throw invalidAmount(lineNumber)
  return s
}

function toRpcLines(lines: SaveLineInput[]) {
  return lines.map((l, i) => ({
    side: l.side,
    account_id: l.account_id,
    amount: amountToRpcString(l.amount, i + 1),
    tax_code: l.tax_code || null,
  }))
}

/** 新規仕訳を保存し、DB で確定した ID と伝票番号を返す */
export async function createJournalEntry(input: EntryFields & { periodId: string }): Promise<{ id: string; referenceNumber: number }> {
  assertActiveCompany(input.companyId)
  assertTargetCompany(input.companyId, await getCompanyIdByPeriod(input.periodId))
  assertActiveCompany(input.companyId)
  const { data, error } = await supabase.rpc('create_journal_entry', {
    p_period_id: input.periodId,
    p_date: input.date,
    p_description: input.description,
    p_reference_number: input.referenceNumber ?? null,
    p_lines: toRpcLines(input.lines),
    p_supplement: input.supplement ?? null,
  })
  if (error) throw translateSupabaseError(error)
  const result: unknown = data
  if (typeof result !== 'object' || result === null ||
      !('id' in result) || typeof result.id !== 'string' || result.id.length === 0 ||
      !('reference_number' in result) || typeof result.reference_number !== 'number' ||
      !Number.isInteger(result.reference_number) || result.reference_number < 1 || result.reference_number > 999999999) {
    throw new Error('仕訳保存RPCの戻り値が不正です。IDと確定した伝票番号を取得できませんでした。')
  }
  return { id: result.id, referenceNumber: result.reference_number }
}

/** 既存仕訳を更新する。referenceNumber の null は「変更しない」（NULL には戻せない）。期首残高は DB が拒否する。 */
export async function updateJournalEntry(input: EntryFields & { entryId: string }): Promise<void> {
  assertActiveCompany(input.companyId)
  assertTargetCompany(input.companyId, await getCompanyIdByEntry(input.entryId))
  assertActiveCompany(input.companyId)
  const { error } = await supabase.rpc('update_journal_entry', {
    p_entry_id: input.entryId,
    p_date: input.date,
    p_description: input.description,
    p_reference_number: input.referenceNumber ?? null,
    p_lines: toRpcLines(input.lines),
    p_supplement: input.supplement ?? null,
  })
  if (error) throw translateSupabaseError(error)
}

/** CSV 取込データ（import_staging）を本登録する。1件でも失敗すれば全件取り消され、登録件数を返す */
export async function importStagingEntries(periodId: string, stagingIds: string[], companyId: string): Promise<number> {
  assertActiveCompany(companyId)
  assertTargetCompany(companyId, await getCompanyIdByPeriod(periodId))
  assertActiveCompany(companyId)
  const { data, error } = await supabase.rpc('import_staging_entries', {
    p_period_id: periodId,
    p_staging_ids: stagingIds,
  })
  if (error) throw translateSupabaseError(error)
  return data as number
}
