import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { JournalReport } from '@/lib/reports/journal'
import { PDFHeader } from '../common/PDFHeader'
import { PDFFooter } from '../common/PDFFooter'
import { fmt } from '@/lib/pdf/pdf-utils'

const s = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 8,
    paddingTop: 28,
    paddingBottom: 40,
    paddingHorizontal: 28,
    color: '#111',
  },
  filterRow: {
    fontSize: 7,
    color: '#555',
    marginBottom: 6,
  },
  table: { width: '100%' },
  colHeader: {
    flexDirection: 'row',
    paddingVertical: 2,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    marginBottom: 1,
  },
  colHeaderText: { fontSize: 7, color: '#555' },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.3,
    borderBottomColor: '#ddd',
    paddingVertical: 1,
    paddingHorizontal: 2,
    minHeight: 14,
    alignItems: 'flex-start',
  },
  rowLast: {
    borderBottomWidth: 1.5,
    borderBottomColor: '#999',
  },
  // 列幅（A4横: ～785pt）
  colDate:      { width: 52, flexShrink: 0 },
  colRef:       { width: 36, flexShrink: 0 },
  colAccount:   { width: 115, flexShrink: 0, paddingLeft: 6 },
  colAmount:    { width: 68, flexShrink: 0, textAlign: 'right' },
  colDesc:      { flex: 1, minWidth: 0, paddingLeft: 6 },
  taxText: {
    fontSize: 7,
    color: '#888',
    marginTop: 1,
  },
  bold: { fontWeight: 'bold' },
  emptyMsg: { fontSize: 8, color: '#888', marginTop: 8 },
})

function formatDate(d: string): string {
  return d.replace(/-/g, '/')
}

type Props = { report: JournalReport }

export function JournalDocument({ report }: Props) {
  const { periodName, filters, rows } = report
  const { dateFrom, dateTo, keyword, accountName } = filters

  const filterParts: string[] = []
  if (dateFrom || dateTo) {
    filterParts.push(`期間: ${dateFrom || ''}〜${dateTo || ''}`)
  }
  if (keyword) filterParts.push(`摘要: ${keyword}`)
  if (accountName) filterParts.push(`科目: ${accountName}`)

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <View fixed wrap={false}>
          <PDFHeader title="仕訳日記帳" periodName={periodName} />

          {filterParts.length > 0 && (
            <Text style={s.filterRow}>{filterParts.join('　')}</Text>
          )}

          <View style={s.colHeader}>
            <Text style={[s.colDate, s.colHeaderText]}>日付</Text>
            <Text style={[s.colRef, s.colHeaderText]}>伝票No</Text>
            <Text style={[s.colAccount, s.colHeaderText]}>借方科目</Text>
            <Text style={[s.colAmount, s.colHeaderText]}>借方金額</Text>
            <Text style={[s.colAccount, s.colHeaderText]}>貸方科目</Text>
            <Text style={[s.colAmount, s.colHeaderText]}>貸方金額</Text>
            <Text style={[s.colDesc, s.colHeaderText]}>摘要</Text>
          </View>
        </View>

        <View style={s.table}>
          {rows.length === 0 && (
            <Text style={s.emptyMsg}>仕訳データがありません。</Text>
          )}

          {rows.map((row, idx) => (
            <View
              key={`${row.entryId}-${idx}`}
              // 行を分割すると空になった日付・伝票No列が次ページで落ち、科目以降が左にずれるため。
              wrap={false}
              style={row.isLastRowOfEntry ? [s.row, s.rowLast] : s.row}
            >
              {/* 日付 */}
              <Text style={s.colDate}>
                {row.isFirstRow ? formatDate(row.date) : ''}
              </Text>

              {/* 伝票No */}
              <Text style={s.colRef}>
                {row.isFirstRow ? (row.referenceNumber ?? '') : ''}
              </Text>

              {/* 借方科目 */}
              <View style={s.colAccount}>
                <Text>{row.debitAccountDisplay}</Text>
                {row.debitTaxCode ? (
                  <Text style={s.taxText}>{row.debitTaxCode}</Text>
                ) : null}
              </View>

              {/* 借方金額 */}
              <Text style={s.colAmount}>
                {row.debitAmount != null ? fmt(row.debitAmount) : ''}
              </Text>

              {/* 貸方科目 */}
              <View style={s.colAccount}>
                <Text>{row.creditAccountDisplay}</Text>
                {row.creditTaxCode ? (
                  <Text style={s.taxText}>{row.creditTaxCode}</Text>
                ) : null}
              </View>

              {/* 貸方金額 */}
              <Text style={s.colAmount}>
                {row.creditAmount != null ? fmt(row.creditAmount) : ''}
              </Text>

              {/* 摘要 */}
              <View style={s.colDesc}>
                {row.isFirstRow ? (
                  <>
                    {row.isOpeningBalance ? (
                      <Text style={{ fontSize: 6, color: '#888' }}>[期首] </Text>
                    ) : null}
                    <Text>{row.description}</Text>
                  </>
                ) : null}
              </View>
            </View>
          ))}
        </View>

        <PDFFooter />
      </Page>
    </Document>
  )
}
