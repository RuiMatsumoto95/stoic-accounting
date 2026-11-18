import { beforeEach, describe, expect, it, vi } from 'vitest'
import { companyDb } from './helpers/company-supabase'
let fixture: ReturnType<typeof companyDb>
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => fixture.client.from(table), rpc: async () => ({ data: [], error: null }) } }))
import { getCompanyIdByPeriod } from '@/lib/company-scope'
import { getLedgerReport } from '@/lib/reports/ledger'
import { getSubsidiaryLedgerReport } from '@/lib/reports/subsidiary-ledger'
import { getPLData, getBSData } from '@/lib/financial-statements'
import { fetchImportData } from '@/lib/csv-import'
import { fetchTemplates } from '@/lib/journal-templates'
import { registerActiveCompany } from '@/lib/company-guard'

beforeEach(() => {
  fixture = companyDb({
    companies: [{ id: 'a', is_archived: false }, { id: 'b', is_archived: true }],
    fiscal_periods: [{ id: 'a-period', company_id: 'a', start_date: '2026-01-01' }, { id: 'b-period', company_id: 'b', start_date: '2026-01-01' }],
    accounts: [{ id: 'a-account', code: '100', name: 'A売上', company_id: 'a', parent_id: null, type: 'REVENUE', pl_category: 'REVENUE', bs_category: null }, { id: 'b-account', code: '100', name: 'B売上', company_id: 'b', parent_id: null, type: 'REVENUE', pl_category: 'REVENUE', bs_category: null }],
    journal_entries: [{ id: 'a-entry', period_id: 'a-period', company_id: 'a' }, { id: 'b-entry', period_id: 'b-period', company_id: 'b' }],
    journal_lines: [{ entry_id: 'a-entry', account_id: 'a-account', side: 'CREDIT', amount: 100 }, { entry_id: 'b-entry', account_id: 'b-account', side: 'CREDIT', amount: 999 }],
    mapping_rules: [{ id: 'a-rule', company_id: 'a', keyword: 'A', account_id: 'a-account' }, { id: 'b-rule', company_id: 'b', keyword: 'B', account_id: 'b-account' }],
    journal_templates: [{ id: 'a-template', company_id: 'a', name: 'A', journal_template_lines: [] }, { id: 'b-template', company_id: 'b', name: 'B', journal_template_lines: [] }],
    ledger_view: [],
  })
})
describe('期から会社を決める帳票（PDFと共用）', () => {
  it('期の所属会社を返す。存在しない期は失敗する', async () => {
    expect(await getCompanyIdByPeriod('a-period')).toBe('a')
    expect(await getCompanyIdByPeriod('b-period')).toBe('b')
    await expect(getCompanyIdByPeriod('missing')).rejects.toBeDefined()
  })
  it.each([getLedgerReport, getSubsidiaryLedgerReport])('他社 accountId は ACCOUNT_NOT_FOUND', async report => {
    await expect(report({ periodId: 'a-period', periodName: 'A期', accountId: 'b-account', accountType: 'REVENUE' })).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', httpStatus: 404 })
  })
  it('cookie とは独立に期の会社の科目を表示する', async () => {
    expect((await getLedgerReport({ periodId: 'a-period', periodName: 'A期', accountId: 'a-account', accountType: 'REVENUE' })).accountName).toBe('A売上')
    expect((await getSubsidiaryLedgerReport({ periodId: 'b-period', periodName: 'B期', accountId: 'b-account', accountType: 'REVENUE' })).accountName).toBe('B売上')
    for (const call of fixture.calls.filter(call => call.table === 'accounts')) {
      expect(call.filters.some(([column]) => column === 'company_id')).toBe(true)
    }
  })
  it('PL/BS の取得対象に他社の科目・明細を含めない（共通集計の修正は段階D）', async () => {
    const a = await getPLData('a-period', null)
    const b = await getPLData('b-period', null)
    expect(a.revenueTotal).toBe(100)
    expect(b.revenueTotal).toBe(999)
    expect(a.sections.flatMap(section => section.items).map(item => item.account_name)).toEqual(['A売上'])
    const bs = await getBSData('a-period', null, a.netIncome, null)
    expect(bs.sections.flatMap(section => section.items).some(item => item.account_id === 'b-account')).toBe(false)
  })
  it('CSVの科目・置換ルール、テンプレートをタブの会社で絞る。登録前は先頭を選ばない', async () => {
    registerActiveCompany('a')
    try {
      const data = await fetchImportData()
      expect(data.accounts.map(account => account.id)).toEqual(['a-account'])
      expect(data.mappingRules.map(rule => rule.keyword)).toEqual(['A'])
      expect((await fetchTemplates()).map(template => template.id)).toEqual(['a-template'])
    } finally { registerActiveCompany(null) }
    expect((await fetchImportData()).accounts).toEqual([])
    expect(await fetchTemplates()).toEqual([])
  })
})
