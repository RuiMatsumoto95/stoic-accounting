import { validateComparisonPeriod, validateReportAccount, reportErrorStatus } from '@/lib/reports/scope'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { registerFonts } from '@/lib/pdf/fonts'
import { getJournalReport } from '@/lib/reports/journal'
import { JournalDocument } from '@/components/pdf/documents/JournalDocument'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const periodId   = searchParams.get('periodId')
  const periodName = '' // レポートで対象期のDB名を取得する
  const dateFrom   = searchParams.get('dateFrom')   ?? ''
  const dateTo     = searchParams.get('dateTo')     ?? ''
  const keyword    = searchParams.get('keyword')    ?? ''
  const accountId  = searchParams.get('accountId')  ?? ''
  const amountMin  = searchParams.get('amountMin')  ?? ''
  const amountMax  = searchParams.get('amountMax')  ?? ''

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
    report = await getJournalReport({
      periodId,
      periodName,
      dateFrom,
      dateTo,
      keyword,
      accountId,
      amountMin,
      amountMax,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'データ取得に失敗しました' },
      { status: reportErrorStatus(e) }
    )
  }

  let buffer
  try {
    // renderToBuffer requires DocumentProps but JournalDocument wraps Document — cast is intentional
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = createElement(JournalDocument, { report }) as any
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
      'Content-Disposition': `attachment; filename="journal.pdf"`,
    },
  })
}
