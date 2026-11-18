import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { SubsidiaryBalanceReport } from '@/lib/reports/subsidiary-balance'
import { TYPE_LABELS } from '@/lib/reports/subsidiary-balance'
import { PDFHeader } from '../common/PDFHeader'
import { PDFFooter } from '../common/PDFFooter'
import { fmt, fmtOb } from '@/lib/pdf/pdf-utils'

const s = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 9,
    paddingTop: 30,
    paddingBottom: 40,
    paddingHorizontal: 30,
    color: '#111',
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
  colHeaderText: { fontSize: 8, color: '#555' },
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
    paddingHorizontal: 2,
    minHeight: 16,
    alignItems: 'center',
  },
  subtotalRow: {
    flexDirection: 'row',
    backgroundColor: '#fafafa',
    paddingVertical: 2,
    paddingHorizontal: 2,
    borderTopWidth: 0.5,
    borderTopColor: '#bbb',
    borderBottomWidth: 0.5,
    borderBottomColor: '#bbb',
    alignItems: 'center',
  },
  totalRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 2,
    borderTopWidth: 1,
    borderTopColor: '#333',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    marginTop: 4,
    alignItems: 'center',
  },
  // 列幅（A4縦 ~535pt）
  colParent:  { width: 78 },
  colSub:     { flex: 1 },
  colAmount:  { width: 80, textAlign: 'right' },
  colAmountMuted: { width: 80, textAlign: 'right', color: '#888' },
  bold: { fontWeight: 'bold' },
  muted: { color: '#888' },
  emptyMsg: { fontSize: 9, color: '#888', marginTop: 8 },
})

type Props = { report: SubsidiaryBalanceReport }

export function SubsidiaryBalanceDocument({ report }: Props) {
  const { periodName, groups, grandOpening, grandDebit, grandCredit } = report

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <PDFHeader title="補助残高一覧表" periodName={periodName} />

        <View style={s.table}>
          {/* 列ヘッダー */}
          <View style={s.colHeader}>
            <Text style={[s.colParent, s.colHeaderText]}>親科目</Text>
            <Text style={[s.colSub,    s.colHeaderText]}>補助科目名</Text>
            <Text style={[s.colAmount, s.colHeaderText]}>期首残高</Text>
            <Text style={[s.colAmount, s.colHeaderText]}>当期借方</Text>
            <Text style={[s.colAmount, s.colHeaderText]}>当期貸方</Text>
            <Text style={[s.colAmount, s.colHeaderText]}>期末残高</Text>
          </View>

          {groups.length === 0 && (
            <Text style={s.emptyMsg}>データがありません。</Text>
          )}

          {groups.map((group) => (
            <View key={group.parentId}>
              {/* グループヘッダー行 */}
              <View style={s.groupHeaderRow}>
                <Text style={[s.colParent, s.bold]} />
                <Text style={[s.colSub, s.bold]}>
                  {group.parentName}（{TYPE_LABELS[group.parentType] ?? group.parentType}）
                </Text>
                <Text style={s.colAmount} />
                <Text style={s.colAmount} />
                <Text style={s.colAmount} />
                <Text style={s.colAmount} />
              </View>

              {/* 明細行 */}
              {group.rows.map((row) => (
                <View key={row.accountId} style={s.row}>
                  <Text style={[s.colParent, s.muted]}>{row.parentAccountName}</Text>
                  <Text style={s.colSub}>{row.accountName}</Text>
                  <Text style={s.colAmount}>
                    {row.isBs ? fmtOb(row.openingBalance) : '—'}
                  </Text>
                  <Text style={s.colAmount}>{fmt(row.debitTotal)}</Text>
                  <Text style={s.colAmount}>{fmt(row.creditTotal)}</Text>
                  <Text style={s.colAmount}>
                    {row.isBs ? fmtOb(row.closingBalance) : '—'}
                  </Text>
                </View>
              ))}

              {/* 小計行 */}
              <View style={s.subtotalRow}>
                <Text style={[s.colParent, s.muted]} />
                <Text style={[s.colSub, s.muted]}>小計</Text>
                <Text style={[s.colAmount, s.bold]}>
                  {group.isBs ? fmtOb(group.openingSubtotal) : '—'}
                </Text>
                <Text style={[s.colAmount, s.bold]}>{fmt(group.debitSubtotal)}</Text>
                <Text style={[s.colAmount, s.bold]}>{fmt(group.creditSubtotal)}</Text>
                <Text style={[s.colAmount, s.bold]}>
                  {group.isBs ? fmtOb(group.closingSubtotal) : '—'}
                </Text>
              </View>
            </View>
          ))}

          {/* 合計行 */}
          {groups.length > 0 && (
            <View style={s.totalRow}>
              <Text style={[s.colParent, s.bold]}>合計</Text>
              <Text style={s.colSub} />
              <Text style={[s.colAmount, s.bold]}>{fmtOb(grandOpening)}</Text>
              <Text style={[s.colAmount, s.bold]}>{fmt(grandDebit)}</Text>
              <Text style={[s.colAmount, s.bold]}>{fmt(grandCredit)}</Text>
              <Text style={[s.colAmountMuted]}>—</Text>
            </View>
          )}
        </View>

        <PDFFooter />
      </Page>
    </Document>
  )
}
