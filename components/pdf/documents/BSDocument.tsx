import { Document, Page, View, Text } from '@react-pdf/renderer'
import { StyleSheet } from '@react-pdf/renderer'
import type { BSReport } from '@/lib/reports/balance-sheet'
import { PDFHeader } from '../common/PDFHeader'
import { PDFFooter } from '../common/PDFFooter'
import { fmt, fmtAmount } from '@/lib/pdf/pdf-utils'

const s = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 9,
    paddingTop: 30,
    paddingBottom: 40,
    paddingHorizontal: 35,
    color: '#111',
  },
  table: { width: '100%' },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.3,
    borderBottomColor: '#e0e0e0',
    paddingVertical: 2,
    paddingHorizontal: 4,
    minHeight: 16,
    alignItems: 'center',
  },
  partHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#e0e8f0',
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#9ab',
    marginTop: 6,
    alignItems: 'center',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#bbb',
    marginTop: 3,
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
  indentLabel: { flex: 1, paddingLeft: 12 },
  amountCell: { width: 90, textAlign: 'right' },
  prevCell: { width: 90, textAlign: 'right', color: '#555' },
  bold: { fontWeight: 'bold' },
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
})

type Props = {
  report: BSReport
  showPrev: boolean
}

function PartHeader({ label, showPrev }: { label: string; showPrev: boolean }) {
  return (
    <View style={s.partHeaderRow}>
      <Text style={[s.labelCell, s.bold]}>{label}</Text>
      {showPrev && <Text style={s.prevCell} />}
      <Text style={s.amountCell} />
    </View>
  )
}

function SectionBlock({ label, items, subtotalLabel, subtotal, prevSubtotal, showPrev }: {
  label: string
  items: { account_name: string; amount: number; prev_amount: number | null }[]
  subtotalLabel: string
  subtotal: number
  prevSubtotal: number | null
  showPrev: boolean
}) {
  return (
    <View>
      <View style={s.sectionHeaderRow}>
        <Text style={[s.labelCell, s.bold]}>{label}</Text>
        {showPrev && <Text style={s.prevCell} />}
        <Text style={s.amountCell} />
      </View>
      {items.map((item, i) => (
        <View key={i} style={s.row}>
          <Text style={s.indentLabel}>{item.account_name}</Text>
          {showPrev && (
            <Text style={s.prevCell}>{item.prev_amount != null ? fmt(item.prev_amount) : '-'}</Text>
          )}
          <Text style={s.amountCell}>{fmt(item.amount)}</Text>
        </View>
      ))}
      <View style={s.subtotalRow}>
        <Text style={[s.labelCell, s.bold]}>{subtotalLabel}</Text>
        {showPrev && <Text style={[s.prevCell, s.bold]}>{prevSubtotal != null ? fmt(prevSubtotal) : '-'}</Text>}
        <Text style={[s.amountCell, s.bold]}>{fmt(subtotal)}</Text>
      </View>
    </View>
  )
}

function TotalRow({ label, amount, prevAmount, showPrev }: {
  label: string
  amount: number
  prevAmount: number | null
  showPrev: boolean
}) {
  return (
    <View style={s.totalRow}>
      <Text style={[s.labelCell, s.bold]}>{label}</Text>
      {showPrev && <Text style={[s.prevCell, s.bold]}>{prevAmount != null ? fmtAmount(prevAmount) : '-'}</Text>}
      <Text style={[s.amountCell, s.bold]}>{fmtAmount(amount)}</Text>
    </View>
  )
}

export function BSDocument({ report, showPrev }: Props) {
  const { data, sections, periodName } = report

  const getSection = (cat: string) =>
    sections.find(sec => sec.category === cat) ?? { items: [], subtotal: 0, prev_subtotal: null }

  const currentAssets      = getSection('CURRENT_ASSETS')
  const fixedAssets        = getSection('FIXED_ASSETS')
  const deferredAssets     = getSection('DEFERRED_ASSETS')
  const currentLiabilities = getSection('CURRENT_LIABILITIES')
  const fixedLiabilities   = getSection('FIXED_LIABILITIES')
  const equity             = getSection('EQUITY')

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <PDFHeader title="貸借対照表" periodName={periodName} />

        {/* 列ヘッダー */}
        <View style={s.colHeader}>
          <Text style={[s.labelCell, s.colHeaderText]}>科目</Text>
          {showPrev && <Text style={[s.prevCell, s.colHeaderText]}>前期</Text>}
          <Text style={[s.amountCell, s.colHeaderText]}>当期</Text>
        </View>

        <View style={s.table}>
          {/* ── 資産の部 ── */}
          <PartHeader label="資産の部" showPrev={showPrev} />

          <SectionBlock
            label="流動資産"
            items={currentAssets.items}
            subtotalLabel="流動資産合計"
            subtotal={data.currentAssetsTotal}
            prevSubtotal={data.prev?.currentAssetsTotal ?? null}
            showPrev={showPrev}
          />

          {fixedAssets.items.length > 0 && (
            <SectionBlock
              label="固定資産"
              items={fixedAssets.items}
              subtotalLabel="固定資産合計"
              subtotal={data.fixedAssetsTotal}
              prevSubtotal={data.prev?.fixedAssetsTotal ?? null}
              showPrev={showPrev}
            />
          )}

          {deferredAssets.items.length > 0 && (
            <SectionBlock
              label="繰延資産"
              items={deferredAssets.items}
              subtotalLabel="繰延資産合計"
              subtotal={data.deferredAssetsTotal}
              prevSubtotal={data.prev?.deferredAssetsTotal ?? null}
              showPrev={showPrev}
            />
          )}

          <TotalRow
            label="資産合計"
            amount={data.totalAssets}
            prevAmount={data.prev?.totalAssets ?? null}
            showPrev={showPrev}
          />

          {/* ── 負債の部 ── */}
          <PartHeader label="負債の部" showPrev={showPrev} />

          <SectionBlock
            label="流動負債"
            items={currentLiabilities.items}
            subtotalLabel="流動負債合計"
            subtotal={data.currentLiabilitiesTotal}
            prevSubtotal={data.prev?.currentLiabilitiesTotal ?? null}
            showPrev={showPrev}
          />

          {fixedLiabilities.items.length > 0 && (
            <SectionBlock
              label="固定負債"
              items={fixedLiabilities.items}
              subtotalLabel="固定負債合計"
              subtotal={data.fixedLiabilitiesTotal}
              prevSubtotal={data.prev?.fixedLiabilitiesTotal ?? null}
              showPrev={showPrev}
            />
          )}

          <TotalRow
            label="負債合計"
            amount={data.totalLiabilities}
            prevAmount={data.prev?.totalLiabilities ?? null}
            showPrev={showPrev}
          />

          {/* ── 純資産の部 ── */}
          <PartHeader label="純資産の部" showPrev={showPrev} />

          <SectionBlock
            label="純資産"
            items={equity.items}
            subtotalLabel="純資産小計"
            subtotal={equity.subtotal}
            prevSubtotal={equity.prev_subtotal}
            showPrev={showPrev}
          />

          {/* 当期純損益（固定行） */}
          <View style={s.row}>
            <Text style={s.indentLabel}>当期純損益</Text>
            {showPrev && (
              <Text style={s.prevCell}>
                {data.prev?.netIncome != null ? fmtAmount(data.prev.netIncome) : '-'}
              </Text>
            )}
            <Text style={s.amountCell}>{fmtAmount(data.netIncome)}</Text>
          </View>

          <TotalRow
            label="純資産合計"
            amount={data.equityTotal}
            prevAmount={data.prev?.equityTotal ?? null}
            showPrev={showPrev}
          />

          <TotalRow
            label="負債純資産合計"
            amount={data.totalLiabilitiesAndEquity}
            prevAmount={data.prev?.totalLiabilitiesAndEquity ?? null}
            showPrev={showPrev}
          />
        </View>

        <PDFFooter />
      </Page>
    </Document>
  )
}
