'use client'

import { useTransition } from 'react'
import { useCompany, useCompanyManagement } from '@/contexts/CompanyContext'

export default function CompanySwitcher() {
  const company = useCompany()
  const { companies, selectCompany } = useCompanyManagement()
  const [pending, startTransition] = useTransition()
  return <div className="w-44 shrink-0 border-r px-3 py-1">
    <select aria-label="作業中の会社" title={company.name} value={company.id} disabled={pending} className="block w-full truncate bg-background text-sm font-medium" onChange={event => {
      const id = event.target.value
      startTransition(async () => { await selectCompany(id) })
    }}>
      {companies.filter(item => !item.is_archived).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    <span className="text-xs text-muted-foreground">{company.kind === 'INDIVIDUAL' ? '個人' : '法人'}</span>
  </div>
}
