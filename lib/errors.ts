export const ERROR_CODES = {
  PERIOD_CLOSED: { code: 'PERIOD_CLOSED', message: 'この期は確定済みのため、変更できません。変更するには、設定画面で確定を解除してください' },
  PERIOD_CLOSE_PREVIOUS_OPEN: { code: 'PERIOD_CLOSE_PREVIOUS_OPEN', message: '前の期が確定されていません。先に前の期を確定してください' },
  PERIOD_REOPEN_NEXT_CLOSED: { code: 'PERIOD_REOPEN_NEXT_CLOSED', message: '次の期が確定済みです。新しい期から順に解除してください' },
  PERIOD_CLOSE_CHECK_FAILED: { code: 'PERIOD_CLOSE_CHECK_FAILED', message: 'この期は確定できません。次の項目を確認してください' },
  ACCOUNT_IN_CLOSED_PERIOD: { code: 'ACCOUNT_IN_CLOSED_PERIOD', message: '確定済みの期で使われている科目は、区分・親科目を変更できません。変更するには、その期以降の確定を解除してください' },
  CARRY_FORWARD_LOCKED: { code: 'CARRY_FORWARD_LOCKED', message: '確定済みの期がある間は、繰越先を変更できません' },
  PERIOD_CLOSED_FIELDS: { code: 'PERIOD_CLOSED_FIELDS', message: '確定済みの期の期間は変更・削除できません' },
  PERIOD_OVERLAPS_CLOSED: { code: 'PERIOD_OVERLAPS_CLOSED', message: '確定済みの期と重なる、または間に入る期間は設定できません' },
  PERIOD_ALREADY_CLOSED: { code: 'PERIOD_ALREADY_CLOSED', message: 'この期は既に確定されています' },
  PERIOD_NOT_CLOSED: { code: 'PERIOD_NOT_CLOSED', message: 'この期は確定されていません' },
  OPENING_BALANCE_UNBALANCED: { code: 'OPENING_BALANCE_UNBALANCED', message: '期首残高の借方・貸方が一致しません' },
  OPENING_BALANCE_INVALID_LINES: { code: 'OPENING_BALANCE_INVALID_LINES', message: '期首残高の入力内容が不正です（金額は小数第2位までです）' },
  OPENING_BALANCE_INVALID_ACCOUNT: { code: 'OPENING_BALANCE_INVALID_ACCOUNT', message: '期首残高に使えない科目です（財務諸表区分のある資産・負債・純資産に限ります。個人は事業主貸・事業主借を除く）' },
  OPENING_BASE_UNDETERMINED: { code: 'OPENING_BASE_UNDETERMINED', message: '期首残高の基準を決められません（第1期より前の仕訳があります）' },
  CARRY_FORWARD_NOT_SET: { code: 'CARRY_FORWARD_NOT_SET', message: '繰越先の科目が設定されていません（設定画面で設定してください）' },
  OPENING_BALANCE_MANUAL_SET_EXISTS: { code: 'OPENING_BALANCE_MANUAL_SET_EXISTS', message: '期首残高の手動設定を先に解除してください' },
  OPENING_BALANCE_ACCOUNT_IN_USE: { code: 'OPENING_BALANCE_ACCOUNT_IN_USE', message: '期首残高に使われている科目は削除できません' },
  STALE_COMPANY: { code: 'STALE_COMPANY', message: '別のタブで作業中の会社が変更されました。画面を再読み込みしてください' },
  COMPANY_MISMATCH: { code: 'COMPANY_MISMATCH', message: '選択したデータの会社が一致しません。会社を確認してください' },
  INVALID_COMPANY: { code: 'INVALID_COMPANY', message: '会社名・区分・課税方式・会計期間を確認してください' },
  COMPANY_KIND_IMMUTABLE: { code: 'COMPANY_KIND_IMMUTABLE', message: '会社の区分は変更できません' },
  COMPANY_ID_IMMUTABLE: { code: 'COMPANY_ID_IMMUTABLE', message: 'データの所属会社は変更できません' },
  INVALID_ACCOUNT_HIERARCHY: { code: 'INVALID_ACCOUNT_HIERARCHY', message: '勘定科目の親子関係が不正です' },
  INVALID_CARRY_FORWARD_ACCOUNT: { code: 'INVALID_CARRY_FORWARD_ACCOUNT', message: '繰越に使用する勘定科目が不正です' },
  DUPLICATE_COMPANY_NAME: { code: 'DUPLICATE_COMPANY_NAME', message: '同じ名前の会社が既にあります' },
  REFERENCE_NOT_FOUND_OR_OTHER_COMPANY: { code: 'REFERENCE_NOT_FOUND_OR_OTHER_COMPANY', message: '選択した会計期間・仕訳・テンプレートが存在しないか、別の会社のものです。画面を再読み込みして会社を確認してください' },
  DUPLICATE_REFERENCE_NUMBER: { code: 'DUPLICATE_REFERENCE_NUMBER', message: 'この伝票番号は同じ会計期ですでに使われています。' },
  INVALID_REFERENCE_NUMBER: { code: 'INVALID_REFERENCE_NUMBER', message: '伝票番号は1〜999999999の整数で入力してください。' },
  ENTRY_PERIOD_CHANGED: { code: 'ENTRY_PERIOD_CHANGED', message: '仕訳の会計期間が他の操作で変更されました。画面を更新してやり直してください。' },
  // 会計業務
  DEBIT_CREDIT_MISMATCH:          { code: 'DEBIT_CREDIT_MISMATCH',          message: '借方・貸方の金額が一致しません' },
  OPENING_BALANCE_EDIT_FORBIDDEN: { code: 'OPENING_BALANCE_EDIT_FORBIDDEN',  message: '期首残高仕訳は編集・削除できません' },
  OUT_OF_PERIOD:                  { code: 'OUT_OF_PERIOD',                   message: '仕訳日付が会計期間外です' },
  // 仕訳保存 RPC（supabase/manual-migrations/20261101180000_atomic_journal_save.sql）が返すコード
  INVALID_JOURNAL_LINES:          { code: 'INVALID_JOURNAL_LINES',           message: '仕訳の明細が不正です' },
  ENTRY_NOT_FOUND:                { code: 'ENTRY_NOT_FOUND',                 message: '仕訳が見つかりません（他の操作で削除された可能性があります）' },
  INVALID_STAGING_ROWS:           { code: 'INVALID_STAGING_ROWS',            message: '取込データが不正です' },
  INVALID_DATE:                   { code: 'INVALID_DATE',                    message: '日付が不正です' },
  PERIOD_NOT_FOUND:               { code: 'PERIOD_NOT_FOUND',                message: '会計期間が見つかりません' },
  PERIOD_HAS_OUTSIDE_ENTRIES:     { code: 'PERIOD_HAS_OUTSIDE_ENTRIES',      message: '変更後の期間の範囲外になる仕訳があります' },
  // マスタ
  NO_CURRENT_PERIOD:              { code: 'NO_CURRENT_PERIOD',               message: '現在の会計期間が設定されていません' },
  ACCOUNT_NOT_FOUND:              { code: 'ACCOUNT_NOT_FOUND',               message: '勘定科目が見つかりません' },
  // 重複
  DUPLICATE_ACCOUNT_CODE:         { code: 'DUPLICATE_ACCOUNT_CODE',          message: '同じ科目コードが既に存在します' },
  DUPLICATE_TEMPLATE_NAME:        { code: 'DUPLICATE_TEMPLATE_NAME',         message: '同じ名前のテンプレートが既に存在します' },
  // DB
  DB_QUERY_FAILED:                { code: 'DB_QUERY_FAILED',                 message: 'データベース操作に失敗しました' },
  DB_CONNECTION_FAILED:           { code: 'DB_CONNECTION_FAILED',            message: 'データベースに接続できませんでした' },
} as const

export class AppError extends Error {
  code: string
  details?: string
  httpStatus: number

  constructor(code: string, message: string, httpStatus: number, details?: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.message = message
    this.httpStatus = httpStatus
    this.details = details
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class AccountingError extends AppError {
  constructor(code: string, message: string, details?: string) {
    super(code, message, 422, details)
    this.name = 'AccountingError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class ValidationError extends AppError {
  constructor(code: string, message: string, details?: string) {
    super(code, message, 400, details)
    this.name = 'ValidationError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class NotFoundError extends AppError {
  constructor(code: string, message: string, details?: string) {
    super(code, message, 404, details)
    this.name = 'NotFoundError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string, details?: string) {
    super(code, message, 409, details)
    this.name = 'ConflictError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class DatabaseError extends AppError {
  constructor(code: string, message: string, details?: string) {
    super(code, message, 500, details)
    this.name = 'DatabaseError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError
}
