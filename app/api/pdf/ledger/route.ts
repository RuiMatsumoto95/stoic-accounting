import { validateComparisonPeriod, validateReportAccount, reportErrorStatus } from '@/lib/reports/scope'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { registerFonts } from '@/lib/pdf/fonts'
import { getLedgerReport } from '@/lib/reports/ledger'
import { LedgerDocument } from '@/components/pdf/documents/LedgerDocument'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const periodId   = searchParams.get('periodId')
  const periodName = '' // レポートで対象期のDB名を取得する
  const accountId  = searchParams.get('accountId')
  const accountType = searchParams.get('accountType')

  if (!periodId || !accountId || !accountType) {
    return NextResponse.json(
      { error: 'periodId, accountId, accountType are required' },
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
    report = await getLedgerReport({ periodId, periodName, accountId, accountType })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'データ取得に失敗しました' },
      { status: reportErrorStatus(e) }
    )
  }

  let buffer
  try {
    // renderToBuffer requires DocumentProps but LedgerDocument wraps Document — cast is intentional
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = createElement(LedgerDocument, { report }) as any
    buffer = await renderToBuffer(doc)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'PDF生成に失敗しました' },
      { status: reportErrorStatus(e) }
    )
  }

  const filename = `ledger-${encodeURIComponent(report.accountName)}.pdf`

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
