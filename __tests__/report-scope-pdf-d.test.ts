import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { ReactElement } from 'react'
import { companyDb } from './helpers/company-supabase'

let fixture: ReturnType<typeof companyDb>
const rendered = vi.hoisted(() => [] as ReactElement<{ report: { kind?: string; periodName: string; data?: unknown } }>[])
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => fixture.client.from(table), rpc: async () => ({ data: [], error: null }) } }))
vi.mock('@/lib/pdf/fonts', () => ({ registerFonts: vi.fn() }))
vi.mock('@react-pdf/renderer', async importOriginal => ({
  ...await importOriginal<typeof import('@react-pdf/renderer')>(),
  renderToBuffer: vi.fn(async (document: ReactElement<{ report: { periodName: string } }>) => {
    rendered.push(document)
    return Buffer.from('%PDF-fixture')
  }),
}))

import { assertSameReportCompany, assertReportAccount, reportErrorStatus } from '@/lib/reports/scope'
import { getPLReport } from '@/lib/reports/income-statement'
import { getBSReport } from '@/lib/reports/balance-sheet'
import { getLedgerReport } from '@/lib/reports/ledger'
import { getSubsidiaryLedgerReport } from '@/lib/reports/subsidiary-ledger'
import { getJournalReport } from '@/lib/reports/journal'
import { getPLData, getBSData, getIndividualPLData, getIndividualBSData } from '@/lib/financial-statements'
import { GET as income } from '@/app/api/pdf/income-statement/route'
import { GET as balance } from '@/app/api/pdf/balance-sheet/route'
import { GET as journal } from '@/app/api/pdf/journal/route'
import { GET as ledger } from '@/app/api/pdf/ledger/route'
import { GET as subsidiaryLedger } from '@/app/api/pdf/subsidiary-ledger/route'
import { GET as trial } from '@/app/api/pdf/trial-balance/route'
import { GET as plTrial } from '@/app/api/pdf/pl-trial-balance/route'
import { GET as subsidiaryBalance } from '@/app/api/pdf/subsidiary-balance/route'
import { GET as tax } from '@/app/api/pdf/tax-summary/route'
import { PLDocument } from '@/components/pdf/documents/PLDocument'
import { BSDocument } from '@/components/pdf/documents/BSDocument'
import { IndividualPLDocument } from '@/components/pdf/documents/IndividualPLDocument'
import { IndividualBSDocument } from '@/components/pdf/documents/IndividualBSDocument'

const routes = [income, balance, journal, ledger, subsidiaryLedger, trial, plTrial, subsidiaryBalance, tax]
function request(periodId: string, query = '') {
  return new NextRequest(`http://localhost/api/pdf/fixture?periodId=${periodId}&periodName=FORGED&accountId=${periodId === 'bp' ? 'b-sales' : 'a-sales'}&accountType=REVENUE&startDate=1900-01-01&endDate=2100-12-31&${query}`)
}

beforeEach(() => {
  rendered.length = 0
  fixture = companyDb({
    companies: [{ id: 'a', kind: 'CORPORATION' }, { id: 'b', kind: 'INDIVIDUAL' }],
    fiscal_periods: [
      { id: 'ap', company_id: 'a', name: '法人の正式期名', start_date: '2026-01-01', end_date: '2026-12-31' },
      { id: 'ap-prev', company_id: 'a', name: '法人前期', start_date: '2025-01-01', end_date: '2025-12-31' },
      { id: 'bp', company_id: 'b', name: '個人の正式期名', start_date: '2026-01-01', end_date: '2026-12-31' },
    ],
    accounts: ['a', 'b'].flatMap(company_id => [
      { id: `${company_id}-sales`, company_id, code: '400', name: `${company_id}売上`, type: 'REVENUE', parent_id: null, pl_category: 'REVENUE', bs_category: null },
      { id: `${company_id}-bank`, company_id, code: '100', name: `${company_id}預金`, type: 'ASSET', parent_id: null, pl_category: null, bs_category: 'CURRENT_ASSETS' },
    ]),
    journal_entries: ['a', 'b'].map(company_id => ({ id: `${company_id}-entry`, company_id, period_id: `${company_id}p`, date: '2026-02-01', journal_lines: [] })),
    journal_lines: ['a', 'b'].flatMap(company_id => [
      { id: `${company_id}-dr`, company_id, entry_id: `${company_id}-entry`, account_id: `${company_id}-bank`, side: 'DEBIT', amount: company_id === 'a' ? 100 : 999 },
      { id: `${company_id}-cr`, company_id, entry_id: `${company_id}-entry`, account_id: `${company_id}-sales`, side: 'CREDIT', amount: company_id === 'a' ? 100 : 999 },
    ]),
    ledger_view: [], tax_codes: [],
  })
})

describe('D: 純粋な帳票整合判定', () => {
  it('同じ会社を許可し、別会社の前期を400、別会社・不存在の科目を404にする', () => {
    expect(() => assertSameReportCompany('a', 'a')).not.toThrow()
    expect(() => assertReportAccount('a', { company_id: 'a' })).not.toThrow()
    for (const [check, status] of [
      [() => assertSameReportCompany('a', 'b'), 400],
      [() => assertReportAccount('a', { company_id: 'b' }), 404],
      [() => assertReportAccount('a', null), 404],
    ] as const) {
      expect(check).toThrow()
      try { check() }
      catch (error) { expect(reportErrorStatus(error)).toBe(status) }
    }
    expect(reportErrorStatus(new Error('unknown'))).toBe(500)
  })
})

describe('D: 期に基づく会社分離とレポート', () => {
  const options = (periodId: string) => ({ periodId, periodName: 'FORGED', prevPeriodId: null, showPrev: false, hideZero: false })
  it('サーバーで期の会社から種類を選び、正式期名を取得する', async () => {
    const a = await getPLReport(options('ap')), b = await getPLReport(options('bp'))
    expect(a).toMatchObject({ kind: 'CORPORATION', periodName: '法人の正式期名', data: { revenueTotal: 100, netIncome: 100 } })
    expect(b).toMatchObject({ kind: 'INDIVIDUAL', periodName: '個人の正式期名', data: { revenueTotal: 999, incomeBeforeDeduction: 999 } })
    const abs = await getBSReport(options('ap')), bbs = await getBSReport(options('bp'))
    expect(abs).toMatchObject({ kind: 'CORPORATION', data: { totalAssets: 100, totalLiabilitiesAndEquity: 100 } })
    expect(bbs).toMatchObject({ kind: 'INDIVIDUAL', data: { totalAssets: 999, totalLiabilitiesAndEquity: 999 } })
    expect(b.sections.flatMap(section => section.items).map(item => item.account_id)).toEqual(['b-sales'])
  })
  it('公開の法人/個人集計関数でも前期の会社を検証する', async () => {
    await expect(getPLData('ap', 'bp')).rejects.toMatchObject({ httpStatus: 400 })
    await expect(getBSData('ap', 'bp', 0, 0)).rejects.toMatchObject({ httpStatus: 400 })
    await expect(getIndividualPLData('bp', 'ap')).rejects.toMatchObject({ httpStatus: 400 })
    await expect(getIndividualBSData('bp', 'ap', 0, 0)).rejects.toMatchObject({ httpStatus: 400 })
    const report = await getPLReport({ ...options('ap'), prevPeriodId: 'ap-prev', showPrev: true })
    expect(report.data.prev?.revenueTotal).toBe(0)
  })
  it.each([getLedgerReport, getSubsidiaryLedgerReport])('画面からの元帳呼び出しも他社科目を拒否する', async getReport => {
    await expect(getReport({ periodId: 'ap', periodName: 'FORGED', accountId: 'b-sales', accountType: 'REVENUE' })).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', httpStatus: 404 })
    expect((await getReport({ periodId: 'bp', periodName: 'FORGED', accountId: 'b-sales', accountType: 'REVENUE' })).periodName).toBe('個人の正式期名')
  })
  it('仕訳帳の科目絞り込みでも、他社科目を指定して全件表示になることを防ぐ', async () => {
    await expect(getJournalReport({ periodId: 'ap', periodName: 'FORGED', accountId: 'b-sales' })).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', httpStatus: 404 })
  })
})

describe('D: 全9 PDFルートの整合と文書選択（描画器はfake）', () => {
  it.each(routes)('別会社の前期はPDF生成前に400', async route => {
    expect((await route(request('ap', 'prevPeriodId=bp'))).status).toBe(400)
    expect(rendered).toHaveLength(0)
  })
  it.each(routes)('別会社の科目はPDF生成前に404', async route => {
    const req = request('ap')
    req.nextUrl.searchParams.set('accountId', 'b-sales')
    expect((await route(req)).status).toBe(404)
    expect(rendered).toHaveLength(0)
  })
  it.each(routes)('存在しない期は404', async route => {
    expect((await route(request('missing'))).status).toBe(404)
  })
  it.each(routes)('正式な期名を文書に渡し、URLの名称を無視する', async route => {
    const req = request('ap')
    // 科目フィルターを使わない帳票も含め、正常な期・名称の経路を確認する。
    if (route !== ledger && route !== subsidiaryLedger) req.nextUrl.searchParams.delete('accountId')
    expect((await route(req)).status).toBe(200)
    expect(rendered.at(-1)?.props.report.periodName).toBe('法人の正式期名')
  })
  it.each([
    [income, 'ap', PLDocument], [income, 'bp', IndividualPLDocument],
    [balance, 'ap', BSDocument], [balance, 'bp', IndividualBSDocument],
  ] as const)('PL/BSの文書は期の会社区分で選び、URLのkindを無視する', async (route, periodId, component) => {
    expect((await route(request(periodId, `kind=${periodId === 'ap' ? 'INDIVIDUAL' : 'CORPORATION'}`))).status).toBe(200)
    expect(rendered.at(-1)?.type).toBe(component)
  })
})
