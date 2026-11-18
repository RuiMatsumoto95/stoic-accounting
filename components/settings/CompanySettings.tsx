'use client'

import { useCompany, useCompanyManagement } from '@/contexts/CompanyContext'
import CompanyArchiveList from './CompanyArchiveList'
import CompanyCreateForm from './CompanyCreateForm'

export default function CompanySettings() {
  const company = useCompany()
  const { companies, refreshCompanies, selectCompany } = useCompanyManagement()
  return <section className="space-y-4">
    <h2 className="text-lg font-semibold">会社管理</h2>
    <CompanyArchiveList companies={companies} activeCompanyId={company.id} onChanged={refreshCompanies} />
    <CompanyCreateForm activeCompanyId={company.id} onCreated={selectCompany} />
  </section>
}
