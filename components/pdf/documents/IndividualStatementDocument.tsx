import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { StatementRow } from '@/lib/individual-statement-rows'
import { fmtAmount } from '@/lib/pdf/pdf-utils'
import { PDFHeader } from '../common/PDFHeader'
import { PDFFooter } from '../common/PDFFooter'

const styles = StyleSheet.create({
  page: { fontFamily: 'NotoSansJP', fontSize: 9, paddingTop: 30, paddingBottom: 40, paddingHorizontal: 35, color: '#111' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 18, paddingVertical: 3, paddingHorizontal: 4, borderBottomWidth: 0.3, borderBottomColor: '#ddd' },
  header: { backgroundColor: '#f0f0f0', fontWeight: 'bold', marginTop: 4 },
  subtotal: { fontWeight: 'bold', borderTopWidth: 0.5, borderTopColor: '#bbb' },
  total: { fontWeight: 'bold', borderTopWidth: 1, borderTopColor: '#333', marginTop: 3 },
  label: { flex: 1 }, indent: { paddingLeft: 12 },
  amount: { width: 90, textAlign: 'right' }, previous: { width: 90, textAlign: 'right', color: '#555' },
})

export function IndividualStatementDocument({ title, periodName, rows, showPrev }: {
  title: string; periodName: string; rows: StatementRow[]; showPrev: boolean
}) {
  return <Document><Page size="A4" style={styles.page}>
    <PDFHeader title={title} periodName={periodName} />
    <View style={[styles.row, styles.subtotal]} fixed>
      <Text style={styles.label}>科目</Text>
      {showPrev && <Text style={styles.previous}>前期</Text>}
      <Text style={styles.amount}>当期</Text>
    </View>
    {rows.map(row => <View key={row.key} wrap={false} style={[
      styles.row, ...(row.kind === 'header' ? [styles.header] : row.kind === 'subtotal' ? [styles.subtotal] : row.kind === 'total' ? [styles.total] : []),
    ]}>
      <Text style={[styles.label, ...(row.kind === 'item' ? [styles.indent] : [])]}>{row.label}</Text>
      {row.kind !== 'header' && <>
        {showPrev && <Text style={styles.previous}>{row.prevAmount !== null ? fmtAmount(row.prevAmount) : '-'}</Text>}
        <Text style={styles.amount}>{fmtAmount(row.amount)}</Text>
      </>}
    </View>)}
    <PDFFooter />
  </Page></Document>
}
