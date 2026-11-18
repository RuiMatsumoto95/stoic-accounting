'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createCompany } from '@/actions/company-actions'
import { TAX_METHOD_LABELS, type TaxMethod } from '@/lib/tax-codes'
import type { Company } from '@/lib/company'
import { registerDirtyChecker } from '@/lib/company-dirty'

export default function CompanyCreateForm({ activeCompanyId, onCreated }: {
  activeCompanyId?: string; onCreated: (id: string) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Company['kind']>('CORPORATION')
  const [taxMethod, setTaxMethod] = useState<TaxMethod>('EXEMPT')
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [startDate, setStartDate] = useState(`${year}-01-01`)
  const [endDate, setEndDate] = useState(`${year}-12-31`)
  const [error, setError] = useState('')
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const saved = useRef(false)
  const fieldClass = 'block w-full border rounded p-2 bg-background'

  useEffect(() => registerDirtyChecker(() => !saved.current && (pending || name.trim() !== '' || kind !== 'CORPORATION' ||
    taxMethod !== 'EXEMPT' || startDate !== `${year}-01-01` || endDate !== `${year}-12-31`)),
  [pending, name, kind, taxMethod, year, startDate, endDate])

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      setError('')
      try {
        const result = await createCompany({ name: name.trim(), kind, taxMethod,
          startDate: kind === 'INDIVIDUAL' ? `${year.padStart(4, '0')}-01-01` : startDate,
          endDate: kind === 'INDIVIDUAL' ? `${year.padStart(4, '0')}-12-31` : endDate,
        }, activeCompanyId)
        if (result.error || !result.companyId) { setError(result.error ?? '会社を作成できませんでした'); return }
        saved.current = true
        setCreatedId(result.companyId)
        await onCreated(result.companyId)
      } catch (e) { setError(e instanceof Error ? e.message : '会社を作成できませんでした') }
    })
  }

  return <form onSubmit={submit} className="space-y-3 border rounded-lg p-4">
    <h2 className="font-semibold">会社を作成</h2>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {createdId ? <div className="space-y-2"><p>会社を作成しました。</p><button type="button" className="underline" disabled={pending} onClick={() => startTransition(async () => { await onCreated(createdId) })}>作成した会社へ切り替える</button></div> : <fieldset disabled={pending} className="space-y-3">
      <label className="block">会社名<input required className={fieldClass} value={name} onChange={event => setName(event.target.value)} /></label>
      <label className="block">区分<select className={fieldClass} value={kind} onChange={event => setKind(event.target.value as Company['kind'])}><option value="CORPORATION">法人</option><option value="INDIVIDUAL">個人</option></select></label>
      <label className="block">課税方式<select className={fieldClass} value={taxMethod} onChange={event => setTaxMethod(event.target.value as TaxMethod)}>{(Object.entries(TAX_METHOD_LABELS) as [TaxMethod, string][]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {kind === 'INDIVIDUAL'
        ? <label className="block">年<input required type="number" min="1" max="9999" className={fieldClass} value={year} onChange={event => setYear(event.target.value)} /><span className="text-sm text-muted-foreground">{year}年1月1日〜12月31日</span></label>
        : <div className="flex gap-3"><label className="min-w-0">開始日<input required type="date" className={fieldClass} value={startDate} onChange={event => setStartDate(event.target.value)} /></label><label className="min-w-0">終了日<input required type="date" className={fieldClass} value={endDate} onChange={event => setEndDate(event.target.value)} /></label></div>}
      <button type="submit" className="border rounded px-4 py-2">{pending ? '作成中…' : '作成して切り替える'}</button>
    </fieldset>}
  </form>
}
