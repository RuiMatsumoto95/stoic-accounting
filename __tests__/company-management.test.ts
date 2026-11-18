import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PostgrestError } from '@supabase/supabase-js'
import { companyDb } from './helpers/company-supabase'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), setCookie: vi.fn() }))
let fixture: ReturnType<typeof companyDb>
let cookieId: string | undefined
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => fixture.client.from(table), rpc: mocks.rpc } }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => cookieId ? { value: cookieId } : undefined, set: mocks.setCookie }) }))
import { archiveCompany, unarchiveCompany, setActiveCompany, trySetActiveCompany, createCompany } from '@/actions/company-actions'

beforeEach(() => {
  cookieId = 'a'
  mocks.rpc.mockReset()
  mocks.setCookie.mockReset()
  fixture = companyDb({ companies: [
    { id: 'a', name: 'A社', kind: 'CORPORATION', tax_method: 'EXEMPT', is_archived: false },
    { id: 'b', name: 'B個人', kind: 'INDIVIDUAL', tax_method: 'SIMPLE', is_archived: false },
    { id: 'c', name: 'C社', kind: 'CORPORATION', tax_method: 'EXEMPT', is_archived: true },
  ] })
})

describe('会社の作成 Server Action', () => {
  const input = { name: '  新会社  ', kind: 'CORPORATION' as const, taxMethod: 'EXEMPT' as const, startDate: '2026-04-01', endDate: '2027-03-31' }
  it.each(['CORPORATION', 'INDIVIDUAL'] as const)('%s を RPC だけで作成し、切替対象のIDを返す', async kind => {
    mocks.rpc.mockResolvedValue({ data: { company_id: 'new', period_id: 'new-period', account_count: 10 }, error: null })
    const dates = kind === 'INDIVIDUAL' ? { startDate: '2026-01-01', endDate: '2026-12-31' } : {}
    expect(await createCompany({ ...input, ...dates, kind }, 'a')).toEqual({ companyId: 'new' })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('create_company', { p_name: '新会社', p_kind: kind, p_tax_method: 'EXEMPT', p_start_date: dates.startDate ?? input.startDate, p_end_date: dates.endDate ?? input.endDate })
    expect(fixture.calls).toEqual([])
  })
  it('重複名と不正期間を日本語に変換し、DBのDETAILを返す', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new PostgrestError({ code: '23505', message: 'constraint "companies_name_key"', details: '', hint: '' }) })
    expect(await createCompany(input, 'a')).toMatchObject({ code: 'DUPLICATE_COMPANY_NAME', error: '同じ名前の会社が既にあります' })
    mocks.rpc.mockResolvedValue({ data: null, error: new PostgrestError({ code: 'P0001', message: 'INVALID_COMPANY', details: '終了日は開始日以後にしてください', hint: '' }) })
    expect(await createCompany(input, 'a')).toMatchObject({ code: 'INVALID_COMPANY', error: expect.stringContaining('終了日は開始日以後') })
  })
  it('空白名・個人の不正な期・旧会社の画面はRPC前に拒否する', async () => {
    expect((await createCompany({ ...input, name: '  ' }, 'a')).error).toContain('会社名')
    expect((await createCompany({ ...input, kind: 'INDIVIDUAL' }, 'a')).error).toContain('1月1日')
    cookieId = 'b'
    expect(await createCompany(input, 'a')).toMatchObject({ code: 'STALE_COMPANY' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

describe('アーカイブ Server Actions', () => {
  it('選択中の会社を、UIを介さない呼出しでも拒否する', async () => {
    expect((await archiveCompany('a')).error).toContain('選択中')
    expect(fixture.calls).toEqual([])
  })
  it('他社のアーカイブと復元ではフラグだけを変更し、会社名を保持する', async () => {
    expect(await archiveCompany('b')).toEqual({})
    expect(fixture.tables.companies[1]).toMatchObject({ name: 'B個人', is_archived: true, tax_method: 'SIMPLE' })
    expect(fixture.calls[0]).toMatchObject({ table: 'companies', operation: 'update', values: { is_archived: true }, filters: [['id', 'eq', 'b']] })
    expect(await unarchiveCompany('b')).toEqual({})
    expect(fixture.tables.companies[1].is_archived).toBe(false)
  })
  it('アーカイブ済み会社への切替を拒否し、cookieは変更しない', async () => {
    await expect(setActiveCompany('c')).rejects.toThrow('アーカイブ済み')
    expect((await trySetActiveCompany('c')).error).toContain('アーカイブ済み')
    expect(mocks.setCookie).not.toHaveBeenCalled()
  })
  it('全社アーカイブ・cookieなしでも戻せる', async () => {
    cookieId = undefined
    fixture.tables.companies.forEach(row => { row.is_archived = true })
    expect(await unarchiveCompany('b')).toEqual({})
    await setActiveCompany('b')
    expect(mocks.setCookie).toHaveBeenCalledWith('sa_company_id', 'b', expect.any(Object))
  })
  it('不存在・更新失敗を成功扱いにしない', async () => {
    expect((await archiveCompany('missing')).error).toBeTruthy()
    fixture.failWith(() => '更新失敗')
    expect((await unarchiveCompany('c')).error).toBeTruthy()
    expect(fixture.tables.companies[2].is_archived).toBe(true)
  })
})
