/**
 * staging の numeric(15,2) による丸めを防ぐため、CSV 取込だけ整数円に限定する。
 * 前後の空白と全カンマを除去し、空欄は未使用の 0、小数部がすべて 0 なら整数部を返す。
 * 整数部は安全に Number 化できる 13 桁まで。手入力（lib/journal-save.ts）は小数第2位まで許可し、DB 全体の制約ではない。
 */
export function normalizeAmountText(raw: string, fullWidth = false): string {
  const text = fullWidth ? raw.replace(/[０-９，．－]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0)) : raw
  return text.trim().replace(/,/g, '')
}

export function parseCsvAmount(raw: string): { ok: true; value: number } | { ok: false; message: string } {
  const normalized = normalizeAmountText(raw)
  if (normalized === '') return { ok: true, value: 0 }

  if (!/^[0-9]{1,13}(\.[0-9]+)?$/.test(normalized)) {
    return { ok: false, message: '金額の形式が正しくありません（半角数字のみ・13桁まで）' }
  }

  const [integer, fraction = ''] = normalized.split('.')
  if (/[1-9]/.test(fraction)) {
    return { ok: false, message: '小数点以下は指定できません（整数円のみ）' }
  }

  return { ok: true, value: Number(integer) }
}
