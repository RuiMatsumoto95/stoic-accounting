import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { companyDb } from './helpers/company-supabase'
import { ERROR_CODES } from '@/lib/errors'

let fixture: ReturnType<typeof companyDb>
const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => fixture.client.from(table), rpc: (...args: unknown[]) => rpc(...args) } }))
vi.mock('@/lib/pdf/fonts', () => ({ registerFonts: vi.fn() }))
vi.mock('@react-pdf/renderer', async importOriginal => ({ ...await importOriginal<typeof import('@react-pdf/renderer')>(), renderToBuffer: vi.fn() }))
import { renderToBuffer } from '@react-pdf/renderer'
import { GET as ledgerPDF } from '@/app/api/pdf/ledger/route'
import { GET as subsidiaryLedgerPDF } from '@/app/api/pdf/subsidiary-ledger/route'
import { GET as subsidiaryBalancePDF } from '@/app/api/pdf/subsidiary-balance/route'
import { GET as trialPDF } from '@/app/api/pdf/trial-balance/route'
import { GET as plTrialPDF } from '@/app/api/pdf/pl-trial-balance/route'
import { GET as bsPDF } from '@/app/api/pdf/balance-sheet/route'
import { getLedgerReport } from '@/lib/reports/ledger'
import { getSubsidiaryLedgerReport } from '@/lib/reports/subsidiary-ledger'
import { getSubsidiaryBalanceReport } from '@/lib/reports/subsidiary-balance'
import { getTrialBalanceReport } from '@/lib/reports/trial-balance'

beforeEach(() => {
  vi.clearAllMocks()
  rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'CARRY_FORWARD_NOT_SET', details: '', hint: '' } })
  fixture = companyDb({ companies: [{ id: 'a', kind: 'CORPORATION' }], fiscal_periods: [{ id: 'p', company_id: 'a', name: '2期目', start_date: '2026-01-01', end_date: '2026-12-31' }],
    accounts: [{ id: 'bank', company_id: 'a', code: '100', name: '預金', type: 'ASSET', parent_id: null, bs_category: 'CURRENT_ASSETS', pl_category: null },
      { id: 'sub', company_id: 'a', code: '1001', name: 'A銀行', type: 'ASSET', parent_id: 'bank', bs_category: 'CURRENT_ASSETS', pl_category: null }], journal_entries: [], ledger_view: [] })
})

describe('期首取得失敗が画面用帳票・PDFへ届く', () => {
  it.each([
    ['元帳', () => getLedgerReport({ periodId: 'p', periodName: '', accountId: 'bank', accountType: 'ASSET' })],
    ['補助元帳', () => getSubsidiaryLedgerReport({ periodId: 'p', periodName: '', accountId: 'sub', accountType: 'ASSET' })],
    ['補助残高', () => getSubsidiaryBalanceReport({ periodId: 'p', periodName: '' })],
    ['試算表', () => getTrialBalanceReport({ periodId: 'p', periodName: '', filterTypes: ['ASSET', 'LIABILITY', 'EQUITY'] })],
  ] as const)('%s はゼロの帳票を返さず翻訳した例外を投げる', async (_, fetch) => {
    await expect(fetch()).rejects.toMatchObject({ code: 'CARRY_FORWARD_NOT_SET', message: ERROR_CODES.CARRY_FORWARD_NOT_SET.message })
  })
  it.each([
    ['元帳', ledgerPDF, 'bank'], ['補助元帳', subsidiaryLedgerPDF, 'sub'], ['補助残高', subsidiaryBalancePDF, ''],
    ['試算表', trialPDF, ''], ['損益試算表', plTrialPDF, ''], ['法人BS', bsPDF, ''], ['個人BS', bsPDF, ''],
  ] as const)('%s PDF は日本語JSONのHTTPエラーを返し、PDF描画を呼ばない', async (label, route, accountId) => {
    if (label === '個人BS') fixture.tables.companies[0].kind = 'INDIVIDUAL'
    const response = await route(new NextRequest(`http://localhost/api/pdf/test?periodId=p&accountType=ASSET${accountId ? `&accountId=${accountId}` : ''}`))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: ERROR_CODES.CARRY_FORWARD_NOT_SET.message })
    expect(renderToBuffer).not.toHaveBeenCalled()
  })
})
