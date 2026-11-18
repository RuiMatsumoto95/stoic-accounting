import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { companyDb } from './helpers/company-supabase'
let fixture: ReturnType<typeof companyDb>
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => fixture.client.from(table) } }))
import { createTemplate, updateTemplate } from '@/lib/journal-templates'
import { registerActiveCompany } from '@/lib/company-guard'

beforeEach(() => {
  fixture = companyDb({
    journal_templates: [{ id: 'a-template', company_id: 'a', name: 'A' }, { id: 'b-template', company_id: 'b', name: 'B' }],
    journal_template_lines: [
      { id: 'a-line', company_id: 'a', template_id: 'a-template', line_number: 1, account_id: 'a-old' },
      { id: 'b-line', company_id: 'b', template_id: 'b-template', line_number: 1, account_id: 'b-old' },
    ],
  })
  registerActiveCompany('a')
  vi.stubGlobal('document', { cookie: 'sa_company_id=a' })
})
afterEach(() => { registerActiveCompany(null); vi.unstubAllGlobals() })

const input = { name: '変更後', default_description: null, lines: [{ line_number: 1, side: 'DEBIT' as const, account_id: 'a-new', amount: 100, tax_code: null, description: null }] }

describe('テンプレートは開始時の会社で完了させる', () => {
  it('作成のヘッダー保存中にcookie readerが変わっても明細まで作成する', async () => {
    fixture.failWith(call => {
      if (call.table === 'journal_templates' && call.operation === 'insert') document.cookie = 'sa_company_id=b'
      return undefined
    })
    await createTemplate(input, 'a')
    expect(document.cookie).toBe('sa_company_id=b')
    expect(fixture.tables.journal_templates.at(-1)).toMatchObject({ name: '変更後', company_id: 'a' })
    expect(fixture.tables.journal_template_lines.at(-1)).toMatchObject({ template_id: 'created-0', company_id: 'a', account_id: 'a-new' })
    expect(fixture.calls.map(call => call.operation)).toEqual(['insert', 'insert'])
  })
  it.each(['update', 'delete'] as const)('更新の%s中にcookie readerが変わっても元の会社の明細を書き切る', async changedAt => {
    const otherCompany = structuredClone({ header: fixture.tables.journal_templates[1], line: fixture.tables.journal_template_lines[1] })
    fixture.failWith(call => {
      if (call.operation === changedAt) document.cookie = 'sa_company_id=b'
      return undefined
    })
    await updateTemplate('a-template', input, 'a')
    expect(document.cookie).toBe('sa_company_id=b')
    expect(fixture.tables.journal_templates[0]).toMatchObject({ name: '変更後', company_id: 'a' })
    expect(fixture.tables.journal_template_lines.filter(row => row.company_id === 'a')).toEqual([expect.objectContaining({ template_id: 'a-template', account_id: 'a-new' })])
    expect(fixture.tables.journal_templates[1]).toEqual(otherCompany.header)
    expect(fixture.tables.journal_template_lines.find(row => row.company_id === 'b')).toEqual(otherCompany.line)
    expect(fixture.calls.map(call => call.operation)).toEqual(['update', 'delete', 'insert'])
    for (const call of fixture.calls.filter(call => call.operation === 'update' || call.operation === 'delete')) {
      expect(call.filters).toContainEqual(['company_id', 'eq', 'a'])
    }
  })
  it('削除リクエストが失敗したら明細追加へ進まず元の明細が残る', async () => {
    fixture.failWith(call => call.operation === 'delete' ? '削除失敗' : undefined)
    await expect(updateTemplate('a-template', input, 'a')).rejects.toMatchObject({ message: '削除失敗' })
    expect(fixture.tables.journal_template_lines.find(row => row.id === 'a-line')).toBeDefined()
    expect(fixture.calls.map(call => call.operation)).toEqual(['update', 'delete'])
  })
  it('追加失敗は検出するが、削除済みの明細を復元する原子性はない', async () => {
    fixture.failWith(call => call.operation === 'insert' ? '追加失敗' : undefined)
    await expect(updateTemplate('a-template', input, 'a')).rejects.toMatchObject({ message: '追加失敗' })
    expect(fixture.tables.journal_template_lines.some(row => row.company_id === 'a')).toBe(false)
    expect(fixture.tables.journal_template_lines.find(row => row.id === 'b-line')).toBeDefined()
  })
})
