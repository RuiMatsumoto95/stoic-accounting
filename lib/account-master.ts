import { supabase } from './supabase'
import { assertActiveCompany } from './company-guard'
import type { Company } from './company'
import { normalizeText } from './account-search'
import { translateSupabaseError, wrapSupabase } from './supabase-error-handler'
import { retainValidCategories, taxCodeFromForm, type AccountType } from './account-master-options'

export type Account = {
  id: string
  company_id: string
  code: string
  name: string
  type: AccountType
  parent_id: string | null
  default_tax_code: string | null
  pl_category: string | null
  bs_category: string | null
}

export type AliasDraft = {
  id?: string
  alias: string
  alias_type: 'KANA' | 'ROMAN' | 'ABBREV' | 'OTHER'
}

export type AccountWithAliases = Account & {
  account_aliases: (AliasDraft & { id: string; normalized_alias: string; sort_order: number })[]
}

export type AccountForm = {
  code: string
  name: string
  type: AccountType | ''
  parent_id: string
  default_tax_code: string
  pl_category: string
  bs_category: string
}

export function getParentAccountOptions(accounts: AccountWithAliases[], editId?: string) {
  return accounts.filter(account => account.parent_id === null && account.id !== editId)
}

export async function fetchAccountMaster(companyId: string): Promise<AccountWithAliases[]> {
  return wrapSupabase(await supabase.from('accounts')
    .select('*, account_aliases(id, alias, normalized_alias, alias_type, sort_order)')
    .eq('company_id', companyId)) as AccountWithAliases[]
}

export async function saveAccountMaster({ company, form, code, editTarget, aliases }: {
  company: Pick<Company, 'id' | 'kind'>
  form: AccountForm
  code: string
  editTarget: AccountWithAliases | null
  aliases: AliasDraft[]
}): Promise<string> {
  const companyId = company.id // 継続通信も、開始時の会社に固定する。
  assertActiveCompany(companyId)
  const isSubEdit = !!editTarget?.parent_id
  const basic = { code, name: form.name.trim(), default_tax_code: taxCodeFromForm(form.default_tax_code) }
  let payload: Record<string, unknown> = basic
  if (!isSubEdit) {
    let type = form.type
    let categories = { pl_category: form.pl_category || null, bs_category: form.bs_category || null }
    if (form.parent_id) {
      // 会社条件つきで親を再確認。type・区分はDBが親から継承する。
      const parent = wrapSupabase<{ id: string; type: AccountType }>(await supabase.from('accounts').select('id, type')
        .eq('id', form.parent_id).eq('company_id', companyId).is('parent_id', null).single())
      type = parent.type
      categories = { pl_category: null, bs_category: null }
    } else {
      const valid = retainValidCategories(company.kind, type, form.pl_category, form.bs_category)
      if (!type || (!valid.pl_category && !valid.bs_category)) throw new Error('財務諸表区分を選択してください')
      categories = { pl_category: valid.pl_category || null, bs_category: valid.bs_category || null }
    }
    payload = { ...basic, type, parent_id: form.parent_id || null, ...categories }
  }

  assertActiveCompany(companyId)
  // 更新も会社条件つきで1件の成功を確認する。0件なら別名へ進まない。
  const saved = wrapSupabase<{ id: string }>(editTarget
    ? await supabase.from('accounts').update(payload).eq('id', editTarget.id).eq('company_id', companyId).select('id').single()
    : await supabase.from('accounts').insert({ ...payload, company_id: companyId }).select('id').single())
  const savedId = saved.id

  if (!isSubEdit) {
    // account_aliasesにはcompany_idがない。直前に会社条件つきで保存した科目IDに固定する。
    const draftIds = aliases.flatMap(alias => alias.id ? [alias.id] : [])
    const deletedIds = (editTarget?.account_aliases ?? []).filter(alias => !draftIds.includes(alias.id)).map(alias => alias.id)
    if (deletedIds.length) {
      assertActiveCompany(companyId)
      const result = await supabase.from('account_aliases').delete().in('id', deletedIds).eq('account_id', savedId)
      if (result.error) throw translateSupabaseError(result.error)
    }
    for (const draft of aliases.filter(alias => alias.id)) {
      assertActiveCompany(companyId)
      wrapSupabase(await supabase.from('account_aliases').update({
        alias: draft.alias.trim(), normalized_alias: normalizeText(draft.alias.trim()), alias_type: draft.alias_type,
      }).eq('id', draft.id!).eq('account_id', savedId).select('id').single())
    }
    const newAliases = aliases.filter(alias => !alias.id && alias.alias.trim()).map(alias => ({
      account_id: savedId, alias: alias.alias.trim(), normalized_alias: normalizeText(alias.alias.trim()),
      alias_type: alias.alias_type, sort_order: 0,
    }))
    if (newAliases.length) {
      assertActiveCompany(companyId)
      const result = await supabase.from('account_aliases').insert(newAliases)
      if (result.error) throw translateSupabaseError(result.error)
    }
  }
  return savedId
}

export async function deleteAccountMaster(id: string, companyId: string): Promise<void> {
  assertActiveCompany(companyId)
  const result = await supabase.from('accounts').delete().eq('id', id).eq('company_id', companyId)
  if (result.error) throw translateSupabaseError(result.error)
}
