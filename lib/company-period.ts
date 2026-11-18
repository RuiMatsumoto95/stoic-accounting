/** 個人の会計期間は、実在する同一年の1月1日から12月31日だけ。 */
export function isIndividualFiscalPeriod(start: string, end: string): boolean {
  const year = start.slice(0, 4)
  return /^[0-9]{4}$/.test(year) && Number(year) > 0 && start === `${year}-01-01` && end === `${year}-12-31`
}
