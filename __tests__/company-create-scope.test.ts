import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { companyDb } from './helpers/company-supabase'
let fixture: ReturnType<typeof companyDb>
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => fixture.client.from(table) } }))
import { insertStagingRows, type ParsedStagingRow } from '@/lib/csv-import'
import { createMappingRule } from '@/lib/mapping-rules'
import { createTemplate, updateTemplate, deleteTemplate } from '@/lib/journal-templates'
import { getTaxMethod, updateTaxMethod } from '@/lib/tax-codes'
import { createJournalEntry, updateJournalEntry, importStagingEntries } from '@/lib/journal-save'
import { registerActiveCompany } from '@/lib/company-guard'

beforeEach(() => {
  fixture = companyDb({
    companies: [{ id: 'a', tax_method: 'EXEMPT' }, { id: 'b', tax_method: 'SIMPLE' }],
    journal_templates: [{ id: 'a-template', company_id: 'a', name: 'A' }, { id: 'b-template', company_id: 'b', name: 'B' }],
    journal_template_lines: [],
  })
  registerActiveCompany('a')
  vi.stubGlobal('document', { cookie: 'sa_company_id=a' })
})
afterEach(() => { registerActiveCompany(null); vi.unstubAllGlobals() })

describe('作成系の会社ID', () => {
  const row: ParsedStagingRow = {
    raw_date: '2026-01-01', raw_debit_account: '現金', raw_debit_sub_account: '', raw_debit_tax_code: '', raw_debit_amount: 100,
    raw_credit_account: '売上', raw_credit_sub_account: '', raw_credit_tax_code: '', raw_credit_amount: 100,
    raw_description: 'テスト', predicted_account_id: 'a-cash', counter_account_id: 'a-sales', debit_sub_account_id: null,
    debit_tax_code_id: null, credit_sub_account_id: null, credit_tax_code_id: null, parse_warnings: [], is_processed: false,
  }
  const template = { name: '新規', default_description: null, lines: [{ line_number: 1, side: 'DEBIT' as const, account_id: 'a-cash', amount: 100, tax_code: null, description: null }] }

  it('取込の全行、置換ルール、テンプレートの親に company_id を渡す', async () => {
    await insertStagingRows([row, row], 'a')
    await createMappingRule({ keyword: 'cash', account_id: 'a-cash', priority: 10 }, 'a')
    await createTemplate(template, 'a')
    expect(fixture.tables.import_staging).toHaveLength(2)
    expect(fixture.tables.import_staging.every(value => value.company_id === 'a')).toBe(true)
    expect(fixture.tables.mapping_rules[0]).toMatchObject({ company_id: 'a', keyword: 'cash' })
    expect(fixture.tables.journal_templates.at(-1)).toMatchObject({ company_id: 'a', name: '新規' })
    // 明細の会社IDは既存のDBトリガーが親テンプレートから設定する。
    expect(fixture.tables.journal_template_lines[0].template_id).toBe(fixture.tables.journal_templates.at(-1)?.id)
  })
  it('他社テンプレートは更新・削除できない', async () => {
    await expect(updateTemplate('b-template', template, 'a')).rejects.toBeTruthy()
    await deleteTemplate('b-template', 'a')
    expect(fixture.tables.journal_templates.find(value => value.id === 'b-template')).toMatchObject({ name: 'B' })
  })
  it('書き込みの companyId は型でも必須', () => {
    expectTypeOf<Parameters<typeof createJournalEntry>[0]>().toExtend<{ companyId: string }>()
    expectTypeOf<Parameters<typeof updateJournalEntry>[0]>().toExtend<{ companyId: string }>()
    expectTypeOf<Parameters<typeof importStagingEntries>>().toEqualTypeOf<[string, string[], string]>()
    expectTypeOf<Parameters<typeof insertStagingRows>>().toEqualTypeOf<[ParsedStagingRow[], string]>()
    expectTypeOf<Parameters<typeof createTemplate>[1]>().toEqualTypeOf<string>()
    expectTypeOf<Parameters<typeof updateTaxMethod>>().toEqualTypeOf<[string, Parameters<typeof updateTaxMethod>[1]]>()
    expectTypeOf<Parameters<typeof createMappingRule>[1]>().toEqualTypeOf<string>()
  })
  it('古い会社の画面からは作成系を通信前に拒否する', async () => {
    document.cookie = 'sa_company_id=b'
    for (const save of [() => insertStagingRows([row], 'a'), () => createMappingRule({ keyword: 'cash', account_id: 'a-cash', priority: 10 }, 'a'), () => createTemplate(template, 'a')]) {
      await expect(save()).rejects.toMatchObject({ code: 'STALE_COMPANY' })
    }
    expect(fixture.calls).toEqual([])
  })
})

describe('会社ごとの課税方式', () => {
  it('2社で異なる値を読み書きでき、他社や system_settings を変更しない', async () => {
    expect(await getTaxMethod('a')).toBe('EXEMPT')
    expect(await getTaxMethod('b')).toBe('SIMPLE')
    await updateTaxMethod('a', 'STANDARD_INDIVIDUAL')
    expect(await getTaxMethod('a')).toBe('STANDARD_INDIVIDUAL')
    expect(await getTaxMethod('b')).toBe('SIMPLE')
    document.cookie = 'sa_company_id=b'
    registerActiveCompany('b')
    await updateTaxMethod('b', 'STANDARD_PROPORTIONAL')
    expect(await getTaxMethod('a')).toBe('STANDARD_INDIVIDUAL')
    expect(await getTaxMethod('b')).toBe('STANDARD_PROPORTIONAL')
    expect(fixture.calls.every(call => call.table === 'companies')).toBe(true)
  })
  it('更新0件やDBエラーを成功にしない', async () => {
    registerActiveCompany('missing')
    document.cookie = 'sa_company_id=missing'
    await expect(updateTaxMethod('missing', 'SIMPLE')).rejects.toThrow()
    fixture.failWith(() => '失敗')
    await expect(updateTaxMethod('missing', 'SIMPLE')).rejects.toThrow('失敗')
  })
})
