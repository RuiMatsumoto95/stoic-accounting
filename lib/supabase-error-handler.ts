import type { PostgrestError } from '@supabase/supabase-js'
import {
  AccountingError,
  AppError,
  ConflictError,
  DatabaseError,
  NotFoundError,
  ValidationError,
  ERROR_CODES,
} from './errors'

// 仕訳保存 RPC / Trigger は RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='<コード>', DETAIL='<補足>' で返す。
// kind: 例外クラスの種類。showDetail: DETAIL が利用者向けの日本語（「2行目: …」など）なので画面に出してよい
const DOMAIN_ERRORS: Record<
  string,
  { def: { code: string; message: string }; kind: 'accounting' | 'validation' | 'notfound'; showDetail: boolean }
> = {
  PERIOD_CLOSED: { def: ERROR_CODES.PERIOD_CLOSED, kind: 'accounting', showDetail: true },
  PERIOD_CLOSE_PREVIOUS_OPEN: { def: ERROR_CODES.PERIOD_CLOSE_PREVIOUS_OPEN, kind: 'accounting', showDetail: true },
  PERIOD_REOPEN_NEXT_CLOSED: { def: ERROR_CODES.PERIOD_REOPEN_NEXT_CLOSED, kind: 'accounting', showDetail: true },
  PERIOD_CLOSE_CHECK_FAILED: { def: ERROR_CODES.PERIOD_CLOSE_CHECK_FAILED, kind: 'accounting', showDetail: true },
  ACCOUNT_IN_CLOSED_PERIOD: { def: ERROR_CODES.ACCOUNT_IN_CLOSED_PERIOD, kind: 'accounting', showDetail: true },
  CARRY_FORWARD_LOCKED: { def: ERROR_CODES.CARRY_FORWARD_LOCKED, kind: 'accounting', showDetail: true },
  PERIOD_CLOSED_FIELDS: { def: ERROR_CODES.PERIOD_CLOSED_FIELDS, kind: 'accounting', showDetail: true },
  PERIOD_OVERLAPS_CLOSED: { def: ERROR_CODES.PERIOD_OVERLAPS_CLOSED, kind: 'accounting', showDetail: true },
  PERIOD_ALREADY_CLOSED: { def: ERROR_CODES.PERIOD_ALREADY_CLOSED, kind: 'accounting', showDetail: true },
  PERIOD_NOT_CLOSED: { def: ERROR_CODES.PERIOD_NOT_CLOSED, kind: 'accounting', showDetail: true },
  OPENING_BALANCE_UNBALANCED: { def: ERROR_CODES.OPENING_BALANCE_UNBALANCED, kind: 'validation', showDetail: true },
  OPENING_BALANCE_INVALID_LINES: { def: ERROR_CODES.OPENING_BALANCE_INVALID_LINES, kind: 'validation', showDetail: true },
  OPENING_BALANCE_INVALID_ACCOUNT: { def: ERROR_CODES.OPENING_BALANCE_INVALID_ACCOUNT, kind: 'validation', showDetail: true },
  OPENING_BASE_UNDETERMINED: { def: ERROR_CODES.OPENING_BASE_UNDETERMINED, kind: 'accounting', showDetail: true },
  CARRY_FORWARD_NOT_SET: { def: ERROR_CODES.CARRY_FORWARD_NOT_SET, kind: 'validation', showDetail: true },
  REFERENCE_NOT_FOUND_OR_OTHER_COMPANY: { def: ERROR_CODES.REFERENCE_NOT_FOUND_OR_OTHER_COMPANY, kind: 'validation', showDetail: true },
  COMPANY_MISMATCH: { def: ERROR_CODES.COMPANY_MISMATCH, kind: 'validation', showDetail: true },
  INVALID_COMPANY: { def: ERROR_CODES.INVALID_COMPANY, kind: 'validation', showDetail: true },
  COMPANY_KIND_IMMUTABLE: { def: ERROR_CODES.COMPANY_KIND_IMMUTABLE, kind: 'validation', showDetail: true },
  COMPANY_ID_IMMUTABLE: { def: ERROR_CODES.COMPANY_ID_IMMUTABLE, kind: 'validation', showDetail: true },
  INVALID_ACCOUNT_HIERARCHY: { def: ERROR_CODES.INVALID_ACCOUNT_HIERARCHY, kind: 'validation', showDetail: true },
  INVALID_CARRY_FORWARD_ACCOUNT: { def: ERROR_CODES.INVALID_CARRY_FORWARD_ACCOUNT, kind: 'validation', showDetail: true },
  DUPLICATE_REFERENCE_NUMBER: { def: ERROR_CODES.DUPLICATE_REFERENCE_NUMBER, kind: 'validation', showDetail: true },
  INVALID_REFERENCE_NUMBER: { def: ERROR_CODES.INVALID_REFERENCE_NUMBER, kind: 'validation', showDetail: true },
  ENTRY_PERIOD_CHANGED: { def: ERROR_CODES.ENTRY_PERIOD_CHANGED, kind: 'validation', showDetail: true },
  DEBIT_CREDIT_MISMATCH:          { def: ERROR_CODES.DEBIT_CREDIT_MISMATCH,          kind: 'accounting', showDetail: true },
  OUT_OF_PERIOD:                  { def: ERROR_CODES.OUT_OF_PERIOD,                  kind: 'accounting', showDetail: true },
  OPENING_BALANCE_EDIT_FORBIDDEN: { def: ERROR_CODES.OPENING_BALANCE_EDIT_FORBIDDEN, kind: 'accounting', showDetail: false },
  PERIOD_HAS_OUTSIDE_ENTRIES:     { def: ERROR_CODES.PERIOD_HAS_OUTSIDE_ENTRIES,     kind: 'accounting', showDetail: true },
  INVALID_JOURNAL_LINES:          { def: ERROR_CODES.INVALID_JOURNAL_LINES,          kind: 'validation', showDetail: true },
  INVALID_STAGING_ROWS:           { def: ERROR_CODES.INVALID_STAGING_ROWS,           kind: 'validation', showDetail: true },
  INVALID_DATE:                   { def: ERROR_CODES.INVALID_DATE,                   kind: 'validation', showDetail: true },
  ENTRY_NOT_FOUND:                { def: ERROR_CODES.ENTRY_NOT_FOUND,                kind: 'notfound',   showDetail: false },
  PERIOD_NOT_FOUND:               { def: ERROR_CODES.PERIOD_NOT_FOUND,               kind: 'notfound',   showDetail: false },
}

export function translateSupabaseError(error: PostgrestError): AppError {
  const details = error.message

  // PostgREST の制約違反は message に制約名、details に Key / Failing row が入る。
  // ラップされたエラーで details に制約名が入る場合も同じように判定する。
  const constraintText = `${error.message} ${error.details ?? ''}`
  const referenceConstraint = error.code === '23505' && constraintText.includes('uq_journal_entries_period_reference_number')
    ? ERROR_CODES.DUPLICATE_REFERENCE_NUMBER
    : error.code === '23514' && constraintText.includes('journal_entries_reference_number_range')
      ? ERROR_CODES.INVALID_REFERENCE_NUMBER
      : null
  if (referenceConstraint) {
    return new ValidationError(referenceConstraint.code, referenceConstraint.message, constraintText)
  }

  if (error.code === 'P0001') {
    const domain = DOMAIN_ERRORS[error.message]
    if (domain) {
      // CSV 本登録などでは DETAIL に行番号つきの理由が入る。画面に出す文言は「基本メッセージ（補足）」の形にする
      const hint = domain.showDetail && error.details ? error.details : undefined
      const message = hint ? `${domain.def.message}（${hint}）` : domain.def.message
      const raw = error.details ? `${error.message}: ${error.details}` : error.message
      if (domain.kind === 'accounting') return new AccountingError(domain.def.code, message, raw)
      if (domain.kind === 'notfound') return new NotFoundError(domain.def.code, message, raw)
      return new ValidationError(domain.def.code, message, raw)
    }
  }

  switch (error.code) {
    case '23505':
      // accounts_company_code_key / 旧 accounts_code_key / 不明時は従来の既定。
      const duplicate = constraintText.includes('companies_name_key')
        ? ERROR_CODES.DUPLICATE_COMPANY_NAME : ERROR_CODES.DUPLICATE_ACCOUNT_CODE
      return new ConflictError(duplicate.code, duplicate.message, details)
    case '23503':
      const openingConstraint = constraintText.includes('period_opening_balance_sets_period_fkey')
        ? ERROR_CODES.OPENING_BALANCE_MANUAL_SET_EXISTS
        : constraintText.includes('period_opening_balance_lines_account_fkey')
          ? ERROR_CODES.OPENING_BALANCE_ACCOUNT_IN_USE : null
      if (openingConstraint) return new ValidationError(openingConstraint.code, openingConstraint.message, details)
      // 23503 だけでは「存在しない」と「他社のもの」を区別できない。
      // 科目列（補助科目・親科目を含む）と不明な制約は従来どおり ACCOUNT_NOT_FOUND。
      const reference = ['journal_entries_period_id_fkey', 'journal_lines_entry_id_fkey', 'journal_template_lines_template_id_fkey']
        .some(name => constraintText.includes(name))
        ? ERROR_CODES.REFERENCE_NOT_FOUND_OR_OTHER_COMPANY : ERROR_CODES.ACCOUNT_NOT_FOUND
      return new ValidationError(reference.code, reference.message, details)
    case '42501':
      return new AppError('PERMISSION_DENIED', '操作する権限がありません', 403, details)
    default:
      return new DatabaseError(
        ERROR_CODES.DB_QUERY_FAILED.code,
        ERROR_CODES.DB_QUERY_FAILED.message,
        details,
      )
  }
}

export function wrapSupabase<T>(result: { data: T | null; error: PostgrestError | null }): T {
  if (result.error) {
    throw translateSupabaseError(result.error)
  }
  if (result.data === null) {
    throw new NotFoundError(
      ERROR_CODES.ACCOUNT_NOT_FOUND.code,
      ERROR_CODES.ACCOUNT_NOT_FOUND.message,
    )
  }
  return result.data
}
