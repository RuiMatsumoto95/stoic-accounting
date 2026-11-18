'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { trySetActiveCompany } from '@/actions/company-actions'
import { readCompanyCookie } from '@/lib/company-cookie'
import { assertActiveCompany, registerActiveCompany } from '@/lib/company-guard'
import { createRequestGeneration, resolveActiveCompany, type Company, type CompanyResolution } from '@/lib/company'
import { switchCompany } from '@/lib/company-dirty'
import CompanyArchiveList from '@/components/settings/CompanyArchiveList'
import CompanyCreateForm from '@/components/settings/CompanyCreateForm'

const CompanyContext = createContext<Company | undefined>(undefined)
const CompanyManagementContext = createContext<{
  companies: Company[]
  selectCompany: (id: string) => Promise<boolean>
  refreshCompanies: () => Promise<void>
} | undefined>(undefined)

async function activateCompany(id: string) {
  const result = await trySetActiveCompany(id)
  if (result.error) throw new Error(result.error)
}

function broadcastCompany(id: string) {
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('sa-company')
  channel?.postMessage(id)
  channel?.close()
}

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CompanyResolution | { status: 'loading' }>({ status: 'loading' })
  const [companies, setCompanies] = useState<Company[]>([])
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const [generation] = useState(createRequestGeneration)
  const switching = useRef(false)

  const refreshCompanies = useCallback(async () => {
    const request = generation.next()
    const cookieId = readCompanyCookie(document.cookie)
    const { data, error } = await supabase.from('companies').select('id, name, kind, tax_method, is_archived').order('name')
    if (error) throw new Error('会社を取得できませんでした。接続を確認して再読み込みしてください')
    if (!generation.isCurrent(request)) return
    if (readCompanyCookie(document.cookie) !== cookieId) { setStale(true); return }
    const list = (data ?? []) as Company[]
    const resolved = resolveActiveCompany(cookieId, list)
    if (resolved.status === 'ready' && resolved.needsCookie) {
      await activateCompany(resolved.company.id)
      if (!generation.isCurrent(request)) return
      if (readCompanyCookie(document.cookie) !== resolved.company.id) { setStale(true); return }
      broadcastCompany(resolved.company.id)
      // 自動選択・アーカイブからの復元でも、旧cookieで生成された設定を使わない。
      window.location.assign('/journals')
      return
    }
    registerActiveCompany(resolved.status === 'ready' ? resolved.company.id : null)
    setCompanies(list)
    setState(resolved)
    setError('')
  }, [generation])

  useEffect(() => {
    const stop = () => setStale(true)
    window.addEventListener('sa-company-stale', stop)
    async function load() {
      try { await refreshCompanies() }
      catch (e) { setError(e instanceof Error ? e.message : '会社を取得できませんでした') }
    }
    void load()
    return () => {
      generation.invalidate()
      registerActiveCompany(null)
      window.removeEventListener('sa-company-stale', stop)
    }
  }, [generation, refreshCompanies])

  const checkCompany = useCallback(() => {
    if (state.status !== 'ready') return
    try { assertActiveCompany(state.company.id) } catch { setStale(true) }
  }, [state])

  useEffect(() => {
    window.addEventListener('focus', checkCompany)
    document.addEventListener('visibilitychange', checkCompany)
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('sa-company')
    if (channel) channel.onmessage = checkCompany
    return () => {
      window.removeEventListener('focus', checkCompany)
      document.removeEventListener('visibilitychange', checkCompany)
      channel?.close()
    }
  }, [checkCompany])

  const selectCompany = useCallback(async (companyId: string): Promise<boolean> => {
    if (switching.current) return false
    switching.current = true
    setError('')
    try {
      return await switchCompany(companyId, {
        confirm: () => window.confirm('未保存の入力があります。破棄して会社を切り替えますか？'),
        setActive: activateCompany,
        broadcast: broadcastCompany,
        // サーバー生成の設定も含め、会社に依存する状態をクエリなしで取得し直す。
        navigate: path => window.location.assign(path),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '会社を選択できませんでした')
      return false
    } finally { switching.current = false }
  }, [])

  if (stale) return <div role="alert" className="p-6">別のタブで会社が切り替わりました。再読み込みしてください<button className="ml-4 underline" onClick={() => window.location.reload()}>再読み込み</button></div>
  return <CompanyManagementContext.Provider value={{ companies, selectCompany, refreshCompanies }}>
    {error && <p role="alert" className="p-3 text-destructive">{error}</p>}
    {state.status === 'ready'
      ? <CompanyContext.Provider key={state.company.id} value={state.company}>{children}</CompanyContext.Provider>
      : <div className="max-w-2xl p-6 space-y-4">
        {state.status === 'loading' && <p>会社を読み込み中です</p>}
        {state.status === 'no-company' && <p>選択できる会社がありません。会社を作成するか、アーカイブ済みの会社を戻してください</p>}
        {state.status === 'needs-selection' && <><p>作業する会社を選択してください</p>{companies.filter(company => !company.is_archived).map(company => <button className="block underline" key={company.id} onClick={() => void selectCompany(company.id)}>{company.name}（{company.kind === 'INDIVIDUAL' ? '個人' : '法人'}）</button>)}</>}
        {state.status !== 'loading' && <>
          <CompanyArchiveList companies={companies} onChanged={refreshCompanies} />
          <CompanyCreateForm onCreated={selectCompany} />
        </>}
      </div>}
  </CompanyManagementContext.Provider>
}

export function useCompany(): Company {
  const company = useContext(CompanyContext)
  if (!company) throw new Error('useCompany must be used within CompanyProvider')
  return company
}

export function useCompanyManagement() {
  const management = useContext(CompanyManagementContext)
  if (!management) throw new Error('useCompanyManagement must be used within CompanyProvider')
  return management
}
