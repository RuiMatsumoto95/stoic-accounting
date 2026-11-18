export type ReferenceNumberInputResult =
  | { ok: true; value: number | null }
  | { ok: false; message: string }

const INVALID_MESSAGE = '伝票番号は1〜999999999の整数で入力してください。'

/** 入力中は文字列を保ち、保存・移動の直前にだけ正規化する。最終判定は DB が行う。 */
export function parseReferenceNumberInput(text: string): ReferenceNumberInputResult {
  const normalized = text.trim().replace(/[０-９]/g, digit =>
    String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
  if (normalized === '') return { ok: true, value: null }
  if (!/^[0-9]+$/.test(normalized)) return { ok: false, message: INVALID_MESSAGE }
  const value = Number(normalized)
  if (!Number.isInteger(value) || value < 1 || value > 999999999) {
    return { ok: false, message: INVALID_MESSAGE }
  }
  return { ok: true, value }
}
