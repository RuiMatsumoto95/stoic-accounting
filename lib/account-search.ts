export type AccountAlias = {
  id: string
  account_id: string
  alias: string
  normalized_alias: string
  alias_type: string
  sort_order: number
}

export type AccountWithAliases = {
  id: string
  code: string
  name: string
  type: string
  parent_id: string | null
  default_tax_code: string | null
  account_aliases: AccountAlias[]
}

export function normalizeText(text: string): string {
  return text
    .trim()
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .toLowerCase()
}

export function searchAccounts(accounts: AccountWithAliases[], query: string): AccountWithAliases[] {
  if (query === '') return accounts
  const q = normalizeText(query)

  const scored = accounts.map(a => {
    const normalizedName = normalizeText(a.name)
    let score = 0

    if (a.code.startsWith(q)) score = 100
    else if (normalizedName.startsWith(q)) score = 80
    else if (a.account_aliases.some(al => al.normalized_alias.startsWith(q))) score = 60
    else if (normalizedName.includes(q)) score = 40
    else if (a.account_aliases.some(al => al.normalized_alias.includes(q))) score = 20

    return { account: a, score }
  })

  return scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ account }) => account)
}
