'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompany } from '@/contexts/CompanyContext'
import { assertActiveCompany } from '@/lib/company-guard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import CsvUploader from '@/components/csv-import/CsvUploader'
import StagingTable from '@/components/csv-import/StagingTable'
import { StagingRow } from '@/lib/csv-import'
import { useCurrentPeriod } from '@/contexts/FiscalPeriodContext'
import { useToast } from '@/lib/toast'
import { isAppError } from '@/lib/errors'
import { importStagingEntries } from '@/lib/journal-save'
import { createMappingRule } from '@/lib/mapping-rules'
import OpeningBalanceImpactNotice from '@/components/OpeningBalanceImpactNotice'
import PeriodClosedNotice from '@/components/PeriodClosedNotice'
import { isPeriodClosed } from '@/lib/period-close-state'

type Account = {
  id: string
  code: string
  name: string
  parent_id: string | null
}

type TaxCode = {
  id: string
  name: string
  short_name: string | null
}

type MappingRule = {
  id: string
  keyword: string
  account_id: string
  priority: number
}

export default function CsvImportPage() {
  const company = useCompany()
  const { period } = useCurrentPeriod()
  const closed = isPeriodClosed(period)
  const toast = useToast()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([])
  const [stagingRows, setStagingRows] = useState<StagingRow[]>([])
  const [mappingRules, setMappingRules] = useState<MappingRule[]>([])
  const [registering, setRegistering] = useState(false)
  const [registerMessage, setRegisterMessage] = useState('')
  const [registerError, setRegisterError] = useState('')
  const [registerReason, setRegisterReason] = useState('')

  // ルール追加フォーム
  const [newKeyword, setNewKeyword] = useState('')
  const [newAccountId, setNewAccountId] = useState('')
  const [newPriority, setNewPriority] = useState('10')
  const [addingRule, setAddingRule] = useState(false)

  const fetchAccounts = useCallback(async () => {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, code, name, parent_id')
      .eq('company_id', company.id)
      .order('code', { ascending: true })
    if (error) { console.error(error); return }
    setAccounts((data as Account[]) ?? [])
  }, [company.id])

  const fetchTaxCodes = useCallback(async () => {
    const { data, error } = await supabase
      .from('tax_codes')
      .select('id, name, short_name')
      .eq('is_current', true)
      .order('sort_order', { ascending: true })
    if (error) { console.error(error); return }
    setTaxCodes((data as TaxCode[]) ?? [])
  }, [])

  const fetchStaging = useCallback(async () => {
    const { data, error } = await supabase
      .from('import_staging')
      .select('*')
      .eq('company_id', company.id)
      .eq('is_processed', false)
      .order('raw_date', { ascending: true })
    if (error) { console.error(error); return }
    setStagingRows((data as StagingRow[]) ?? [])
  }, [company.id])

  const fetchMappingRules = useCallback(async () => {
    const { data, error } = await supabase
      .from('mapping_rules')
      .select('id, keyword, account_id, priority')
      .eq('company_id', company.id)
      .order('priority', { ascending: false })
    if (error) { console.error(error); return }
    setMappingRules((data as MappingRule[]) ?? [])
  }, [company.id])

  useEffect(() => {
    fetchAccounts()
    fetchTaxCodes()
    fetchStaging()
    fetchMappingRules()
  }, [fetchAccounts, fetchTaxCodes, fetchStaging, fetchMappingRules])

  const handleUploaded = () => {
    fetchStaging()
  }

  const handleStagingChanged = () => {
    fetchStaging()
  }

  // 借方科目・貸方科目が全行設定済みであれば本登録可能（税区分NULLは許容）
  const canRegister =
    stagingRows.length > 0 &&
    stagingRows.every((row) => !!row.predicted_account_id && !!row.counter_account_id)

  const handleRegister = async () => {
    if (closed) { setRegisterError('この期は確定済みです。設定画面で確定を解除してください。'); return }
    setRegisterError('')
    setRegisterMessage('')
    setRegisterReason('')
    if (!period) { setRegisterError('現在の会計期間が設定されていません。'); return }
    setRegistering(true)

    try {
      // 全件を DB 関数で1トランザクションに登録する（日付・借貸・金額・会計期間は DB 側で検証。
      // 登録済み・存在しない取込データも拒否される）。処理順は画面に表示している順 = エラーの「n行目」と一致
      // 補助科目（debit_sub_account_id / credit_sub_account_id）は従来どおり未対応
      const count = await importStagingEntries(period.id, stagingRows.map((r) => r.id), company.id)
      toast.success(`${count}件の仕訳を登録しました。`)
      fetchStaging()
    } catch (e) {
      console.error(e)
      setRegisterError('本登録に失敗しました。登録はすべて取り消されました。')
      setRegisterReason(isAppError(e) ? e.message : 'データベースとの通信に失敗しました。')
      // 通信エラーで結果が分からない場合に備えて、取込データの最新状態を読み直す
      fetchStaging()
    } finally {
      setRegistering(false)
    }
  }

  const handleAddRule = async () => {
    if (!newKeyword.trim() || !newAccountId) return
    setAddingRule(true)
    try {
      await createMappingRule({
        keyword: newKeyword.trim(),
        account_id: newAccountId,
        priority: parseInt(newPriority, 10) || 10,
      }, company.id)
      setNewKeyword('')
      setNewAccountId('')
      setNewPriority('10')
      fetchMappingRules()
    } catch (e) {
      console.error(e)
      toast.error(isAppError(e) ? e.message : 'ルールの追加に失敗しました')
    } finally {
      setAddingRule(false)
    }
  }

  const handleDeleteRule = async (id: string) => {
    try { assertActiveCompany(company.id) } catch (error) { toast.error(error instanceof Error ? error.message : '会社を確認してください'); return }
    const { error } = await supabase.from('mapping_rules').delete().eq('id', id)
      .eq('company_id', company.id)
    if (error) { console.error(error); return }
    fetchMappingRules()
  }

  const getAccountName = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId)
    return account ? `${account.code}：${account.name}` : accountId
  }

  // Only parent accounts for the rule selector
  const parentAccounts = accounts.filter((a) => a.parent_id === null)

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold">CSVインポート</h1>
      <OpeningBalanceImpactNotice companyId={company.id} periodId={period?.id ?? null} />
      <PeriodClosedNotice period={period} />

      {/* アップロードエリア */}
      {/* 入力無効化は案内のため。保存時はDBの年度ロックが最終防御となる。 */}
      <fieldset disabled={closed} className="min-w-0"><CsvUploader onUploaded={handleUploaded} /></fieldset>

      {/* ルール管理エリア */}
      <div className="border rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-semibold">ルール管理</h2>
        <p className="text-sm text-muted-foreground">
          キーワードと科目を登録しておくと、CSVの科目名が一致しない場合のフォールバックとして使用されます。
        </p>

        {/* ルール追加フォーム */}
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <Label className="text-sm">キーワード</Label>
            <Input
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              placeholder="例：電気代"
              className="w-40"
            />
          </div>
          <div>
            <Label className="text-sm">勘定科目</Label>
            <select
              className="mt-1 block w-48 border rounded px-3 py-2 text-sm bg-background"
              value={newAccountId}
              onChange={(e) => setNewAccountId(e.target.value)}
            >
              <option value="">科目を選択</option>
              {parentAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code}：{a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-sm">優先度</Label>
            <Input
              type="number"
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value)}
              className="w-20"
            />
          </div>
          <Button
            onClick={handleAddRule}
            disabled={addingRule || !newKeyword.trim() || !newAccountId}
            variant="outline"
          >
            {addingRule ? '追加中...' : 'ルール追加'}
          </Button>
        </div>

        {/* ルール一覧 */}
        {mappingRules.length === 0 ? (
          <p className="text-sm text-muted-foreground">ルールが登録されていません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="pb-2 pr-4">キーワード</th>
                  <th className="pb-2 pr-4">勘定科目</th>
                  <th className="pb-2 pr-4">優先度</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {mappingRules.map((rule) => (
                  <tr key={rule.id} className="border-b hover:bg-muted/30">
                    <td className="py-1.5 pr-4">{rule.keyword}</td>
                    <td className="py-1.5 pr-4">{getAccountName(rule.account_id)}</td>
                    <td className="py-1.5 pr-4">{rule.priority}</td>
                    <td className="py-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteRule(rule.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        削除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 確認・修正テーブル */}
      <fieldset disabled={closed} className="min-w-0 border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            取込データ確認{stagingRows.length > 0 && `（${stagingRows.length}件）`}
          </h2>
        </div>

        <StagingTable
          rows={stagingRows}
          accounts={accounts}
          taxCodes={taxCodes}
          onChanged={handleStagingChanged}
          onError={(msg) => toast.error(msg)}
        />

        {stagingRows.length > 0 && (
          <div className="pt-2">
            {registerError && (
              <div className="text-sm text-red-500 mb-3">{registerError}</div>
            )}
            {registerReason && (
              <p className="text-sm text-red-500 mb-3">{registerReason}</p>
            )}
            {registerMessage && (
              <div className="text-sm text-green-600 mb-3">{registerMessage}</div>
            )}
            {!canRegister && (
              <p className="text-sm text-amber-600 mb-3">
                すべての行に借方科目と貸方科目を設定してください。
              </p>
            )}
            <Button onClick={handleRegister} disabled={closed || !canRegister || registering}>
              {registering ? '登録中...' : '本登録'}
            </Button>
          </div>
        )}
      </fieldset>
    </div>
  )
}
