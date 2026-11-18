import { getAllPeriods } from '@/lib/fiscal-period'
import DisplaySettings from '@/components/settings/DisplaySettings'
import FiscalPeriodSettings from '@/components/settings/FiscalPeriodSettings'
import CompanySettings from '@/components/settings/CompanySettings'
import { getCompanyCookieId } from '@/lib/company-server'
import { supabase } from '@/lib/supabase'

export default async function SettingsPage() {
  const companyId = await getCompanyCookieId()
  if (!companyId) return <p className="p-6">会社を選択してから設定を開いてください</p>
  const { data: company, error } = await supabase.from('companies').select('id').eq('id', companyId).single()
  if (error || !company) return <p className="p-6">会社を選択し直してください</p>
  const periods = await getAllPeriods(companyId)
  return (
    <div className="max-w-2xl mx-auto space-y-8 p-6">
      <h1 className="text-2xl font-bold">設定</h1>
      <DisplaySettings />
      <CompanySettings />
      <FiscalPeriodSettings initialPeriods={periods} />
    </div>
  )
}
