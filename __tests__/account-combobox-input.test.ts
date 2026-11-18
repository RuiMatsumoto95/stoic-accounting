import { describe, expect, it } from 'vitest'
import { isImeInput, shouldReplaceAccountOnKey } from '@/lib/account-combobox-input'
import { searchAccounts, type AccountWithAliases } from '@/lib/account-search'

const key = (value: string, modifiers = {}) => ({ key: value, ctrlKey: false, altKey: false, metaKey: false, ...modifiers })

describe('閉じた科目欄の入力開始', () => {
  it.each(['f', 'F', '1', ' ', 'あ'])('%s は既存値を置き換える', value => {
    expect(shouldReplaceAccountOnKey(false, key(value))).toBe(true)
    expect(shouldReplaceAccountOnKey(true, key(value))).toBe(false)
  })

  it.each(['Tab', 'Enter', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'F2', 'F12', 'Backspace', 'Delete', 'Process', 'Dead', 'Unidentified'])('%s では置き換えない', value => {
    expect(shouldReplaceAccountOnKey(false, key(value))).toBe(false)
  })

  it.each(['ctrlKey', 'altKey', 'metaKey'])('%s を伴う文字は置き換えない', modifier => {
    expect(shouldReplaceAccountOnKey(false, key('f', { [modifier]: true }))).toBe(false)
  })

  it('置き換え後の f を従来の検索に渡すと普通預金の別名に一致する', () => {
    const accounts: AccountWithAliases[] = [
      { id: 'cash', code: '100', name: '現金', type: 'ASSET', parent_id: null, default_tax_code: null, account_aliases: [] },
      { id: 'bank', code: '110', name: '普通預金', type: 'ASSET', parent_id: null, default_tax_code: null,
        account_aliases: [{ id: 'alias', account_id: 'bank', alias: 'futsuu', normalized_alias: 'futsuu', alias_type: 'custom', sort_order: 0 }] },
    ]
    const query = shouldReplaceAccountOnKey(false, key('f')) ? 'f' : '現金f'
    expect(searchAccounts(accounts, query).map(account => account.id)).toEqual(['bank'])
    expect(searchAccounts(accounts, '現金f')).toEqual([])
  })
})

describe('IME のキー判定（候補選択・親の保存を抑止）', () => {
  it.each([
    [true, 13, false, true],
    [true, 9, false, true],
    [false, 229, false, true],
    [false, 13, true, true],
    [false, 9, true, true],
    [false, 13, false, false],
    [false, 9, false, false],
  ])('isComposing=%s, keyCode=%i, session=%s → %s', (isComposing, keyCode, composing, expected) => {
    expect(isImeInput({ isComposing, keyCode }, composing)).toBe(expected)
  })
})
