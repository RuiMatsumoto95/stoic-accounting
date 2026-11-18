'use client'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useDisplaySettings } from '@/contexts/DisplaySettingsContext'
import type { DisplaySettings as DisplaySettingsValue } from '@/lib/display-settings'
import { useToast } from '@/lib/toast'
import { useCompany, useCompanyManagement } from '@/contexts/CompanyContext'
import { updateTaxMethod, TAX_METHOD_LABELS, TaxMethod } from '@/lib/tax-codes'

export default function DisplaySettings() {
  const company = useCompany()
  const { refreshCompanies } = useCompanyManagement()
  const [settings, setSettings] = useDisplaySettings()
  const toast = useToast()
  const taxMethod = company.tax_method
  const [taxMethodLoading, setTaxMethodLoading] = useState(false)

  function handleChange(key: 'showSubAccount' | 'showTaxClass', value: boolean) {
    setSettings({ ...settings, [key]: value })
    toast.success('設定を保存しました')
  }

  function handleTextSizeChange(textSize: DisplaySettingsValue['textSize']) {
    setSettings({ ...settings, textSize })
    toast.success('設定を保存しました')
  }

  async function handleTaxMethodChange(method: TaxMethod) {
    setTaxMethodLoading(true)
    try {
      await updateTaxMethod(company.id, method)
      await refreshCompanies()
      toast.success('事業者タイプを保存しました')
    } catch (e) {
      console.error(e)
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally { setTaxMethodLoading(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>表示設定</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="showSubAccount">補助科目列を表示する</Label>
          <Switch
            id="showSubAccount"
            checked={settings.showSubAccount}
            onCheckedChange={v => handleChange('showSubAccount', v)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="showTaxClass">税区分列を表示する</Label>
          <Switch
            id="showTaxClass"
            checked={settings.showTaxClass}
            onCheckedChange={v => handleChange('showTaxClass', v)}
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">仕訳日記帳の文字サイズ</legend>
          <div className="flex gap-4">
            {([{ value: 'normal', label: '標準（13px）' }, { value: 'large', label: '大（16px）' }] as const).map(({ value, label }) => (
              <label key={value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="journalTextSize"
                  value={value}
                  checked={settings.textSize === value}
                  onChange={() => handleTextSizeChange(value)}
                  className="accent-primary"
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="border-t pt-4">
          <p className="text-sm font-medium mb-3">事業者タイプ</p>
          {taxMethodLoading ? (
            <p className="text-sm text-muted-foreground">読み込み中...</p>
          ) : (
            <div className="space-y-2">
              {(Object.entries(TAX_METHOD_LABELS) as [TaxMethod, string][]).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="taxMethod"
                    value={value}
                    checked={taxMethod === value}
                    onChange={() => handleTaxMethodChange(value)}
                    className="accent-primary"
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
              <p className="text-xs text-muted-foreground mt-2">
                この会社の仕訳入力・CSV取込に適用します。
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
