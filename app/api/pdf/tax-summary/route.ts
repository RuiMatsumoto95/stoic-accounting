import { validateComparisonPeriod, validateReportAccount, reportErrorStatus } from '@/lib/reports/scope'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { registerFonts } from '@/lib/pdf/fonts'
import { getTaxSummaryReport } from '@/lib/reports/tax-summary'
import { TaxSummaryDocument } from '@/components/pdf/documents/TaxSummaryDocument'
import { getAllTaxCodes } from '@/lib/tax-codes'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const periodId   = searchParams.get('periodId')
  const periodName = '' // レポートで対象期のDB名を取得する
  const startDate  = searchParams.get('startDate')
  const endDate    = searchParams.get('endDate')

  if (!periodId || !startDate || !endDate) {
    return NextResponse.json(
      { error: 'periodId, startDate, endDate are required' },
      { status: 400 }
    )
  }

  try {
    await validateComparisonPeriod(periodId, searchParams.get('prevPeriodId') || null)
    const requestedAccount = searchParams.get('accountId')
    if (requestedAccount) await validateReportAccount(periodId, requestedAccount)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'データ取得に失敗しました' }, { status: reportErrorStatus(error) })
  }

  registerFonts()

  let report
  try {
    const taxCodes = await getAllTaxCodes()
    report = await getTaxSummaryReport({ periodId, periodName, startDate, endDate }, taxCodes)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'データ取得に失敗しました' },
      { status: reportErrorStatus(e) }
    )
  }

  let buffer
  try {
    // renderToBuffer requires DocumentProps but TaxSummaryDocument wraps Document — cast is intentional
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = createElement(TaxSummaryDocument, { report }) as any
    buffer = await renderToBuffer(doc)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'PDF生成に失敗しました' },
      { status: reportErrorStatus(e) }
    )
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="tax-summary.pdf"`,
    },
  })
}
