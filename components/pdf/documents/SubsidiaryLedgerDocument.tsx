import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { SubsidiaryLedgerReport } from '@/lib/reports/subsidiary-ledger'
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
  accountInfoRow: {
    fontSize: 8,
    color: '#444',
    marginBottom: 8,
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
    paddingVertical: 2,
    paddingHorizontal: 2,
    minHeight: 14,
    alignItems: 'center',
  },
  openingRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#bbb',
    backgroundColor: '#f5f5f5',
    paddingVertical: 2,
    paddingHorizontal: 2,
    minHeight: 14,
    alignItems: 'center',
  },
  totalRow: {
    flexDirection: 'row',
    borderTopWidth: 1.5,
    borderTopColor: '#333',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingVertical: 3,
    paddingHorizontal: 2,
    marginTop: 2,
    alignItems: 'center',
  },
  // 列幅（A4横 ~785pt）
  colDate:    { width: 52 },
  colRef:     { width: 42 },
  colCounter: { width: 100 },
  colDesc:    { flex: 1 },
  colAmount:  { width: 72, textAlign: 'right' },
  bold: { fontWeight: 'bold' },
  muted: { color: '#888' },
  emptyMsg: { fontSize: 8, color: '#888', marginTop: 8 },
})

function fmtOrEmpty(n: number, show: boolean): string {
  if (!show || n === 0) return ''
  return fmt(n)
}

type Props = { report: SubsidiaryLedgerReport }

export function SubsidiaryLedgerDocument({ report }: Props) {
  const {
    periodName,
    accountName,
    parentName,
    openingBalance,
    isDebitNormal,
    periodStartDate,
    rows,
  } = report

  const showOpeningRow = openingBalance !== 0

  // 前期繰越行の借方・貸方振り分け（LedgerDocument.tsx と同一ロジック）
  const openingDebit = isDebitNormal
    ? (openingBalance > 0 ? openingBalance : 0)
    : (openingBalance < 0 ? -openingBalance : 0)
  const openingCredit = isDebitNormal
    ? (openingBalance < 0 ? -openingBalance : 0)
    : (openingBalance > 0 ? openingBalance : 0)

  const totalDebit  = rows.filter(r => r.side === 'DEBIT').reduce((s, r) => s + r.amount, 0)
  const totalCredit = rows.filter(r => r.side === 'CREDIT').reduce((s, r) => s + r.amount, 0)
  const closingBalance = rows.length > 0 ? rows[rows.length - 1].balance : openingBalance

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <PDFHeader title="補助元帳" periodName={periodName} />

        <Text style={s.accountInfoRow}>
          親科目：{parentName}　補助科目：{accountName}
        </Text>

        <View style={s.table}>
          {/* 列ヘッダー */}
          <View style={s.colHeader}>
            <Text style={[s.colDate,    s.colHeaderText]}>日付</Text>
            <Text style={[s.colRef,     s.colHeaderText]}>伝票No</Text>
            <Text style={[s.colCounter, s.colHeaderText]}>相手科目</Text>
            <Text style={[s.colDesc,    s.colHeaderText]}>摘要</Text>
            <Text style={[s.colAmount,  s.colHeaderText]}>借方</Text>
            <Text style={[s.colAmount,  s.colHeaderText]}>貸方</Text>
            <Text style={[s.colAmount,  s.colHeaderText]}>残高</Text>
          </View>

          {/* 前期繰越行 */}
          {showOpeningRow && (
            <View style={s.openingRow}>
              <Text style={s.colDate}>{periodStartDate}</Text>
              <Text style={[s.colRef,     s.muted]}>-</Text>
              <Text style={[s.colCounter, s.muted]}>-</Text>
              <Text style={[s.colDesc,    s.bold]}>前期繰越</Text>
              <Text style={s.colAmount}>
                {openingDebit > 0 ? fmt(openingDebit) : ''}
              </Text>
              <Text style={s.colAmount}>
                {openingCredit > 0 ? fmt(openingCredit) : ''}
              </Text>
              <Text style={[s.colAmount, s.bold]}>
                {fmt(Math.abs(openingBalance))}
              </Text>
            </View>
          )}

          {/* データなし */}
          {rows.length === 0 && !showOpeningRow && (
            <Text style={s.emptyMsg}>この科目の仕訳データがありません。</Text>
          )}

          {/* 明細行 */}
          {rows.map((row) => (
            <View key={`${row.id}-${row.line_number}`} style={s.row}>
              <Text style={s.colDate}>{row.date}</Text>
              <Text style={s.colRef}>{row.reference_number ?? '-'}</Text>
              <Text style={s.colCounter}>{row.counter_account_name ?? '-'}</Text>
              <Text style={s.colDesc}>{row.entry_description}</Text>
              <Text style={s.colAmount}>
                {fmtOrEmpty(row.amount, row.side === 'DEBIT')}
              </Text>
              <Text style={s.colAmount}>
                {fmtOrEmpty(row.amount, row.side === 'CREDIT')}
              </Text>
              <Text style={s.colAmount}>{fmt(row.balance)}</Text>
            </View>
          ))}

          {/* 合計行 */}
          {(rows.length > 0 || showOpeningRow) && (
            <View style={s.totalRow}>
              <Text style={[s.colDate, s.bold]}>合計</Text>
              <Text style={s.colRef} />
              <Text style={s.colCounter} />
              <Text style={s.colDesc} />
              <Text style={[s.colAmount, s.bold]}>{fmt(totalDebit)}</Text>
              <Text style={[s.colAmount, s.bold]}>{fmt(totalCredit)}</Text>
              <Text style={[s.colAmount, s.bold]}>{fmt(closingBalance)}</Text>
            </View>
          )}
        </View>

        <PDFFooter />
      </Page>
    </Document>
  )
}
