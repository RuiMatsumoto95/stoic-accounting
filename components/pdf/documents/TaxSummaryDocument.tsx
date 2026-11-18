import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { TaxSummaryReport } from '@/lib/reports/tax-summary'
import { PDFHeader } from '../common/PDFHeader'
import { PDFFooter } from '../common/PDFFooter'
import { fmt } from '@/lib/pdf/pdf-utils'

const s = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 9,
    paddingTop: 30,
    paddingBottom: 40,
    paddingHorizontal: 35,
    color: '#111',
  },
  periodRow: {
    fontSize: 8,
    color: '#555',
    marginBottom: 8,
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
  colHeaderText: { fontSize: 8, color: '#555' },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.3,
    borderBottomColor: '#e0e0e0',
    paddingVertical: 2,
    paddingHorizontal: 4,
    minHeight: 16,
    alignItems: 'center',
  },
  totalRow: {
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
  labelCell: { flex: 1 },
  amountCell: { width: 110, textAlign: 'right' },
  bold: { fontWeight: 'bold' },
})

type Props = {
  report: TaxSummaryReport
}

export function TaxSummaryDocument({ report }: Props) {
  const { periodName, startDate, endDate, rows, grandDebit, grandCredit } = report

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <PDFHeader title="消費税集計表" periodName={periodName} />

        <Text style={s.periodRow}>
          集計期間：{startDate} 〜 {endDate}
        </Text>

        <View style={s.table}>
          {/* 列ヘッダー */}
          <View style={s.colHeader}>
            <Text style={[s.labelCell, s.colHeaderText]}>税区分</Text>
            <Text style={[s.amountCell, s.colHeaderText]}>借方金額合計</Text>
            <Text style={[s.amountCell, s.colHeaderText]}>貸方金額合計</Text>
          </View>

          {/* 明細行 */}
          {rows.map(({ label, debit, credit }) => (
            <View key={label} style={s.row}>
              <Text style={s.labelCell}>{label}</Text>
              <Text style={s.amountCell}>{fmt(debit)}</Text>
              <Text style={s.amountCell}>{fmt(credit)}</Text>
            </View>
          ))}

          {/* 合計行 */}
          <View style={s.totalRow}>
            <Text style={[s.labelCell, s.bold]}>合計</Text>
            <Text style={[s.amountCell, s.bold]}>{fmt(grandDebit)}</Text>
            <Text style={[s.amountCell, s.bold]}>{fmt(grandCredit)}</Text>
          </View>
        </View>

        <PDFFooter />
      </Page>
    </Document>
  )
}
