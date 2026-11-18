import { describe, expect, it } from 'vitest'
import { PostgrestError } from '@supabase/supabase-js'
import { translateSupabaseError as translate } from '@/lib/supabase-error-handler'
import { ConflictError, DatabaseError, ERROR_CODES, ValidationError } from '@/lib/errors'

const translateSupabaseError = (error: { name: string; code: string; message: string; details: string; hint: string }) =>
  translate(new PostgrestError(error))

describe('会社に関するエラー変換', () => {
  it.each(['COMPANY_MISMATCH', 'INVALID_COMPANY', 'COMPANY_KIND_IMMUTABLE', 'COMPANY_ID_IMMUTABLE', 'INVALID_ACCOUNT_HIERARCHY', 'INVALID_CARRY_FORWARD_ACCOUNT'] as const)('P0001 %s の日本語・DETAIL', code => {
    const error = { name: 'PostgrestError', code: 'P0001', message: code, details: '会社の補足', hint: '' }
    expect(translateSupabaseError(error)).toMatchObject({ code, message: `${ERROR_CODES[code].message}（会社の補足）` })
    expect(translateSupabaseError({ ...error, details: '' }).message).toBe(ERROR_CODES[code].message)
  })
  it.each(['message', 'details'] as const)('制約名の場所 %s', field => {
    for (const [constraint, code] of [
      ['companies_name_key', 'DUPLICATE_COMPANY_NAME'], ['accounts_company_code_key', 'DUPLICATE_ACCOUNT_CODE'],
      ['accounts_code_key', 'DUPLICATE_ACCOUNT_CODE'], ['unknown_unique', 'DUPLICATE_ACCOUNT_CODE'],
      ['uq_journal_entries_period_reference_number companies_name_key', 'DUPLICATE_REFERENCE_NUMBER'],
    ] as const) {
      const error = { name: 'PostgrestError', code: '23505', message: '', details: '', hint: '', [field]: `constraint "${constraint}"` }
      expect(translateSupabaseError(error).code).toBe(code)
    }
    for (const constraint of ['journal_entries_period_id_fkey', 'journal_lines_entry_id_fkey', 'journal_template_lines_template_id_fkey']) {
      expect(translateSupabaseError({ name: 'PostgrestError', code: '23503', message: '', details: '', hint: '', [field]: constraint })).toMatchObject({
        code: 'REFERENCE_NOT_FOUND_OR_OTHER_COMPANY', message: ERROR_CODES.REFERENCE_NOT_FOUND_OR_OTHER_COMPANY.message,
      })
    }
    for (const constraint of ['journal_lines_account_id_fkey', 'import_staging_predicted_account_id_fkey', 'import_staging_counter_account_id_fkey', 'import_staging_debit_sub_account_id_fkey', 'import_staging_credit_sub_account_id_fkey', 'mapping_rules_account_id_fkey', 'journal_template_lines_account_id_fkey', 'accounts_parent_id_fkey', 'unknown_fk']) {
      expect(translateSupabaseError({ name: 'PostgrestError', code: '23503', message: '', details: '', hint: '', [field]: constraint }).code).toBe('ACCOUNT_NOT_FOUND')
    }
  })
})

describe('伝票番号のエラー変換', () => {
  it.each(['DUPLICATE_REFERENCE_NUMBER', 'INVALID_REFERENCE_NUMBER', 'ENTRY_PERIOD_CHANGED'] as const)(
    'P0001 %s は日本語と DETAIL を表示する', code => {
      const result = translateSupabaseError({ name: 'PostgrestError', code: 'P0001', message: code, details: '2行目: 補足', hint: '' })
      expect(result).toBeInstanceOf(ValidationError)
      expect(result.code).toBe(code)
      expect(result.message).toBe(`${ERROR_CODES[code].message}（2行目: 補足）`)
      expect(result.details).toContain('2行目: 補足')
      const noDetail = translateSupabaseError({ name: 'PostgrestError', code: 'P0001', message: code, details: '', hint: '' })
      expect(noDetail.message).toBe(ERROR_CODES[code].message)
    })

  it.each(['message', 'details'] as const)('23505 の %s に伝票番号の一意制約名がある', field => {
    const error = { name: 'PostgrestError', code: '23505', message: 'duplicate key value violates unique constraint', details: 'Key (period_id, reference_number)=(p, 7) already exists.', hint: '' }
    error[field] += ' "uq_journal_entries_period_reference_number"'
    const result = translateSupabaseError(error)
    expect(result).toBeInstanceOf(ValidationError)
    expect(result.code).toBe('DUPLICATE_REFERENCE_NUMBER')
    expect(result.message).toBe(ERROR_CODES.DUPLICATE_REFERENCE_NUMBER.message)
  })

  it('既存の科目コード 23505 は従来どおり', () => {
    const result = translateSupabaseError({ name: 'PostgrestError', code: '23505', message: 'duplicate key value violates unique constraint "accounts_code_key"', details: 'Key (code)=(100) already exists.', hint: '' })
    expect(result).toBeInstanceOf(ConflictError)
    expect(result.code).toBe('DUPLICATE_ACCOUNT_CODE')
  })

  it.each(['message', 'details'] as const)('23514 の %s に伝票番号の範囲制約名がある', field => {
    const error = { name: 'PostgrestError', code: '23514', message: 'new row for relation "journal_entries" violates check constraint', details: 'Failing row contains (...).', hint: '' }
    error[field] += ' "journal_entries_reference_number_range"'
    const result = translateSupabaseError(error)
    expect(result).toBeInstanceOf(ValidationError)
    expect(result.code).toBe('INVALID_REFERENCE_NUMBER')
  })

  it('他の CHECK 違反を伝票番号のエラーにしない', () => {
    expect(translateSupabaseError({ name: 'PostgrestError', code: '23514', message: 'other_check', details: '', hint: '' })).toBeInstanceOf(DatabaseError)
  })
})
