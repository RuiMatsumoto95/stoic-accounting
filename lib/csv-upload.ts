// CSV アップロードの前処理（文字コードの判定と、見出し行の扱い）。画面（CsvUploader）から切り出した純粋関数

export type CsvFormat = 'custom' | 'yayoi'

/**
 * バイト列を文字列にする。UTF-8 として厳密に読めなければ Shift-JIS（Windows-31J）として読み直す。
 * 弥生の出力 CSV や、日本語環境の Excel で保存した CSV は Shift-JIS のことが多い。UTF-8 の BOM は取り除かれる。
 */
export function decodeCsvText(input: ArrayBuffer | Uint8Array): { text: string; encoding: 'utf-8' | 'shift_jis' } {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'shift_jis' }
  }
}

// 弥生の識別フラグ（2000・2111・2110 など）は 4 桁の数字
const YAYOI_FLAG = /^\d{4}$/

/**
 * パース済みの行から、パーサーに渡すデータ行を取り出す。
 * ・独自形式: 先頭行を見出し行として捨てる（従来どおり）
 * ・弥生形式: 見出し行なしで出力されるため、先頭行も仕訳として扱う。
 *   先頭行の識別フラグが 4 桁の数字でなければ、見出し行付きのファイルとみなしてエラーにする
 *   （黙って捨てると、仕訳の欠落と見分けがつかないため）
 */
export function prepareCsvRows(
  format: CsvFormat,
  rows: string[][]
): { ok: true; rows: string[][] } | { ok: false; message: string } {
  if (format === 'custom') return { ok: true, rows: rows.slice(1) }
  if (rows.length === 0) return { ok: true, rows: [] }

  const first = (rows[0][0] ?? '').trim()
  if (!YAYOI_FLAG.test(first)) {
    const shown = first.length > 20 ? `${first.slice(0, 20)}…` : first
    return {
      ok: false,
      message:
        `弥生形式のCSVは見出し行なしで出力されます。1行目の先頭の値「${shown}」が識別フラグ（4桁の数字）ではないため、` +
        '見出し行付きのファイルは取り込めません。見出し行を削除するか、形式の選択を確認してください。',
    }
  }
  return { ok: true, rows }
}
