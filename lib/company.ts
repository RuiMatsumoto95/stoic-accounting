import type { TaxMethod } from './tax-codes'

export type Company = {
  id: string
  name: string
  kind: 'CORPORATION' | 'INDIVIDUAL'
  tax_method: TaxMethod
  is_archived: boolean
}

export type CompanyResolution =
  | { status: 'ready'; company: Company; needsCookie: boolean }
  | { status: 'needs-selection' | 'no-company' }

export function resolveActiveCompany(cookieId: string | null | undefined, companies: Company[]): CompanyResolution {
  // アーカイブは通常の選択候補から隠すだけ。帳票URL等へのアクセス制御ではない。
  companies = companies.filter(company => !company.is_archived)
  const selected = companies.find(company => company.id === cookieId)
  if (selected) return { status: 'ready', company: selected, needsCookie: false }
  if (companies.length === 1) return { status: 'ready', company: companies[0], needsCookie: true }
  return { status: companies.length === 0 ? 'no-company' : 'needs-selection' }
}

export function isCurrentGeneration(request: number, current: number): boolean {
  return request === current
}

export function createRequestGeneration() {
  let current = 0
  return {
    next: () => ++current,
    invalidate: () => { ++current },
    isCurrent: (request: number) => isCurrentGeneration(request, current),
  }
}
