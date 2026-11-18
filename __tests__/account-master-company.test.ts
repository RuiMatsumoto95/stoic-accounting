import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { companyDb } from './helpers/company-supabase'
import { registerActiveCompany } from '@/lib/company-guard'
import { fetchAccountMaster, saveAccountMaster, deleteAccountMaster, getParentAccountOptions, type AccountWithAliases, type AccountForm } from '@/lib/account-master'
import { getPlCategoryOptions, getBsCategoryOptions, type AccountType } from '@/lib/account-master-options'

let fixture: ReturnType<typeof companyDb>
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => fixture.client.from(table) } }))

const aliasA = { id: 'alias-a', account_id: 'a-cash', alias: 'cash', normalized_alias: 'cash', alias_type: 'ROMAN' as const, sort_order: 0 }
const aliasB = { ...aliasA, id: 'alias-b', account_id: 'b-cash', alias: 'other' }
const cash: AccountWithAliases = {
  id: 'a-cash', company_id: 'a', code: '1000', name: '現金', type: 'ASSET', parent_id: null,
  pl_category: null, bs_category: 'CURRENT_ASSETS', default_tax_code: null, account_aliases: [aliasA],
}
const other: AccountWithAliases = { ...cash, id: 'b-cash', company_id: 'b', account_aliases: [aliasB] }
const sub: AccountWithAliases = { ...cash, id: 'a-sub', code: '1000-0001', parent_id: cash.id, account_aliases: [] }
const form: AccountForm = { code: '1000', name: '更新した現金', type: 'ASSET', parent_id: '', pl_category: '', bs_category: 'CURRENT_ASSETS', default_tax_code: 'none' }
const company = { id: 'a', kind: 'CORPORATION' as const }
const input = { company, form, code: '1000', editTarget: null, aliases: [] }

beforeEach(() => {
  fixture = companyDb({ accounts: [cash, other, sub], account_aliases: [aliasA, aliasB] })
  registerActiveCompany('a')
  vi.stubGlobal('document', { cookie: 'sa_company_id=a' })
})
afterEach(() => { registerActiveCompany(null); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('科目マスタの会社固定', () => {
  it('一覧と親候補に他社科目を含めず、作成後もその会社だけに出る', async () => {
    expect((await fetchAccountMaster('a')).map(account => account.id)).toEqual(['a-cash', 'a-sub'])
    expect(getParentAccountOptions(await fetchAccountMaster('a')).map(account => account.id)).toEqual(['a-cash'])
    expect(getParentAccountOptions(await fetchAccountMaster('a'), 'a-cash')).toEqual([])
    const createdId = await saveAccountMaster(input)
    const insert = fixture.calls.find(call => call.operation === 'insert')!
    expect(insert.values).toMatchObject({ company_id: 'a', code: '1000', default_tax_code: null })
    expect(insert.values).not.toHaveProperty('company_kind')
    expect((await fetchAccountMaster('a')).some(account => account.id === createdId)).toBe(true)
    expect((await fetchAccountMaster('b')).map(account => account.id)).toEqual(['b-cash'])
  })
  it('自社科目の編集・削除に会社条件を付け、他社の同じコードには作用しない', async () => {
    await saveAccountMaster({ ...input, editTarget: cash })
    expect(fixture.tables.accounts.find(account => account.id === 'a-cash')).toMatchObject({ name: form.name, company_id: 'a' })
    await deleteAccountMaster('a-cash', 'a')
    expect(fixture.tables.accounts.find(account => account.id === 'a-cash')).toBeUndefined()
    expect(fixture.tables.accounts.find(account => account.id === 'b-cash')).toEqual(other)
    for (const call of fixture.calls.filter(call => call.table === 'accounts' && ['update', 'delete'].includes(call.operation))) {
      expect(call.filters).toContainEqual(['company_id', 'eq', 'a'])
    }
  })
  it('他社科目の編集0件を失敗にし、別名へ進まず、他社科目の削除も作用しない', async () => {
    await expect(saveAccountMaster({ ...input, editTarget: other, aliases: [{ alias: '追加', alias_type: 'OTHER' }] })).rejects.toThrow()
    expect(fixture.calls.filter(call => call.table === 'account_aliases')).toEqual([])
    await deleteAccountMaster('b-cash', 'a')
    expect(fixture.tables.accounts.find(account => account.id === 'b-cash')).toEqual(other)
  })
  it('別名の追加・更新・削除は会社条件つきで保存できた科目IDに固定する', async () => {
    await saveAccountMaster({ ...input, editTarget: cash, aliases: [{ ...aliasA, alias: ' ＧＥＮＫＩＮ ', alias_type: 'OTHER' }, { alias: '追加', alias_type: 'OTHER' }] })
    expect(fixture.tables.account_aliases.find(alias => alias.id === 'alias-a')).toMatchObject({ account_id: cash.id, alias: 'ＧＥＮＫＩＮ', normalized_alias: 'genkin', alias_type: 'OTHER' })
    expect(fixture.tables.account_aliases.at(-1)).toMatchObject({ account_id: cash.id, alias: '追加' })
    await saveAccountMaster({ ...input, editTarget: cash })
    expect(fixture.tables.account_aliases.some(alias => alias.id === 'alias-a')).toBe(false)
    expect(fixture.tables.account_aliases.find(alias => alias.id === 'alias-b')).toEqual(aliasB)
    for (const call of fixture.calls.filter(call => call.table === 'account_aliases' && call.operation !== 'insert')) {
      expect(call.filters).toContainEqual(['account_id', 'eq', 'a-cash'])
    }
  })
  it('他科目の別名IDを渡されても更新・削除できない', async () => {
    await expect(saveAccountMaster({ ...input, editTarget: cash, aliases: [aliasA, { ...aliasB, alias: '不正な更新' }] })).rejects.toThrow()
    await saveAccountMaster({ ...input, editTarget: { ...cash, account_aliases: [aliasB] } })
    expect(fixture.tables.account_aliases.find(alias => alias.id === 'alias-b')).toEqual(aliasB)
  })
  it('新規作成の別名は返された科目IDに紐づく', async () => {
    const id = await saveAccountMaster({ ...input, aliases: [{ alias: '新規', alias_type: 'OTHER' }] })
    expect(fixture.tables.account_aliases.at(-1)).toMatchObject({ account_id: id, alias: '新規' })
  })
  it('補助科目の新規作成は会社内の親を再確認し、type・区分の継承をDBに任せる', async () => {
    await saveAccountMaster({ ...input, form: { ...form, parent_id: cash.id, type: '', bs_category: '' }, code: '1000-0002' })
    expect(fixture.calls.find(call => call.operation === 'read')?.filters).toEqual(expect.arrayContaining([
      ['id', 'eq', cash.id], ['company_id', 'eq', 'a'], ['parent_id', 'eq', null],
    ]))
    expect(fixture.tables.accounts.at(-1)).toMatchObject({ company_id: 'a', type: 'ASSET', parent_id: cash.id, pl_category: null, bs_category: null })
  })
  it.each(['b-cash', 'a-sub', 'missing'])('他社・補助科目・存在しない親 %s では作成しない', async parent => {
    await expect(saveAccountMaster({ ...input, form: { ...form, parent_id: parent } })).rejects.toThrow()
    expect(fixture.calls.every(call => call.operation === 'read')).toBe(true)
  })
  it('補助科目編集は会社を固定し、type・区分・別名を更新しない', async () => {
    await saveAccountMaster({ ...input, editTarget: sub, form: { ...form, type: 'EXPENSE', bs_category: '', pl_category: 'TAX', default_tax_code: 'NONE' }, code: '1000-0002' })
    expect(fixture.calls).toHaveLength(1)
    expect(fixture.calls[0].values).toEqual({ code: '1000-0002', name: form.name, default_tax_code: 'NONE' })
    expect(fixture.calls[0].filters).toContainEqual(['company_id', 'eq', 'a'])
  })
  it('古い会社の画面は作成・編集・削除を通信前に拒否する', async () => {
    document.cookie = 'sa_company_id=b'
    for (const operation of [() => saveAccountMaster(input), () => saveAccountMaster({ ...input, editTarget: cash }), () => deleteAccountMaster(cash.id, 'a')]) {
      await expect(operation()).rejects.toMatchObject({ code: 'STALE_COMPANY' })
    }
    expect(fixture.calls).toEqual([])
  })
  it('親の取得中に会社が切り替わったら科目を書かない', async () => {
    fixture.failWith(call => { if (call.operation === 'read') document.cookie = 'sa_company_id=b'; return undefined })
    await expect(saveAccountMaster({ ...input, form: { ...form, parent_id: cash.id } })).rejects.toMatchObject({ code: 'STALE_COMPANY' })
    expect(fixture.calls.every(call => call.operation === 'read')).toBe(true)
  })
  it('科目保存中に会社が変わっても別名を他社へ書かず、続行前に拒否する', async () => {
    fixture.failWith(call => { if (call.operation === 'update') document.cookie = 'sa_company_id=b'; return undefined })
    await expect(saveAccountMaster({ ...input, editTarget: cash })).rejects.toMatchObject({ code: 'STALE_COMPANY' })
    expect(fixture.calls.map(call => call.table)).toEqual(['accounts'])
    expect(fixture.tables.account_aliases).toEqual([aliasA, aliasB])
  })
  it('科目保存失敗時は別名を変更しない', async () => {
    fixture.failWith(call => call.table === 'accounts' ? '保存失敗' : undefined)
    await expect(saveAccountMaster({ ...input, editTarget: cash })).rejects.toThrow()
    expect(fixture.calls.map(call => call.table)).toEqual(['accounts'])
  })
  it.each(['delete', 'update', 'insert'])('別名の%s失敗を成功にせず、後続の別名書込へ進まない', async operation => {
    fixture.failWith(call => call.table === 'account_aliases' && call.operation === operation ? '別名の保存失敗' : undefined)
    await expect(saveAccountMaster({ ...input, editTarget: cash, aliases: [
      ...(operation === 'delete' ? [] : [aliasA]), { alias: '追加', alias_type: 'OTHER' },
    ] })).rejects.toThrow()
    const aliasCalls = fixture.calls.filter(call => call.table === 'account_aliases')
    expect(aliasCalls.at(-1)?.operation).toBe(operation)
    expect(fixture.tables.account_aliases.find(alias => alias.id === 'alias-b')).toEqual(aliasB)
  })
  it.each([
    ['23505', 'duplicate key value violates unique constraint "accounts_company_code_key"', 'DUPLICATE_ACCOUNT_CODE', '同じ科目コードが既に存在します'],
    ['P0001', 'INVALID_CARRY_FORWARD_ACCOUNT', 'INVALID_CARRY_FORWARD_ACCOUNT', '繰越に使用する勘定科目が不正です'],
  ])('保存・削除のDBエラー %s / %s を既存の日本語変換で画面へ渡す', async (code, message, expectedCode, expectedMessage) => {
    const error = { code, message, details: '', hint: '', name: 'PostgrestError' }
    const query = {
      error,
      insert: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(), delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error }),
    }
    vi.spyOn(fixture.client, 'from').mockReturnValue(query as unknown as ReturnType<typeof fixture.client.from>)
    for (const operation of [() => saveAccountMaster(input), () => saveAccountMaster({ ...input, editTarget: cash }), () => deleteAccountMaster(cash.id, 'a')]) {
      await expect(operation()).rejects.toMatchObject({ code: expectedCode, message: expectedMessage })
    }
  })
  it.each(['none', 'NONE', 'SALES', 'SALES_RETURN', 'PURCHASE', 'PURCHASE_RETURN', 'NON_TAXABLE_SALES'])('税区分 %s を新規・既存の両方で正しく保存する', async value => {
    for (const editTarget of [null, cash]) {
      const id = await saveAccountMaster({ ...input, editTarget, form: { ...form, default_tax_code: value } })
      expect(fixture.tables.accounts.find(account => account.id === id)?.default_tax_code).toBe(value === 'none' ? null : value)
    }
  })
  it.each(['課税10%', 'OUT_OF_SCOPE'])('CHECK外の税区分 %s は通信前に拒否する', async value => {
    await expect(saveAccountMaster({ ...input, form: { ...form, default_tax_code: value } })).rejects.toThrow('税区分')
    expect(fixture.calls).toEqual([])
  })
})

describe.each(['CORPORATION', 'INDIVIDUAL'] as const)('%sの区分保存', kind => {
  it.each(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as AccountType[])('%sの選択肢を保存し、他社区分・異種別の区分を拒否する', async type => {
    const pl = getPlCategoryOptions(kind, type)
    const bs = getBsCategoryOptions(kind, type)
    for (const option of [...pl, ...bs]) {
      await saveAccountMaster({ ...input, company: { id: 'a', kind }, form: { ...form, type, pl_category: pl.length ? option.value : '', bs_category: bs.length ? option.value : '' } })
      expect(fixture.tables.accounts.at(-1)).toMatchObject({ type, pl_category: pl.length ? option.value : null, bs_category: bs.length ? option.value : null })
    }
    const before = fixture.calls.length
    await expect(saveAccountMaster({ ...input, company: { id: 'a', kind }, form: { ...form, type, pl_category: 'UNKNOWN', bs_category: 'UNKNOWN' } })).rejects.toThrow('財務諸表区分')
    expect(fixture.calls).toHaveLength(before)
  })
  it('他会社区分だけで有効な値は保存しない', async () => {
    for (const categories of kind === 'INDIVIDUAL'
      ? [{ type: 'REVENUE' as const, pl_category: 'NON_OP_INCOME', bs_category: '' }, { type: 'EXPENSE' as const, pl_category: 'TAX', bs_category: '' }]
      : [{ type: 'ASSET' as const, bs_category: 'OWNER_DRAWINGS', pl_category: '' }, { type: 'REVENUE' as const, pl_category: 'RESERVE_REVERSAL', bs_category: '' }]) {
      await expect(saveAccountMaster({ ...input, company: { id: 'a', kind }, form: { ...form, ...categories } })).rejects.toThrow('財務諸表区分')
    }
    expect(fixture.calls).toEqual([])
  })
})
