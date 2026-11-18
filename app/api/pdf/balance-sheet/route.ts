import { IndividualBSDocument } from '@/components/pdf/documents/IndividualBSDocument'
import { validateComparisonPeriod, validateReportAccount, reportErrorStatus } from '@/lib/reports/scope'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { createElement, type ReactElement } from 'react'
import { registerFonts } from '@/lib/pdf/fonts'
import { getBSReport } from '@/lib/reports/balance-sheet'
import { BSDocument } from '@/components/pdf/documents/BSDocument'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const periodId     = searchParams.get('periodId')
  const periodName = '' // レポートで対象期のDB名を取得する
  const prevPeriodId = searchParams.get('prevPeriodId') || null
  const showPrev     = searchParams.get('showPrev') === 'true'
  const hideZero     = searchParams.get('hideZero') === 'true'

  if (!periodId) {
    return NextResponse.json({ error: 'periodId is required' }, { status: 400 })
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
    report = await getBSReport({ periodId, periodName, prevPeriodId: prevPeriodId || null, showPrev, hideZero })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'データ取得に失敗しました' }, { status: reportErrorStatus(error) })
  }
  // 各帳票コンポーネントは Document を返す。
  const doc = (report.kind === 'INDIVIDUAL'
    ? createElement(IndividualBSDocument, { report, showPrev })
    : createElement(BSDocument, { report, showPrev })) as unknown as ReactElement<DocumentProps>
  const buffer = await renderToBuffer(doc)

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="balance-sheet.pdf"`,
    },
  })
}
