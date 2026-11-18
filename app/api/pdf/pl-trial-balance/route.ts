import { validateComparisonPeriod, validateReportAccount, reportErrorStatus } from '@/lib/reports/scope'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { registerFonts } from '@/lib/pdf/fonts'
import { getTrialBalanceReport } from '@/lib/reports/trial-balance'
import { TrialBalanceDocument } from '@/components/pdf/documents/TrialBalanceDocument'

const FILTER_TYPES = ['REVENUE', 'EXPENSE']

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const periodId   = searchParams.get('periodId')
  const periodName = '' // レポートで対象期のDB名を取得する
  const tabParam   = searchParams.get('tab') ?? 'account'

  if (!periodId) {
    return NextResponse.json({ error: 'periodId is required' }, { status: 400 })
  }

  const viewMode: 'account' | 'subsidiary' =
    tabParam === 'subsidiaries' || tabParam === 'subsidiary' ? 'subsidiary' : 'account'

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
    report = await getTrialBalanceReport({
      periodId,
      periodName,
      filterTypes: FILTER_TYPES,
      includeSubsidiaries: viewMode === 'subsidiary',
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'データ取得に失敗しました' }, { status: reportErrorStatus(error) })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = createElement(TrialBalanceDocument, { report, viewMode }) as any
  const buffer = await renderToBuffer(doc)

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="pl-trial-balance.pdf"`,
    },
  })
}
