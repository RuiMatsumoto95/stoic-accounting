import { ConflictError } from './errors'
import { readCompanyCookie } from './company-cookie'

// ブラウザのタブ内だけの登録。Server Actions はリクエストの cookie と引数を直接照合する。
let registeredCompanyId: string | null = null

export function registerActiveCompany(companyId: string | null): void {
  registeredCompanyId = companyId
}

export function getRegisteredCompanyId(): string | null {
  return registeredCompanyId
}

export function assertCompanyMatches(expected: string | null, actual: string | null | undefined): void {
  if (!expected || expected !== actual) {
    throw new ConflictError('STALE_COMPANY', '別のタブで作業中の会社が変更されました。画面を再読み込みしてください')
  }
}

// 認可・アクセス制御ではなく取り違えの防止。保存開始時の照合なので、通信中の切替は排除できない。
// reader を注入すればブラウザのないテストでも同じ照合を検証できる。
export function assertActiveCompany(
  expected = registeredCompanyId,
  reader?: () => string,
): void {
  if (!reader && typeof document === 'undefined') return
  try {
    assertCompanyMatches(registeredCompanyId, expected)
    assertCompanyMatches(registeredCompanyId, readCompanyCookie(reader ? reader() : document.cookie))
  } catch (error) {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('sa-company-stale'))
    throw error
  }
}
