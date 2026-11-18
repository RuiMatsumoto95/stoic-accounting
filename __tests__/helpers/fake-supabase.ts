// CSVパーサーのテスト用の偽 Supabase クライアントと、架空のマスタデータ。
// 実在の科目体系・取引データは使わない。各テストの前に resetFakeDb() で初期状態に戻すこと
// （テスト間でデータや事業者タイプが漏れないようにするため）。
import type { TaxMethod } from '@/lib/tax-codes'

type Row = Record<string, unknown>
type FakeDb = { tables: Record<string, Row[]>; taxMethod: TaxMethod | null }

export const ID = {
  cash: 'acc-cash',
  bank: 'acc-bank',
  bankA: 'acc-bank-a',
  sales: 'acc-sales',
  supplies: 'acc-supplies',
  misc: 'acc-misc',
} as const

function defaults(): FakeDb {
  return {
    taxMethod: 'STANDARD_PROPORTIONAL',
    tables: {
      accounts: [
        { id: ID.cash, name: '現金', parent_id: null, account_aliases: [{ normalized_alias: 'cash' }] },
        { id: ID.bank, name: '普通預金', parent_id: null, account_aliases: [{ normalized_alias: 'ふつうよきん' }] },
        { id: ID.bankA, name: 'A銀行', parent_id: ID.bank, account_aliases: [{ normalized_alias: 'えーぎんこう' }] },
        { id: ID.sales, name: '売上高', parent_id: null, account_aliases: [] },
        { id: ID.supplies, name: '消耗品費', parent_id: null, account_aliases: [{ normalized_alias: 'しょうもうひん' }] },
        { id: ID.misc, name: '雑費', parent_id: null, account_aliases: [] },
      ],
      // fetchImportData は .eq('is_current', true) で絞るが、偽クライアントは絞り込まない（現行データのみ入れる）
      tax_codes: [
        { id: 'PROP_PURCHASE_10', name: '課税仕入10%', short_name: '仕入10' },
        { id: 'OUT_OF_SCOPE', name: '対象外', short_name: null },
      ],
      mapping_rules: [
        { keyword: 'ｱﾏｿﾞﾝ', account_id: ID.supplies },
        { keyword: 'あ銀', account_id: ID.bankA },
      ],
    },
  }
}

export const fakeDb: FakeDb = defaults()

export function resetFakeDb(): void {
  const d = defaults()
  fakeDb.tables = d.tables
  fakeDb.taxMethod = d.taxMethod
}

export function setTaxMethod(method: TaxMethod | null): void {
  fakeDb.taxMethod = method
}

type Result = { data: unknown; error: { message: string } | null }

type FakeQuery = {
  select: () => FakeQuery
  eq: () => FakeQuery
  single: () => Promise<Result>
  then: PromiseLike<Result>['then']
}

export const fakeSupabase = {
  from(table: string): FakeQuery {
    const list = (): Promise<Result> => Promise.resolve({ data: fakeDb.tables[table] ?? [], error: null })
    const query: FakeQuery = {
      select: () => query,
      eq: () => query,
      single: () =>
        Promise.resolve(
          table === 'companies'
            ? fakeDb.taxMethod
              ? { data: { tax_method: fakeDb.taxMethod }, error: null }
              : { data: null, error: { message: 'not found' } }
            : { data: fakeDb.tables[table]?.[0] ?? null, error: null },
        ),
      then: (onfulfilled, onrejected) => list().then(onfulfilled, onrejected),
    }
    return query
  },
}

// --- CSV 行の組み立て（無関係な列には 'noise' を入れて、列の取り違えを検出する） ---

export function customRow(v: {
  date?: string
  debit?: string
  debitSub?: string
  debitTax?: string
  debitAmount?: string
  credit?: string
  creditSub?: string
  creditTax?: string
  creditAmount?: string
  description?: string
}): string[] {
  return [
    v.date ?? '2026/4/1',
    v.debit ?? '消耗品費',
    v.debitSub ?? '',
    v.debitTax ?? '',
    v.debitAmount ?? '1000',
    v.credit ?? '現金',
    v.creditSub ?? '',
    v.creditTax ?? '',
    v.creditAmount ?? '1000',
    v.description ?? '',
  ]
}

export function yayoiRow(v: {
  flag?: string
  date?: string
  debit?: string
  debitSub?: string
  debitTax?: string
  debitAmount?: string
  credit?: string
  creditSub?: string
  creditTax?: string
  creditAmount?: string
  description?: string
}): string[] {
  const cols = Array.from({ length: 27 }, () => 'noise')
  cols[0] = v.flag ?? '2000'
  cols[3] = v.date ?? '2026/4/1'
  cols[4] = v.debit ?? '消耗品費'
  cols[5] = v.debitSub ?? ''
  cols[7] = v.debitTax ?? ''
  cols[8] = v.debitAmount ?? '1000'
  cols[10] = v.credit ?? '現金'
  cols[11] = v.creditSub ?? ''
  cols[13] = v.creditTax ?? ''
  cols[14] = v.creditAmount ?? '1000'
  cols[16] = v.description ?? ''
  return cols
}
