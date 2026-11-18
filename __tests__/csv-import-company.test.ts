import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }))
import { supabase } from '@/lib/supabase'
import { parseYayoiCsvFile } from '@/lib/csv-import-yayoi'
import { registerActiveCompany } from '@/lib/company-guard'

beforeEach(() => { vi.clearAllMocks(); registerActiveCompany(null) })
afterEach(() => registerActiveCompany(null))

describe('弥生CSVの会社ID', () => {
  it.each([null, ''])('会社ID=%j はマスタ・課税方式の照会前に拒否する', async companyId => {
    await expect(parseYayoiCsvFile([], 1, companyId)).rejects.toMatchObject({ code: 'INVALID_COMPANY', message: expect.stringContaining('会社を選択') })
    expect(supabase.from).not.toHaveBeenCalled()
  })
  it('引数と登録会社の両方がない場合も拒否する', async () => {
    await expect(parseYayoiCsvFile([])).rejects.toMatchObject({ code: 'INVALID_COMPANY' })
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
