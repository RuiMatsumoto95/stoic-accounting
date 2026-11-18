import { beforeEach, expect, it, vi } from 'vitest'
import { PostgrestError } from '@supabase/supabase-js'
const mocks = vi.hoisted(() => ({ from: vi.fn(), update: vi.fn(), result: { data: { id: 'cash' } as { id: string } | null, error: null as unknown } }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }))
vi.mock('@/lib/company-guard', () => ({ assertActiveCompany: vi.fn() }))
import { saveAccountMaster, type AccountWithAliases } from '@/lib/account-master'
import { ERROR_CODES } from '@/lib/errors'

const cash: AccountWithAliases = { id: 'cash', company_id: 'a', code: '100', name: '現金', type: 'ASSET', parent_id: null, default_tax_code: null, bs_category: 'CURRENT_ASSETS', pl_category: null, account_aliases: [] }
const input = { company: { id: 'a', kind: 'CORPORATION' as const }, form: { code: '100', name: '名前だけ変更', type: 'ASSET' as const, parent_id: '', default_tax_code: 'none', bs_category: 'CURRENT_ASSETS', pl_category: '' }, code: '100', editTarget: cash, aliases: [] }
beforeEach(() => {
  vi.clearAllMocks(); mocks.result = { data: { id: 'cash' }, error: null }
  const query = { update: mocks.update, eq: () => query, select: () => query, single: async () => mocks.result }
  mocks.update.mockReturnValue(query); mocks.from.mockReturnValue(query)
})
it('区分・親の変更をDBが拒否したとき、日本語とDETAILを上位画面へ渡す', async () => {
  mocks.result = { data: null, error: new PostgrestError({ code: 'P0001', message: 'ACCOUNT_IN_CLOSED_PERIOD', details: '期2025で使用しています', hint: '' }) }
  await expect(saveAccountMaster({ ...input, form: { ...input.form, bs_category: 'FIXED_ASSETS' } })).rejects.toMatchObject({ code: 'ACCOUNT_IN_CLOSED_PERIOD', message: `${ERROR_CODES.ACCOUNT_IN_CLOSED_PERIOD.message}（期2025で使用しています）` })
  expect(mocks.from).toHaveBeenCalledOnce()
})
it('名前だけの変更は従来どおりDBへ送り、同じ区分・親もそのまま送る', async () => {
  expect(await saveAccountMaster(input)).toBe('cash')
  expect(mocks.update).toHaveBeenCalledWith({ code: '100', name: '名前だけ変更', default_tax_code: null, type: 'ASSET', parent_id: null, bs_category: 'CURRENT_ASSETS', pl_category: null })
})
