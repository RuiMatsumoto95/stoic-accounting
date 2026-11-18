import { describe, expect, it } from 'vitest'
import { PostgrestError } from '@supabase/supabase-js'
import { AccountingError, ERROR_CODES } from '@/lib/errors'
import { translateSupabaseError } from '@/lib/supabase-error-handler'

const codes = ['PERIOD_CLOSED', 'PERIOD_CLOSE_PREVIOUS_OPEN', 'PERIOD_REOPEN_NEXT_CLOSED', 'PERIOD_CLOSE_CHECK_FAILED',
  'ACCOUNT_IN_CLOSED_PERIOD', 'CARRY_FORWARD_LOCKED', 'PERIOD_CLOSED_FIELDS', 'PERIOD_OVERLAPS_CLOSED', 'PERIOD_ALREADY_CLOSED', 'PERIOD_NOT_CLOSED'] as const

describe('年度確定の新10コード', () => {
  it.each(codes)('%sを日本語へ変換し、改行を含むDETAILを保持する', code => {
    const detail = 'E3: 繰越先を確認してください\nE5: 期間が重なっています'
    const result = translateSupabaseError(new PostgrestError({ code: 'P0001', message: code, details: detail, hint: '' }))
    expect(result).toBeInstanceOf(AccountingError)
    expect(result.code).toBe(code)
    expect(result.message).toBe(`${ERROR_CODES[code].message}（${detail}）`)
    expect(result.details).toContain(detail)
  })
  it.each(codes)('%sにDETAILがなくても基本メッセージを表示する', code => {
    expect(translateSupabaseError(new PostgrestError({ code: 'P0001', message: code, details: '', hint: '' })).message).toBe(ERROR_CODES[code].message)
  })
})
