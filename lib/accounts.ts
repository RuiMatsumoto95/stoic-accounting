import { supabase } from '@/lib/supabase'

export async function getNextSubAccountCode(parentId: string, parentCode: string): Promise<string> {
  const { data, error } = await supabase
    .from('accounts')
    .select('code')
    .eq('parent_id', parentId)

  if (error) throw new Error('補助科目の取得に失敗しました: ' + error.message)

  const prefix = `${parentCode}-`
  const maxNum = (data ?? []).reduce((max, a) => {
    if (!a.code.startsWith(prefix)) return max
    const suffix = a.code.slice(prefix.length)
    if (!/^\d{4}$/.test(suffix)) return max
    return Math.max(max, parseInt(suffix, 10))
  }, 0)

  const next = maxNum + 1
  if (next > 9999) throw new Error('補助科目の上限（9999件）に達しています')

  return `${parentCode}-${String(next).padStart(4, '0')}`
}
