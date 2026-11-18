import { beforeEach, describe, expect, it, vi } from 'vitest'
import { companyDb } from './helpers/company-supabase'
const { setCookie } = vi.hoisted(() => ({ setCookie: vi.fn() }))
let fixture: ReturnType<typeof companyDb>
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => fixture.client.from(table) } }))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: setCookie }) }))
import { setActiveCompany } from '@/actions/company-actions'

beforeEach(() => {
  setCookie.mockClear()
  fixture = companyDb({ companies: [{ id: 'a', name: 'A社' }, { id: 'b', name: 'B社' }] })
})
describe('会社 cookie の設定', () => {
  it('存在する会社だけを設定する', async () => {
    await setActiveCompany('b')
    expect(setCookie).toHaveBeenCalledWith('sa_company_id', 'b', { path: '/', maxAge: 31536000, sameSite: 'lax', httpOnly: false })
  })
  it('存在しない会社・DBエラーでは cookie を変更しない', async () => {
    await expect(setActiveCompany('missing')).rejects.toThrow('会社が見つかりません')
    fixture.failWith(() => '読取失敗')
    await expect(setActiveCompany('a')).rejects.toThrow('会社が見つかりません')
    expect(setCookie).not.toHaveBeenCalled()
  })
})
