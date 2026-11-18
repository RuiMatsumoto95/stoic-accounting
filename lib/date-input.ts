export type DateInputResult = { value: string; error: null } | { value: null; error: string }

// 通常のフォームは従来の解釈を維持し、インライン保存時だけ実在日も検証する。
export function resolveDateInput(
  raw: string,
  currentValue: string,
  yearForMonth: (month: number) => number,
  strict = false,
): DateInputResult {
  const trimmed = raw.trim()
  if (!trimmed) return { value: currentValue, error: null }

  let month: number | undefined
  let day: number | undefined
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/')
    if (parts.length === 2 && (!strict || /^\d{1,2}\/\d{1,2}$/.test(trimmed))) {
      month = parseInt(parts[0], 10)
      day = parseInt(parts[1], 10)
    }
  } else {
    const digits = trimmed.replace(/\D/g, '')
    if ((!strict || /^\d+$/.test(trimmed)) && (digits.length === 3 || digits.length === 4)) {
      month = parseInt(digits.slice(0, -2), 10)
      day = parseInt(digits.slice(-2), 10)
    }
  }

  if (month === undefined || day === undefined || isNaN(month) || isNaN(day)) {
    return { value: null, error: '月日を3〜4桁で入力してください（例：605、0605）' }
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { value: null, error: '月は1〜12、日は1〜31の範囲で入力してください' }
  }

  const year = yearForMonth(month)
  if (strict && day > new Date(year, month, 0).getDate()) {
    return { value: null, error: '実在する月日を入力してください' }
  }
  return { value: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, error: null }
}
