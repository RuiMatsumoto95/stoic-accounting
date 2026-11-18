// 弥生会計の税区分表記を、このアプリの tax_codes.id に変換する。
// 弥生の表記は「区分 + 内/込/外/別 + 簡易課税の事業区分 + 税率」で規則的に作られるため、
// 表記を全部並べず分解して照合する。対応づけられない場合は「対象外」で取り込み、警告を返す。
import type { TaxMethod } from '@/lib/tax-codes'

export const FALLBACK_TAX_CODE_ID = 'OUT_OF_SCOPE'

export type YayoiTaxResult = { id: string | null; warning?: string }

// 税率・区分によらず事業者タイプに関係なく使える区分（tax_codes.applies_to = ALL）
const FIXED: Record<string, string> = {
  '対象外': 'OUT_OF_SCOPE',
  '非課税売上': 'NON_TAXABLE_SALES',
  '非課売上': 'NON_TAXABLE_SALES',
  '非課税仕入': 'NON_TAXABLE_PURCHASE',
  '非課仕入': 'NON_TAXABLE_PURCHASE',
  '輸出売上': 'EXPORT_SALES',
  '対象外売上': 'OUT_OF_SCOPE_SALES',
  '対外売上': 'OUT_OF_SCOPE_SALES',
  '対象外仕入': 'OUT_OF_SCOPE_PURCHASE',
  '対外仕入': 'OUT_OF_SCOPE_PURCHASE',
}

type Group =
  | 'SALES'
  | 'SALES_RETURN'
  | 'PURCHASE'
  | 'PURCHASE_RETURN'
  | 'NONTAX_PURCHASE'
  | 'NONTAX_PURCHASE_RETURN'
  | 'COMMON_PURCHASE'
  | 'COMMON_PURCHASE_RETURN'

// 弥生の略称・正式名称・旧表記 → 区分
const GROUP_NAMES: Record<string, Group> = {
  '課税売上': 'SALES',
  '課税売上返還': 'SALES_RETURN',
  '課税売返': 'SALES_RETURN',
  '課対仕入': 'PURCHASE',
  '課税仕入': 'PURCHASE',
  '課税対応仕入': 'PURCHASE',
  '課対仕返': 'PURCHASE_RETURN',
  '課税仕入返還': 'PURCHASE_RETURN',
  '課税対応仕入返還': 'PURCHASE_RETURN',
  '非対仕入': 'NONTAX_PURCHASE',
  '非課税対応仕入': 'NONTAX_PURCHASE',
  '非対仕返': 'NONTAX_PURCHASE_RETURN',
  '非課税対応仕入返還': 'NONTAX_PURCHASE_RETURN',
  '共対仕入': 'COMMON_PURCHASE',
  '共通対応仕入': 'COMMON_PURCHASE',
  '共対仕返': 'COMMON_PURCHASE_RETURN',
  '共通対応仕入返還': 'COMMON_PURCHASE_RETURN',
}

const KANJI_KIND: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }

// 長い名前を先に照合する（「課税売上返還」が「課税売上」に食われないように）
const NAMES_PATTERN = Object.keys(GROUP_NAMES)
  .sort((a, b) => b.length - a.length)
  .join('|')

// 区分 + (内|込|外|別) + (事業区分 一〜六) + (軽減) + (税率%) + (軽減|軽|(軽))
const TAXED_RE = new RegExp(
  `^(${NAMES_PATTERN})(内|込|外|別)?([一二三四五六])?(軽減)?(?:(\\d{1,2})%)?(軽減|軽|\\(軽\\))?$`
)

type Pick = { kind: 'id'; id: string } | { kind: 'blank' } | { kind: 'none' }

const id = (v: string): Pick => ({ kind: 'id', id: v })
const BLANK: Pick = { kind: 'blank' } // 簡易課税の仕入: tax_codes に仕入側の区分が無いため空にする
const NONE: Pick = { kind: 'none' } // この事業者タイプに対応する区分が無い

function pickCode(group: Group, method: TaxMethod, rate: '10' | '8K', kind: number | null): Pick {
  const r = rate
  if (method === 'EXEMPT') return NONE

  switch (group) {
    case 'SALES':
      if (method === 'STANDARD_PROPORTIONAL') return id(`PROP_SALES_${r}`)
      if (method === 'STANDARD_INDIVIDUAL') return id(`INDIV_SALES_${r}`)
      return kind ? id(`SIMPLE_S${kind}_${r}`) : id(`SIMPLE_SALES_${r}`)
    case 'SALES_RETURN':
      if (method === 'STANDARD_PROPORTIONAL') return id(`PROP_SALES_RETURN_${r}`)
      if (method === 'STANDARD_INDIVIDUAL') return id(`INDIV_SALES_RETURN_${r}`)
      return id(`SIMPLE_SALES_RETURN_${r}`) // 区分別の返還コードは無いため、事業区分は見ない
    case 'PURCHASE':
      if (method === 'SIMPLE') return BLANK
      return id(method === 'STANDARD_PROPORTIONAL' ? `PROP_PURCHASE_${r}` : `INDIV_PURCHASE_TAXABLE_${r}`)
    case 'PURCHASE_RETURN':
      if (method === 'SIMPLE') return BLANK
      return id(
        method === 'STANDARD_PROPORTIONAL' ? `PROP_PURCHASE_RETURN_${r}` : `INDIV_PURCHASE_TAXABLE_RETURN_${r}`
      )
    // 非課税対応・共通対応は個別対応方式にだけ存在する
    case 'NONTAX_PURCHASE':
      if (method === 'SIMPLE') return BLANK
      return method === 'STANDARD_INDIVIDUAL' ? id(`INDIV_PURCHASE_NONTAXABLE_${r}`) : NONE
    case 'NONTAX_PURCHASE_RETURN':
      if (method === 'SIMPLE') return BLANK
      return method === 'STANDARD_INDIVIDUAL' ? id(`INDIV_PURCHASE_NONTAXABLE_RETURN_${r}`) : NONE
    case 'COMMON_PURCHASE':
      if (method === 'SIMPLE') return BLANK
      return method === 'STANDARD_INDIVIDUAL' ? id(`INDIV_PURCHASE_COMMON_${r}`) : NONE
    case 'COMMON_PURCHASE_RETURN':
      if (method === 'SIMPLE') return BLANK
      return method === 'STANDARD_INDIVIDUAL' ? id(`INDIV_PURCHASE_COMMON_RETURN_${r}`) : NONE
  }
}

const fallback = (reason: string): YayoiTaxResult => ({
  id: FALLBACK_TAX_CODE_ID,
  warning: `${reason}ため「対象外」で登録しました`,
})

/**
 * 弥生の税区分表記を tax_codes.id に変換する。
 * ・空欄 → id: null（警告なし）
 * ・対応づけられない → 「対象外」で登録し、警告を返す
 * ・簡易課税の仕入 → id: null（警告なし。簡易課税の tax_codes に仕入側の区分が無い）
 * ・外税・別記 → 対応する区分で登録し、警告を返す（金額が税抜の可能性があるため）
 */
export function resolveYayoiTaxCode(rawText: string, method: TaxMethod): YayoiTaxResult {
  const trimmed = rawText.trim()
  if (!trimmed) return { id: null }

  // 全角・半角の表記ゆれを揃え、空白を除く。末尾の「適格」（インボイス区分）は区分の判定に使わない
  const text = trimmed.normalize('NFKC').replace(/\s+/g, '').replace(/適格$/, '')

  const fixed = FIXED[text]
  if (fixed) return { id: fixed }

  const m = TAXED_RE.exec(text)
  if (!m) return fallback(`税区分「${trimmed}」に対応する区分が見つからない`)

  const [, name, mode, kindChar, keigenBefore, ratePct, keigenAfter] = m
  const keigen = Boolean(keigenBefore || keigenAfter)

  let rate: '10' | '8K' | null = null
  if (ratePct === undefined) rate = keigen ? '8K' : '10' // 「課税仕入」のように税率の無い旧表記は 10%（軽減のみ付くなら 8%軽減）
  else if (ratePct === '10' && !keigen) rate = '10'
  else if (ratePct === '8' && keigen) rate = '8K'
  if (!rate) return fallback(`税区分「${trimmed}」の税率に対応する区分が見つからない`)

  const picked = pickCode(GROUP_NAMES[name], method, rate, kindChar ? KANJI_KIND[kindChar] : null)
  if (picked.kind === 'blank') return { id: null }
  if (picked.kind === 'none') {
    return fallback(`税区分「${trimmed}」は現在の事業者タイプに対応する区分が無い`)
  }

  if (mode === '外' || mode === '別') {
    return {
      id: picked.id,
      warning: `外税・別記の表記です。金額が税抜の場合、内税の区分と金額の意味が異なります（金額はCSVのまま登録）`,
    }
  }
  return { id: picked.id }
}
