'use client'

import { supabase } from '@/lib/supabase'
import { useCompany } from '@/contexts/CompanyContext'
import { assertActiveCompany } from '@/lib/company-guard'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StagingRow } from '@/lib/csv-import'

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

type Props = {
  rows: StagingRow[]
  accounts: Account[]
  taxCodes: TaxCode[]
  onChanged: () => void
  onError: (message: string) => void
}

function formatAmount(amount: number): string {
  if (amount === 0) return ''
  return amount.toLocaleString()
}

function formatDate(raw: string): string {
  return raw.replace(/-/g, '/')
}

export default function StagingTable({ rows, accounts, taxCodes, onChanged, onError }: Props) {
  const company = useCompany()
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">インポートデータがありません</p>
  }

  const canWrite = () => {
    try { assertActiveCompany(company.id); return true } catch (error) {
      onError(error instanceof Error ? error.message : '会社を確認してください')
      return false
    }
  }

  const parentAccounts = accounts.filter((a) => a.parent_id === null)

  const getSubAccounts = (parentId: string) => accounts.filter((a) => a.parent_id === parentId)

  const handleAccountChange = async (
    id: string,
    field: 'predicted_account_id' | 'counter_account_id',
    value: string
  ) => {
    // Clear corresponding sub-account when parent changes
    const clearField =
      field === 'predicted_account_id' ? 'debit_sub_account_id' : 'credit_sub_account_id'
    if (!canWrite()) return

    const { error } = await supabase
      .from('import_staging')
      .update({ [field]: value || null, [clearField]: null })
      .eq('id', id)
      .eq('company_id', company.id)
    if (error) { console.error(error); onError('科目の更新に失敗しました'); return }
    onChanged()
  }

  const handleSubAccountChange = async (
    id: string,
    field: 'debit_sub_account_id' | 'credit_sub_account_id',
    value: string
  ) => {
    if (!canWrite()) return

    const { error } = await supabase
      .from('import_staging')
      .update({ [field]: value || null })
      .eq('id', id)
      .eq('company_id', company.id)
    if (error) { console.error(error); onError('補助科目の更新に失敗しました'); return }
    onChanged()
  }

  const handleTaxCodeChange = async (
    id: string,
    field: 'debit_tax_code_id' | 'credit_tax_code_id',
    value: string
  ) => {
    if (!canWrite()) return

    const { error } = await supabase
      .from('import_staging')
      .update({ [field]: value || null })
      .eq('id', id)
      .eq('company_id', company.id)
    if (error) { console.error(error); onError('税区分の更新に失敗しました'); return }
    onChanged()
  }

  const handleDelete = async (id: string) => {
    if (!canWrite()) return

    const { error } = await supabase.from('import_staging').delete().eq('id', id)
      .eq('company_id', company.id)
    if (error) { console.error(error); onError('行の削除に失敗しました'); return }
    onChanged()
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>日付</TableHead>
            <TableHead>摘要</TableHead>
            <TableHead>借方科目</TableHead>
            <TableHead>借方補助</TableHead>
            <TableHead>借方税区分</TableHead>
            <TableHead className="text-right">借方金額</TableHead>
            <TableHead>貸方科目</TableHead>
            <TableHead>貸方補助</TableHead>
            <TableHead>貸方税区分</TableHead>
            <TableHead className="text-right">貸方金額</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const hasWarnings = (row.parse_warnings?.length ?? 0) > 0
            const debitSubs = row.predicted_account_id
              ? getSubAccounts(row.predicted_account_id)
              : []
            const creditSubs = row.counter_account_id
              ? getSubAccounts(row.counter_account_id)
              : []

            return (
              <TableRow key={row.id} className={hasWarnings ? 'bg-amber-50' : ''}>
                <TableCell className="whitespace-nowrap">{formatDate(row.raw_date)}</TableCell>
                <TableCell className="max-w-[12rem]">
                  <div className="truncate">{row.raw_description}</div>
                  {hasWarnings && (
                    <div className="text-xs text-amber-600 mt-0.5 whitespace-normal">
                      {row.parse_warnings!.join(' / ')}
                    </div>
                  )}
                </TableCell>

                {/* 借方科目 */}
                <TableCell>
                  <select
                    className="block w-36 border rounded px-2 py-1 text-sm bg-background"
                    value={row.predicted_account_id ?? ''}
                    onChange={(e) =>
                      handleAccountChange(row.id, 'predicted_account_id', e.target.value)
                    }
                  >
                    <option value="">科目を選択</option>
                    {parentAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code}：{a.name}
                      </option>
                    ))}
                  </select>
                </TableCell>

                {/* 借方補助科目 */}
                <TableCell>
                  {debitSubs.length > 0 ? (
                    <select
                      className="block w-28 border rounded px-2 py-1 text-sm bg-background"
                      value={row.debit_sub_account_id ?? ''}
                      onChange={(e) =>
                        handleSubAccountChange(row.id, 'debit_sub_account_id', e.target.value)
                      }
                    >
                      <option value="">なし</option>
                      {debitSubs.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </TableCell>

                {/* 借方税区分 */}
                <TableCell>
                  <select
                    className="block w-28 border rounded px-2 py-1 text-sm bg-background"
                    value={row.debit_tax_code_id ?? ''}
                    onChange={(e) =>
                      handleTaxCodeChange(row.id, 'debit_tax_code_id', e.target.value)
                    }
                  >
                    <option value="">なし</option>
                    {taxCodes.map((tc) => (
                      <option key={tc.id} value={tc.id}>
                        {tc.short_name ?? tc.name}
                      </option>
                    ))}
                  </select>
                </TableCell>

                <TableCell className="text-right">{formatAmount(row.raw_debit_amount)}</TableCell>

                {/* 貸方科目 */}
                <TableCell>
                  <select
                    className="block w-36 border rounded px-2 py-1 text-sm bg-background"
                    value={row.counter_account_id ?? ''}
                    onChange={(e) =>
                      handleAccountChange(row.id, 'counter_account_id', e.target.value)
                    }
                  >
                    <option value="">科目を選択</option>
                    {parentAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code}：{a.name}
                      </option>
                    ))}
                  </select>
                </TableCell>

                {/* 貸方補助科目 */}
                <TableCell>
                  {creditSubs.length > 0 ? (
                    <select
                      className="block w-28 border rounded px-2 py-1 text-sm bg-background"
                      value={row.credit_sub_account_id ?? ''}
                      onChange={(e) =>
                        handleSubAccountChange(row.id, 'credit_sub_account_id', e.target.value)
                      }
                    >
                      <option value="">なし</option>
                      {creditSubs.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </TableCell>

                {/* 貸方税区分 */}
                <TableCell>
                  <select
                    className="block w-28 border rounded px-2 py-1 text-sm bg-background"
                    value={row.credit_tax_code_id ?? ''}
                    onChange={(e) =>
                      handleTaxCodeChange(row.id, 'credit_tax_code_id', e.target.value)
                    }
                  >
                    <option value="">なし</option>
                    {taxCodes.map((tc) => (
                      <option key={tc.id} value={tc.id}>
                        {tc.short_name ?? tc.name}
                      </option>
                    ))}
                  </select>
                </TableCell>

                <TableCell className="text-right">{formatAmount(row.raw_credit_amount)}</TableCell>

                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(row.id)}
                    className="text-red-500 hover:text-red-700"
                  >
                    削除
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
