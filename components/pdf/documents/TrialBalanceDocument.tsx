import { Document, Page, View, Text } from '@react-pdf/renderer'
import { StyleSheet } from '@react-pdf/renderer'
import type { TrialBalanceReport } from '@/lib/reports/trial-balance'
import { BS_TYPES } from '@/lib/reports/trial-balance'
import { PDFHeader } from '../common/PDFHeader'
import { PDFFooter } from '../common/PDFFooter'
import { fmt } from '@/lib/pdf/pdf-utils'

const s = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 8,
    paddingTop: 30,
    paddingBottom: 40,
    paddingHorizontal: 30,
    color: '#111',
  },
  table: { width: '100%' },
  colHeader: {
    flexDirection: 'row',
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    marginBottom: 2,
    alignItems: 'center',
  },
  colHeaderText: { fontSize: 7, color: '#555' },
  groupHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#bbb',
    marginTop: 4,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.3,
    borderBottomColor: '#e0e0e0',
    paddingVertical: 2,
    paddingHorizontal: 4,
    minHeight: 14,
    alignItems: 'center',
  },
  subtotalRow: {
    flexDirection: 'row',
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderTopWidth: 0.5,
    borderTopColor: '#bbb',
    borderBottomWidth: 0.5,
    borderBottomColor: '#bbb',
    alignItems: 'center',
  },
  grandTotalRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: '#333',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    marginTop: 4,
    alignItems: 'center',
  },
  codeCell:    { width: 36, color: '#888' },
  labelCell:   { flex: 1 },
  numCell:     { width: 72, textAlign: 'right' },
  bold: { fontWeight: 'bold' },
})

function fmtOb(n: number): string {
  return n !== 0 ? fmt(Math.abs(n)) : '-'
}

type Props = {
  report: TrialBalanceReport
  viewMode: 'account' | 'subsidiary'
}

export function TrialBalanceDocument({ report, viewMode }: Props) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <PDFHeader title="残高試算表" periodName={report.periodName} />

        {/* 列ヘッダー */}
        <View style={s.colHeader}>
          <Text style={[s.codeCell, s.colHeaderText]}>コード</Text>
          <Text style={[s.labelCell, s.colHeaderText]}>勘定科目</Text>
          <Text style={[s.numCell, s.colHeaderText]}>期首残高</Text>
          <Text style={[s.numCell, s.colHeaderText]}>当期借方</Text>
          <Text style={[s.numCell, s.colHeaderText]}>当期貸方</Text>
          <Text style={[s.numCell, s.colHeaderText]}>期末残高</Text>
        </View>

        <View style={s.table}>
          {report.groups.map(group => {
            const isBs = BS_TYPES.includes(group.type)
            return (
              <View key={group.type}>
                {/* グループヘッダー */}
                <View style={s.groupHeaderRow}>
                  <Text style={s.codeCell} />
                  <Text style={[s.labelCell, s.bold]}>{group.label}</Text>
                  <Text style={s.numCell} />
                  <Text style={s.numCell} />
                  <Text style={s.numCell} />
                  <Text style={s.numCell} />
                </View>

                {/* 明細行 */}
                {viewMode === 'subsidiary'
                  ? group.rows.map(row => {
                      const hasChildren = row.children && row.children.length > 0
                      return (
                        <View key={row.accountId}>
                          <View style={hasChildren ? s.subtotalRow : s.row}>
                            <Text style={s.codeCell}>{row.accountCode}</Text>
                            <Text style={[s.labelCell, hasChildren ? s.bold : {}]}>{row.accountName}</Text>
                            <Text style={s.numCell}>{isBs ? fmtOb(row.openingBalance) : '-'}</Text>
                            <Text style={s.numCell}>{fmt(row.debitTotal)}</Text>
                            <Text style={s.numCell}>{fmt(row.creditTotal)}</Text>
                            <Text style={[s.numCell, s.bold]}>{fmtOb(row.closingBalance)}</Text>
                          </View>
                          {hasChildren && (row.children ?? []).map(child => (
                            <View key={child.accountId} style={s.row}>
                              <Text style={s.codeCell} />
                              <Text style={[s.labelCell, { paddingLeft: 4 }]}>{child.accountName}</Text>
                              <Text style={s.numCell}>{isBs ? fmtOb(child.openingBalance) : '-'}</Text>
                              <Text style={s.numCell}>{fmt(child.debitTotal)}</Text>
                              <Text style={s.numCell}>{fmt(child.creditTotal)}</Text>
                              <Text style={[s.numCell, s.bold]}>{fmtOb(child.closingBalance)}</Text>
                            </View>
                          ))}
                        </View>
                      )
                    })
                  : group.rows.map(row => (
                    <View key={row.accountId} style={s.row}>
                      <Text style={s.codeCell}>{row.accountCode}</Text>
                      <Text style={s.labelCell}>{row.accountName}</Text>
                      <Text style={s.numCell}>{isBs ? fmtOb(row.openingBalance) : '-'}</Text>
                      <Text style={s.numCell}>{fmt(row.debitTotal)}</Text>
                      <Text style={s.numCell}>{fmt(row.creditTotal)}</Text>
                      <Text style={[s.numCell, s.bold]}>{fmtOb(row.closingBalance)}</Text>
                    </View>
                  ))
                }

                {/* 小計行 */}
                <View style={s.subtotalRow}>
                  <Text style={s.codeCell} />
                  <Text style={[s.labelCell, s.bold, { color: '#555', fontSize: 7 }]}>小計</Text>
                  <Text style={[s.numCell, s.bold]}>{isBs ? fmtOb(group.openingSubtotal) : '-'}</Text>
                  <Text style={[s.numCell, s.bold]}>{fmt(group.debitSubtotal)}</Text>
                  <Text style={[s.numCell, s.bold]}>{fmt(group.creditSubtotal)}</Text>
                  <Text style={[s.numCell, s.bold]}>{fmtOb(group.closingSubtotal)}</Text>
                </View>
              </View>
            )
          })}

          {/* 合計行 */}
          <View style={s.grandTotalRow}>
            <Text style={s.codeCell} />
            <Text style={[s.labelCell, s.bold]}>合計</Text>
            <Text style={[s.numCell, s.bold]}>{fmtOb(report.grandOpening)}</Text>
            <Text style={[s.numCell, s.bold]}>{fmt(report.grandDebit)}</Text>
            <Text style={[s.numCell, s.bold]}>{fmt(report.grandCredit)}</Text>
            <Text style={[s.numCell, s.bold]}>{fmtOb(report.grandClosing)}</Text>
          </View>
        </View>

        <PDFFooter />
      </Page>
    </Document>
  )
}
