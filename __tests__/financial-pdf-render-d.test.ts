import { describe, expect, it } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { registerFonts } from '@/lib/pdf/fonts'
import { calculatePLData, calculateBSData, type StatementAccount } from '@/lib/financial-statement-calculations'
import { calculateIndividualPLData, calculateIndividualBSData } from '@/lib/individual-financial-statements'
import { PLDocument } from '@/components/pdf/documents/PLDocument'
import { BSDocument } from '@/components/pdf/documents/BSDocument'
import { IndividualPLDocument } from '@/components/pdf/documents/IndividualPLDocument'
import { IndividualBSDocument } from '@/components/pdf/documents/IndividualBSDocument'

describe('D: PDFのNode描画スモーク（DB・ブラウザーなし）', () => {
  it('法人/個人のPL・BSを既存の日本語フォントでPDF化できる', async () => {
    registerFonts()
    const accounts: StatementAccount[] = [
      { id: 'bank', code: '100', name: '普通預金', type: 'ASSET', parent_id: null, pl_category: null, bs_category: 'CURRENT_ASSETS' },
      { id: 'sales', code: '400', name: '売上高', type: 'REVENUE', parent_id: null, pl_category: 'REVENUE', bs_category: null },
    ]
    const movements = [{ account_id: 'bank', total_debit: 1000, total_credit: 0 }, { account_id: 'sales', total_debit: 0, total_credit: 1000 }]
    const pl = calculatePLData(accounts, movements, []), bs = calculateBSData(accounts, [], movements, [], [], pl.netIncome, 0)
    const ipl = calculateIndividualPLData(accounts, movements, []), ibs = calculateIndividualBSData(accounts, [], movements, [], [], ipl.incomeBeforeDeduction, 0)
    const periodName = '2026年12月期'
    const documents = [
      createElement(PLDocument, { report: { kind: 'CORPORATION', periodName, data: pl, sections: pl.sections }, showPrev: true }),
      createElement(BSDocument, { report: { kind: 'CORPORATION', periodName, data: bs, sections: bs.sections }, showPrev: true }),
      createElement(IndividualPLDocument, { report: { kind: 'INDIVIDUAL', periodName, data: ipl, sections: ipl.sections }, showPrev: true }),
      createElement(IndividualBSDocument, { report: { kind: 'INDIVIDUAL', periodName, data: ibs, sections: ibs.sections }, showPrev: true }),
    ]
    for (const document of documents) {
      const buffer = await renderToBuffer(document as unknown as ReactElement<DocumentProps>)
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
      expect(buffer.length).toBeGreaterThan(1000)
    }
  }, 20000)
})
