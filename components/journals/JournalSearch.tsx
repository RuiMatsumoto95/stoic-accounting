'use client'

import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Account } from '@/components/journals/JournalLineRow'
import { JournalEntryWithLines } from '@/components/journals/JournalForm'
import { exportJournalsToCsv } from '@/lib/csv-export'

export type SearchParams = {
  dateFrom: string
  dateTo: string
  amountMin: string
  amountMax: string
  keyword: string
  accountId: string
}

export const EMPTY_SEARCH: SearchParams = {
  dateFrom: '',
  dateTo: '',
  amountMin: '',
  amountMax: '',
  keyword: '',
  accountId: '',
}

type Props = {
  accounts: Account[]
  params: SearchParams
  entries: JournalEntryWithLines[]
  onSearch: (params: SearchParams) => void
  onClear: () => void
}

function hasCondition(params: SearchParams): boolean {
  return Object.values(params).some(v => v !== '')
}

export default function JournalSearch({ accounts, params, entries, onSearch, onClear }: Props) {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<SearchParams>(params)

  useEffect(() => {
    setLocal(params)
  }, [params])

  const set = (key: keyof SearchParams, value: string) =>
    setLocal(prev => ({ ...prev, [key]: value }))

  const parentAccounts = accounts.filter(a => a.parent_id === null)
  const subAccounts = accounts.filter(a => a.parent_id !== null)
  const isActive = hasCondition(params)

  return (
    <div className="mb-4 border rounded-lg p-3">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-2 text-sm font-medium w-full text-left">
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            検索条件
            {isActive && (
              <Badge variant="secondary" className="text-xs">検索中</Badge>
            )}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-3 space-y-2">
            {/* 日付 */}
            <div className="flex items-center gap-2">
              <span className="text-sm w-12 shrink-0">日付</span>
              <Input
                type="date"
                value={local.dateFrom}
                onChange={e => set('dateFrom', e.target.value)}
                className="h-8 text-sm"
              />
              <span className="text-sm shrink-0">〜</span>
              <Input
                type="date"
                value={local.dateTo}
                onChange={e => set('dateTo', e.target.value)}
                className="h-8 text-sm"
              />
            </div>

            {/* 金額 */}
            <div className="flex items-center gap-2">
              <span className="text-sm w-12 shrink-0">金額</span>
              <Input
                type="number"
                placeholder="下限"
                value={local.amountMin}
                onChange={e => set('amountMin', e.target.value)}
                className="h-8 text-sm"
              />
              <span className="text-sm shrink-0">〜</span>
              <Input
                type="number"
                placeholder="上限"
                value={local.amountMax}
                onChange={e => set('amountMax', e.target.value)}
                className="h-8 text-sm"
              />
            </div>

            {/* 摘要 */}
            <div className="flex items-center gap-2">
              <span className="text-sm w-12 shrink-0">摘要</span>
              <Input
                type="text"
                placeholder="キーワード"
                value={local.keyword}
                onChange={e => set('keyword', e.target.value)}
                className="h-8 text-sm"
              />
            </div>

            {/* 科目 */}
            <div className="flex items-center gap-2">
              <span className="text-sm w-12 shrink-0">科目</span>
              <select
                value={local.accountId}
                onChange={e => set('accountId', e.target.value)}
                className="h-8 text-sm border rounded px-2 bg-background"
              >
                <option value="">すべて</option>
                {parentAccounts.map(parent => {
                  const subs = subAccounts.filter(a => a.parent_id === parent.id)
                  return (
                    <optgroup key={parent.id} label={parent.name}>
                      <option value={parent.id}>{parent.code} {parent.name}</option>
                      {subs.map(sub => (
                        <option key={sub.id} value={sub.id}>
                          　└ {sub.code} {sub.name}
                        </option>
                      ))}
                    </optgroup>
                  )
                })}
              </select>
            </div>

            {/* ボタン */}
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => onSearch(local)}>
                検索
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setLocal(EMPTY_SEARCH); onClear() }}
              >
                クリア
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={entries.length === 0}
                onClick={() => exportJournalsToCsv(entries, accounts)}
              >
                CSVエクスポート
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
