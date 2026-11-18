'use client'

import { useState, useTransition } from 'react'
import type { Company } from '@/lib/company'
import { archiveCompany, unarchiveCompany } from '@/actions/company-actions'

export default function CompanyArchiveList({ companies, activeCompanyId, onChanged }: {
  companies: Company[]; activeCompanyId?: string; onChanged: () => Promise<void>
}) {
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  function change(company: Company, archived: boolean) {
    if (archived && !window.confirm(`「${company.name}」を選択候補から隠しますか？会社名は引き続き使用中です。`)) return
    startTransition(async () => {
      setError('')
      try {
        const result = await (archived ? archiveCompany(company.id) : unarchiveCompany(company.id))
        if (result.error) { setError(result.error); return }
        await onChanged()
      } catch (e) { setError(e instanceof Error ? e.message : '会社一覧を更新できませんでした') }
    })
  }
  function row(company: Company) {
    return <li key={company.id} className="flex items-center justify-between gap-4 py-2">
      <span className="min-w-0 break-all">{company.name}（{company.kind === 'INDIVIDUAL' ? '個人' : '法人'}）{company.id === activeCompanyId && '・選択中'}</span>
      {company.id !== activeCompanyId && <button type="button" disabled={pending} className="shrink-0 underline disabled:opacity-50" onClick={() => change(company, !company.is_archived)}>{company.is_archived ? '戻す' : 'アーカイブする'}</button>}
    </li>
  }
  return <div className="space-y-3 text-sm">
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {activeCompanyId && <ul>{companies.filter(company => !company.is_archived).map(row)}</ul>}
    <details><summary className="cursor-pointer">アーカイブ済みの会社（{companies.filter(company => company.is_archived).length}）</summary>
      <ul>{companies.filter(company => company.is_archived).map(row)}</ul>
    </details>
    <p className="text-muted-foreground">アーカイブは通常の選択候補から隠す機能です。PDFのURL等からのデータ参照を制限するものではありません。会社名はアーカイブ後も使用中です。</p>
  </div>
}
