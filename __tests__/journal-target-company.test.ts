import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { companyDb } from './helpers/company-supabase'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
let fixture: ReturnType<typeof companyDb>
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => fixture.client.from(table), rpc } }))
import { createJournalEntry, updateJournalEntry, importStagingEntries } from '@/lib/journal-save'
import { registerActiveCompany } from '@/lib/company-guard'
import { ConflictError, ERROR_CODES, NotFoundError } from '@/lib/errors'

beforeEach(() => {
  fixture = companyDb({
    fiscal_periods: [{ id: 'a-period', company_id: 'a' }, { id: 'b-period', company_id: 'b' }],
    journal_entries: [{ id: 'a-entry', company_id: 'a' }, { id: 'b-entry', company_id: 'b' }],
  })
  rpc.mockReset()
  registerActiveCompany('a')
  vi.stubGlobal('document', { cookie: 'sa_company_id=a' })
})
afterEach(() => { registerActiveCompany(null); vi.unstubAllGlobals() })

const fields = { companyId: 'a', date: '2026-01-01', description: '対象照合', lines: [] }
const operations = [
  { name: 'createJournalEntry', table: 'fiscal_periods', suffix: 'period', missingCode: 'PERIOD_NOT_FOUND', rpcName: 'create_journal_entry', result: { id: 'created', reference_number: 1 }, save: (id: string) => createJournalEntry({ ...fields, periodId: id }) },
  { name: 'updateJournalEntry', table: 'journal_entries', suffix: 'entry', missingCode: 'ENTRY_NOT_FOUND', rpcName: 'update_journal_entry', result: null, save: (id: string) => updateJournalEntry({ ...fields, entryId: id }) },
  { name: 'importStagingEntries', table: 'fiscal_periods', suffix: 'period', missingCode: 'PERIOD_NOT_FOUND', rpcName: 'import_staging_entries', result: 2, save: (id: string) => importStagingEntries(id, ['staging-1', 'staging-2'], 'a') },
]

describe.each(operations)('$name の対象会社', operation => {
  it('一致なら1回読み取り、RPCを1回呼ぶ', async () => {
    rpc.mockResolvedValue({ data: operation.result, error: null })
    await operation.save(`a-${operation.suffix}`)
    expect(fixture.calls).toEqual([expect.objectContaining({ table: operation.table, operation: 'read', filters: [['id', 'eq', `a-${operation.suffix}`]] })])
    expect(rpc).toHaveBeenCalledExactlyOnceWith(operation.rpcName, expect.any(Object))
  })
  it('不一致はCOMPANY_MISMATCH、RPCは呼ばない', async () => {
    const result = operation.save(`b-${operation.suffix}`)
    await expect(result).rejects.toBeInstanceOf(ConflictError)
    await expect(result).rejects.toMatchObject(ERROR_CODES.COMPANY_MISMATCH)
    expect(rpc).not.toHaveBeenCalled()
    expect(fixture.calls).toHaveLength(1)
  })
  it('不存在は専用のNotFoundError、RPCは呼ばない', async () => {
    const result = operation.save('missing')
    await expect(result).rejects.toBeInstanceOf(NotFoundError)
    await expect(result).rejects.toMatchObject({ code: operation.missingCode })
    expect(fixture.calls).toHaveLength(1)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('読み取り失敗はそのまま失敗としRPCは呼ばない', async () => {
    fixture.failWith(() => '照会失敗')
    await expect(operation.save(`a-${operation.suffix}`)).rejects.toMatchObject({ message: '照会失敗' })
    expect(fixture.calls).toHaveLength(1)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('対象照会中のcookie切替もRPC直前に拒否する', async () => {
    fixture.failWith(() => { document.cookie = 'sa_company_id=b'; return undefined })
    await expect(operation.save(`a-${operation.suffix}`)).rejects.toMatchObject({ code: 'STALE_COMPANY' })
    expect(fixture.calls).toHaveLength(1)
    expect(rpc).not.toHaveBeenCalled()
  })
})
