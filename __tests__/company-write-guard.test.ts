import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { companyDb } from './helpers/company-supabase'
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
import { supabase } from '@/lib/supabase'
import { registerActiveCompany } from '@/lib/company-guard'
import { createJournalEntry, importStagingEntries, updateJournalEntry } from '@/lib/journal-save'
import { insertStagingRows } from '@/lib/csv-import'
import { createTemplate, deleteTemplate, updateTemplate } from '@/lib/journal-templates'
import { updateTaxMethod } from '@/lib/tax-codes'

beforeEach(() => {
  vi.clearAllMocks()
  registerActiveCompany('a')
  vi.stubGlobal('document', { cookie: 'sa_company_id=b' })
})
afterEach(() => { registerActiveCompany(null); vi.unstubAllGlobals() })

describe('書き込み共通関数を古いタブから呼ぶ', () => {
  const entry = { companyId: 'a', date: '2026-01-01', description: '古い画面', lines: [] }
  const template = { name: '古い会社のテンプレート', default_description: null, lines: [] }
  it.each([
    ['新規仕訳RPC', () => createJournalEntry({ ...entry, periodId: 'a-period' })],
    ['更新RPC', () => updateJournalEntry({ ...entry, entryId: 'a-entry' })],
    ['CSV本登録RPC', () => importStagingEntries('a-period', ['a-staging'], 'a')],
    ['CSV staging insert', () => insertStagingRows([], 'a')],
    ['テンプレート作成', () => createTemplate(template, 'a')],
    ['テンプレート更新', () => updateTemplate('a-template', template, 'a')],
    ['テンプレート削除', () => deleteTemplate('a-template', 'a')],
    ['課税方式', () => updateTaxMethod('a', 'EXEMPT')],
  ])('%s は通信前に STALE_COMPANY', async (_, save) => {
    await expect(save()).rejects.toMatchObject({ code: 'STALE_COMPANY' })
    expect(supabase.from).not.toHaveBeenCalled()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it.each(['create', 'update'])('テンプレート %s の途中で切替が起きても対象会社へ明細まで保存する', async mode => {
    document.cookie = 'sa_company_id=a'
    const fixture = companyDb({
      journal_templates: [{ id: 'a-template', company_id: 'a', name: 'A' }, { id: 'b-template', company_id: 'b', name: 'B' }],
      journal_template_lines: [
        { id: 'a-line', template_id: 'a-template', company_id: 'a', account_id: 'a-old' },
        { id: 'b-line', template_id: 'b-template', company_id: 'b', account_id: 'b-old' },
      ],
    })
    fixture.failWith(call => {
      if (call.table === 'journal_templates') document.cookie = 'sa_company_id=b'
      return undefined
    })
    vi.mocked(supabase.from).mockImplementation(table => fixture.client.from(table))
    const input = { ...template, lines: [{ line_number: 1, side: 'DEBIT' as const, account_id: 'a-new', amount: 100, tax_code: null, description: null }] }
    const save = mode === 'create' ? createTemplate(input, 'a') : updateTemplate('a-template', input, 'a')
    await expect(save).resolves.toBeUndefined()
    expect(document.cookie).toBe('sa_company_id=b')
    const templateId = mode === 'create' ? 'created-0' : 'a-template'
    expect(fixture.tables.journal_templates.find(row => row.id === templateId)).toMatchObject({ name: template.name, company_id: 'a' })
    expect(fixture.tables.journal_template_lines.filter(row => row.template_id === templateId)).toEqual([
      expect.objectContaining({ company_id: 'a', template_id: templateId, account_id: 'a-new' }),
    ])
    expect(fixture.tables.journal_templates.find(row => row.id === 'b-template')).toEqual({ id: 'b-template', company_id: 'b', name: 'B' })
    expect(fixture.tables.journal_template_lines.find(row => row.id === 'b-line')).toEqual({ id: 'b-line', template_id: 'b-template', company_id: 'b', account_id: 'b-old' })
    expect(fixture.calls.map(call => call.operation)).toEqual(mode === 'create' ? ['insert', 'insert'] : ['update', 'delete', 'insert'])
  })
})
