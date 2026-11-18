const checkers = new Set<() => boolean>()

export function registerDirtyChecker(checker: () => boolean): () => void {
  checkers.add(checker)
  return () => { checkers.delete(checker) }
}

export function hasUnsavedCompanyInput(): boolean {
  return [...checkers].some(checker => checker())
}

export async function switchCompany(
  companyId: string,
  actions: { confirm: () => boolean; setActive: (id: string) => Promise<void>; broadcast: (id: string) => void; navigate: (path: string) => void },
): Promise<boolean> {
  if (hasUnsavedCompanyInput() && !actions.confirm()) return false
  await actions.setActive(companyId)
  actions.broadcast(companyId)
  actions.navigate('/journals')
  return true
}
