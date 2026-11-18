import { cookies } from 'next/headers'
import { COMPANY_COOKIE_NAME } from './company-cookie'
import { assertCompanyMatches } from './company-guard'

export async function getCompanyCookieId(): Promise<string | null> {
  return (await cookies()).get(COMPANY_COOKIE_NAME)?.value ?? null
}

export async function assertServerCompany(companyId: string): Promise<void> {
  assertCompanyMatches(companyId, await getCompanyCookieId())
}
