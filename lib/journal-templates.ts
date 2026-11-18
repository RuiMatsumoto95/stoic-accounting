import { assertActiveCompany, getRegisteredCompanyId } from './company-guard'
import { supabase } from '@/lib/supabase'
import type { LineState } from '@/components/journals/JournalLineRow'

export type TemplateLine = {
  id: string
  template_id: string
  line_number: number
  side: 'DEBIT' | 'CREDIT'
  account_id: string | null
  amount: number | null
  tax_code: string | null
  description: string | null
}

export type TemplateLineInput = {
  line_number: number
  side: 'DEBIT' | 'CREDIT'
  account_id: string | null
  amount: number | null
  tax_code: string | null
  description: string | null
}

export type TemplateInput = {
  name: string
  default_description: string | null
  lines: TemplateLineInput[]
}

export type JournalTemplate = {
  id: string
  name: string
  default_description: string | null
  sort_order: number
  created_at: string
  updated_at: string
  lines: TemplateLine[]
}

export async function fetchTemplates(companyId = getRegisteredCompanyId()): Promise<JournalTemplate[]> {
  const { data, error } = await supabase
    .from('journal_templates')
    .select('*, journal_template_lines(*)')
    .eq('company_id', companyId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw error

  return (data ?? []).map((t: Record<string, unknown>) => ({
    id: t.id as string,
    name: t.name as string,
    default_description: t.default_description as string | null,
    sort_order: t.sort_order as number,
    created_at: t.created_at as string,
    updated_at: t.updated_at as string,
    lines: ((t.journal_template_lines as TemplateLine[]) ?? [])
      .slice()
      .sort((a, b) => a.line_number - b.line_number),
  }))
}

// 会社の照合は操作の開始時だけ。以後は引数の会社・親IDに対象を固定して完了させる。
// 複数リクエストのため原子的ではなく、通信失敗でヘッダー／明細の部分更新が残りうる。
// 完全に防ぐにはDB関数が必要だが、この段階では追加しない。
export async function createTemplate(input: TemplateInput, companyId: string): Promise<void> {
  assertActiveCompany(companyId)
  const { data: templateData, error: templateError } = await supabase
    .from('journal_templates')
    .insert({
      company_id: companyId,
      name: input.name,
      default_description: input.default_description,
    })
    .select()
    .single()

  if (templateError) throw templateError

  const { error: linesError } = await supabase
    .from('journal_template_lines')
    .insert(
      input.lines.map(l => ({
        ...l,
        template_id: templateData.id,
        company_id: companyId,
      }))
    )

  if (linesError) throw linesError
}

export async function updateTemplate(id: string, input: TemplateInput, companyId: string): Promise<void> {
  assertActiveCompany(companyId)
  const { error: updateError } = await supabase
    .from('journal_templates')
    .update({
      name: input.name,
      default_description: input.default_description,
    })
    .eq('id', id)
    .eq('company_id', companyId)
    .select('id')
    .single()

  if (updateError) throw updateError

  // (template_id, line_number) が一意のため、同じ行番号の新明細を先に追加できない。
  // 仮番号と再採番による更新の複雑化を避け、既存の削除→追加を維持する。
  const { error: deleteError } = await supabase
    .from('journal_template_lines')
    .delete()
    .eq('template_id', id)
    .eq('company_id', companyId)

  if (deleteError) throw deleteError

  if (input.lines.length > 0) {
    const { error: insertError } = await supabase
      .from('journal_template_lines')
      .insert(
        input.lines.map(l => ({
          ...l,
          template_id: id,
          company_id: companyId,
        }))
      )

    if (insertError) throw insertError
  }
}

export async function deleteTemplate(id: string, companyId: string): Promise<void> {
  assertActiveCompany(companyId)
  const { error } = await supabase
    .from('journal_templates')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId)

  if (error) throw error
}

export function templateToLines(template: JournalTemplate): {
  lines: LineState[]
  hasOrphanedAccounts: boolean
} {
  const hasOrphanedAccounts = template.lines.some(l => l.account_id === null)
  const lines: LineState[] = template.lines.map(l => ({
    side: l.side,
    account_id: l.account_id ?? '',
    amount: l.amount !== null ? String(l.amount) : '',
    tax_code: l.tax_code ?? '',
    description: l.description ?? '',
  }))
  return { lines, hasOrphanedAccounts }
}
