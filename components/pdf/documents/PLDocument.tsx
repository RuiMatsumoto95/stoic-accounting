import { Document, Page, View, Text } from '@react-pdf/renderer'
import { StyleSheet } from '@react-pdf/renderer'
import type { PLReport } from '@/lib/reports/income-statement'
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
  sectionHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#bbb',
    marginTop: 4,
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
  report: PLReport
  showPrev: boolean
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

function IntermediateRow({ label, amount, prevAmount, showPrev }: {
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

export function PLDocument({ report, showPrev }: Props) {
  const { data, sections, periodName } = report

  const getSection = (cat: string) =>
    sections.find(sec => sec.category === cat) ?? { items: [], subtotal: 0, prev_subtotal: null }

  const revenue   = getSection('REVENUE')
  const cogs      = getSection('COGS')
  const sga       = getSection('SGA')
  const nonOpInc  = getSection('NON_OP_INCOME')
  const nonOpExp  = getSection('NON_OP_EXPENSE')
  const extraInc  = getSection('EXTRA_INCOME')
  const extraLoss = getSection('EXTRA_LOSS')
  const tax       = getSection('TAX')

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <PDFHeader title="損益計算書" periodName={periodName} />

        {/* 列ヘッダー */}
        <View style={s.colHeader}>
          <Text style={[s.labelCell, s.colHeaderText]}>科目</Text>
          {showPrev && <Text style={[s.prevCell, s.colHeaderText]}>前期</Text>}
          <Text style={[s.amountCell, s.colHeaderText]}>当期</Text>
        </View>

        <View style={s.table}>
          {/* 売上高 */}
          <SectionBlock
            label="売上高"
            items={revenue.items}
            subtotalLabel="売上高合計"
            subtotal={data.revenueTotal}
            prevSubtotal={data.prev?.revenueTotal ?? null}
            showPrev={showPrev}
          />

          {/* 売上原価 */}
          <SectionBlock
            label="売上原価"
            items={cogs.items}
            subtotalLabel="売上原価合計"
            subtotal={data.cogsTotal}
            prevSubtotal={data.prev?.cogsTotal ?? null}
            showPrev={showPrev}
          />

          {/* 売上総利益 */}
          <IntermediateRow
            label="売上総利益"
            amount={data.grossProfit}
            prevAmount={data.prev?.grossProfit ?? null}
            showPrev={showPrev}
          />

          {/* 販管費 */}
          <SectionBlock
            label="販売費及び一般管理費"
            items={sga.items}
            subtotalLabel="販管費合計"
            subtotal={data.sgaTotal}
            prevSubtotal={data.prev?.sgaTotal ?? null}
            showPrev={showPrev}
          />

          {/* 営業損益 */}
          <IntermediateRow
            label="営業損益"
            amount={data.operatingIncome}
            prevAmount={data.prev?.operatingIncome ?? null}
            showPrev={showPrev}
          />

          {/* 営業外収益 */}
          {nonOpInc.items.length > 0 && (
            <SectionBlock
              label="営業外収益"
              items={nonOpInc.items}
              subtotalLabel="営業外収益合計"
              subtotal={data.nonOpIncomeTotal}
              prevSubtotal={data.prev?.nonOpIncomeTotal ?? null}
              showPrev={showPrev}
            />
          )}

          {/* 営業外費用 */}
          {nonOpExp.items.length > 0 && (
            <SectionBlock
              label="営業外費用"
              items={nonOpExp.items}
              subtotalLabel="営業外費用合計"
              subtotal={data.nonOpExpenseTotal}
              prevSubtotal={data.prev?.nonOpExpenseTotal ?? null}
              showPrev={showPrev}
            />
          )}

          {/* 経常損益 */}
          <IntermediateRow
            label="経常損益"
            amount={data.ordinaryIncome}
            prevAmount={data.prev?.ordinaryIncome ?? null}
            showPrev={showPrev}
          />

          {/* 特別利益 */}
          {extraInc.items.length > 0 && (
            <SectionBlock
              label="特別利益"
              items={extraInc.items}
              subtotalLabel="特別利益合計"
              subtotal={data.extraIncomeTotal}
              prevSubtotal={data.prev?.extraIncomeTotal ?? null}
              showPrev={showPrev}
            />
          )}

          {/* 特別損失 */}
          {extraLoss.items.length > 0 && (
            <SectionBlock
              label="特別損失"
              items={extraLoss.items}
              subtotalLabel="特別損失合計"
              subtotal={data.extraLossTotal}
              prevSubtotal={data.prev?.extraLossTotal ?? null}
              showPrev={showPrev}
            />
          )}

          {/* 税引前当期純損益 */}
          <IntermediateRow
            label="税引前当期純損益"
            amount={data.incomeBeforeTax}
            prevAmount={data.prev?.incomeBeforeTax ?? null}
            showPrev={showPrev}
          />

          {/* 法人税等 */}
          {tax.items.length > 0 && (
            <SectionBlock
              label="法人税等"
              items={tax.items}
              subtotalLabel="法人税等合計"
              subtotal={data.taxTotal}
              prevSubtotal={data.prev?.taxTotal ?? null}
              showPrev={showPrev}
            />
          )}

          {/* 当期純損益 */}
          <IntermediateRow
            label="当期純損益"
            amount={data.netIncome}
            prevAmount={data.prev?.netIncome ?? null}
            showPrev={showPrev}
          />
        </View>

        <PDFFooter />
      </Page>
    </Document>
  )
}
