export const COMPANY_COOKIE_NAME = 'sa_company_id'
export const COMPANY_COOKIE_OPTIONS = {
  path: '/', sameSite: 'lax', maxAge: 365 * 24 * 60 * 60, httpOnly: false,
} as const

export function readCompanyCookie(cookie: string): string | null {
  const item = cookie.split(';').map(value => value.trim()).find(value => value.startsWith(`${COMPANY_COOKIE_NAME}=`))
  if (!item) return null
  try { return decodeURIComponent(item.slice(COMPANY_COOKIE_NAME.length + 1)) || null } catch { return null }
}
