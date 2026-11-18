import { supabase } from '@/lib/supabase'
import { getRegisteredCompanyId } from '@/lib/company-guard'
import type { Account } from '@/components/journals/JournalLineRow'
import type { SearchParams } from '@/components/journals/JournalSearch'
import type { JournalEntryWithLines } from '@/components/journals/JournalForm'
import type { JournalFetchResult } from '@/lib/journal-order'

export async function readJournalEntries(periodId: string, params: SearchParams, currentAccounts: Account[], companyId = getRegisteredCompanyId()): Promise<JournalFetchResult> {
  try {
    // Step1: journal_entries を絞り込む（日付・摘要はここで適用）
    let query = supabase
      .from('journal_entries')
      .select(`
        id,
        date,
        description,
        reference_number,
        supplement,
        is_opening_balance,
        journal_lines (
          id,
          line_number,
          side,
          account_id,
          amount,
          tax_code,
          description,
          accounts (
            id,
            name,
            parent_id
          )
        )
      `)
      .eq('period_id', periodId)
      .eq('company_id', companyId)

    if (params.dateFrom) query = query.gte('date', params.dateFrom)
    if (params.dateTo)   query = query.lte('date', params.dateTo)
    if (params.keyword)  query = query.ilike('description', `%${params.keyword}%`)

    // Step2: 金額・科目条件がある場合は journal_lines で entry_id を絞り込む
    if (params.amountMin || params.amountMax || params.accountId) {
      let targetAccountIds: string[] = []
      if (params.accountId) {
        const selected = currentAccounts.find(a => a.id === params.accountId)
        if (selected?.parent_id === null) {
          // 親科目が選択された → 自身＋補助科目を全て含める
          const subIds = currentAccounts
            .filter(a => a.parent_id === params.accountId)
            .map(a => a.id)
          targetAccountIds = [params.accountId, ...subIds]
        } else {
          targetAccountIds = [params.accountId]
        }
      }

      let linesQuery = supabase.from('journal_lines').select('entry_id').eq('company_id', companyId)
      if (params.amountMin) linesQuery = linesQuery.gte('amount', Number(params.amountMin))
      if (params.amountMax) linesQuery = linesQuery.lte('amount', Number(params.amountMax))
      if (targetAccountIds.length > 0) {
        linesQuery = linesQuery.in('account_id', targetAccountIds)
      }

      const { data: matchedLines, error: linesError } = await linesQuery
      if (linesError) return { ok: false, error: linesError }
      const matchedEntryIds = [
        ...new Set(
          ((matchedLines ?? []) as unknown as { entry_id: string }[]).map(l => l.entry_id)
        ),
      ]

      if (matchedEntryIds.length === 0) {
        return { ok: true, entries: [] }
      }

      query = query.in('id', matchedEntryIds)
    }

    const { data, error } = await query
      .order('date', { ascending: true })
      .order('reference_number', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })

    if (error) return { ok: false, error }
    return { ok: true, entries: (data as unknown as JournalEntryWithLines[]) ?? [] }
  } catch (error) {
    return { ok: false, error }
  }
}
