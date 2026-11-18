/** RPC の生残高（借方超過が正）を正常残高方向に変換する唯一の入口。 */
export function normalizeOpeningBalance(rawBalance: number, type: string): number {
  return ['ASSET', 'EXPENSE'].includes(type) ? Number(rawBalance) : -Number(rawBalance)
}
