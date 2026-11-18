'use client'

import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import { AccountWithAliases } from '@/lib/account-search'
import { TaxCode } from '@/lib/tax-codes'
import AccountCombobox from './AccountCombobox'

export type { AccountWithAliases as Account }

export type LineState = {
  side: 'DEBIT' | 'CREDIT'
  account_id: string
  amount: string
  tax_code: string
  description: string
}

type Props = {
  line: LineState
  index: number
  accounts: AccountWithAliases[]
  taxcodes: TaxCode[]
  onChange: (index: number, field: keyof LineState, value: string) => void
  onRemove: (index: number) => void
  canRemove: boolean
  showSubAccount?: boolean
  showTaxClass?: boolean
}

export default function JournalLineRow({
  line,
  index,
  accounts,
  taxcodes,
  onChange,
  onRemove,
  canRemove,
  showSubAccount,
  showTaxClass,
}: Props) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [selectedSubAccountId, setSelectedSubAccountId] = useState<string | null>(null)

  useEffect(() => {
    const account = accounts.find(a => a.id === line.account_id)
    if (account?.parent_id) {
      setSelectedAccountId(account.parent_id)
      setSelectedSubAccountId(account.id)
    } else {
      setSelectedAccountId(account?.id ?? '')
      setSelectedSubAccountId(null)
    }
  }, [line.account_id, accounts])

  const parentAccounts = accounts.filter(a => a.parent_id === null)
  const subAccounts = accounts.filter(a => a.parent_id === selectedAccountId)
  const hasSubAccounts = subAccounts.length > 0

  const handleAccountChange = (newAccountId: string) => {
    setSelectedAccountId(newAccountId)
    setSelectedSubAccountId(null)
    onChange(index, 'account_id', newAccountId)
  }

  const handleSubAccountChange = (newSubAccountId: string) => {
    setSelectedSubAccountId(newSubAccountId)
    onChange(index, 'account_id', newSubAccountId)
  }

  return (
    <tr>
      {/* 区分 */}
      <td className="p-1">
        <Select
          value={line.side}
          onValueChange={(v) => onChange(index, 'side', v)}
        >
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DEBIT">借方</SelectItem>
            <SelectItem value="CREDIT">貸方</SelectItem>
          </SelectContent>
        </Select>
      </td>

      {/* 勘定科目（親科目のみ） */}
      <td className="p-1">
        <AccountCombobox
          accounts={parentAccounts}
          value={selectedAccountId}
          onChange={handleAccountChange}
        />
      </td>

      {/* 補助科目 */}
      {showSubAccount !== false && (
        <td className="p-1">
          {hasSubAccounts && (
            <AccountCombobox
              accounts={subAccounts}
              value={selectedSubAccountId ?? ''}
              onChange={handleSubAccountChange}
              showCode={false}
            />
          )}
        </td>
      )}

      {/* 金額 */}
      <td className="p-1">
        <Input
          type="number"
          className="w-32 text-right"
          value={line.amount}
          onChange={(e) => onChange(index, 'amount', e.target.value)}
          onKeyDown={(e) => {
            if (e.key === '/' || e.key === '.') {
              e.preventDefault()
              if (line.amount) {
                onChange(index, 'amount', line.amount + '000')
              }
            }
          }}
          placeholder="0"
        />
      </td>

      {/* 税区分 */}
      {showTaxClass !== false && (
        <td className="p-1">
          <Select
            value={line.tax_code}
            onValueChange={(v) => onChange(index, 'tax_code', v)}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="税区分" />
            </SelectTrigger>
            <SelectContent>
              {taxcodes.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </td>
      )}

      {/* 削除ボタン */}
      <td className="p-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onRemove(index)}
          disabled={!canRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  )
}
