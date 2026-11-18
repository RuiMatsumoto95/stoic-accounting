'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useCompany } from '@/contexts/CompanyContext'
import { getNextSubAccountCode } from '@/lib/accounts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { X } from 'lucide-react'
import {
  fetchAccountMaster, saveAccountMaster, deleteAccountMaster, getParentAccountOptions,
  type Account, type AccountWithAliases, type AliasDraft,
} from '@/lib/account-master'
import {
  getPlCategoryOptions, getBsCategoryOptions, getCategoryLabel, retainValidCategories,
  TAX_CODE_OPTIONS, taxCodeToForm, getTaxCodeLabel,
} from '@/lib/account-master-options'

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  ASSET: '資産',
  LIABILITY: '負債',
  EQUITY: '純資産',
  REVENUE: '収益',
  EXPENSE: '費用',
}

const ALIAS_TYPE_LABELS: Record<AliasDraft['alias_type'], string> = {
  KANA: 'ひらがな',
  ROMAN: 'ローマ字',
  ABBREV: '略称',
  OTHER: 'その他',
}

const EMPTY_FORM = {
  code: '',
  name: '',
  type: '' as Account['type'] | '',
  parent_id: '',
  default_tax_code: '',
  pl_category: '',
  bs_category: '',
}

function sortAccountsHierarchically(accounts: AccountWithAliases[]): AccountWithAliases[] {
  const parents = accounts
    .filter(a => a.parent_id === null)
    .sort((a, b) => a.code.localeCompare(b.code))
  const childrenMap = new Map<string, AccountWithAliases[]>()
  for (const a of accounts.filter(a => a.parent_id !== null)) {
    const list = childrenMap.get(a.parent_id!) ?? []
    list.push(a)
    childrenMap.set(a.parent_id!, list)
  }
  for (const [key, children] of childrenMap) {
    childrenMap.set(key, children.sort((a, b) => a.code.localeCompare(b.code)))
  }
  const result: AccountWithAliases[] = []
  for (const parent of parents) {
    result.push(parent)
    result.push(...(childrenMap.get(parent.id) ?? []))
  }
  return result
}

export default function AccountsPage() {
  const company = useCompany()
  const showCategoryColumn = company.kind === 'INDIVIDUAL'
  const [accounts, setAccounts] = useState<AccountWithAliases[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AccountWithAliases | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [aliasesDraft, setAliasesDraft] = useState<AliasDraft[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [autoCode, setAutoCode] = useState('')
  const [autoCodeLoading, setAutoCodeLoading] = useState(false)
  const [subSuffix, setSubSuffix] = useState('')
  const parentRequest = useRef(0)
  const inheritedParent = accounts.find(account => account.id === (editTarget?.parent_id || form.parent_id))

  // 補助科目の編集モード
  const isSubAccountEdit = editTarget !== null && editTarget.parent_id !== null
  // 補助科目を持つ親科目の編集モード
  const isParentWithChildren =
    editTarget !== null &&
    editTarget.parent_id === null &&
    accounts.some(a => a.parent_id === editTarget.id)
  // 新規登録で親科目が選択されている状態
  const isCreatingSubAccount = editTarget === null && !!form.parent_id

  const fetchAccounts = useCallback(async () => {
    setLoading(true)
    try {
      setAccounts(sortAccountsHierarchically(await fetchAccountMaster(company.id)))
    } catch (error) {
      setError(error instanceof Error ? error.message : '科目を取得できませんでした')
    }
    setLoading(false)
  }, [company.id])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  const openCreateDialog = () => {
    parentRequest.current += 1
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setAliasesDraft([])
    setError('')
    setAutoCode('')
    setAutoCodeLoading(false)
    setSubSuffix('')
    setDialogOpen(true)
  }

  const openEditDialog = (account: AccountWithAliases) => {
    parentRequest.current += 1
    setAutoCodeLoading(false)
    setEditTarget(account)
    setForm({
      code: account.code,
      name: account.name,
      type: account.type,
      parent_id: account.parent_id || '',
      default_tax_code: taxCodeToForm(account.default_tax_code),
      pl_category: account.pl_category || '',
      bs_category: account.bs_category || '',
    })
    setAliasesDraft(
      account.account_aliases.map(a => ({
        id: a.id,
        alias: a.alias,
        alias_type: a.alias_type,
      }))
    )
    setError('')
    setAutoCode('')
    if (account.parent_id) {
      const parent = accounts.find(a => a.id === account.parent_id)
      const prefix = parent ? `${parent.code}-` : ''
      setSubSuffix(prefix && account.code.startsWith(prefix) ? account.code.slice(prefix.length) : '')
    } else {
      setSubSuffix('')
    }
    setDialogOpen(true)
  }

  const handleParentChange = async (value: string) => {
    const request = ++parentRequest.current
    setAutoCodeLoading(false)
    const newParentId = value === 'none' ? '' : value
    setForm(f => ({ ...f, parent_id: newParentId }))
    if (newParentId) {
      const parent = accounts.find(a => a.id === newParentId)
      if (parent) {
        setAutoCodeLoading(true)
        setAutoCode('')
        setError('')
        try {
          const code = await getNextSubAccountCode(newParentId, parent.code)
          if (request === parentRequest.current) setAutoCode(code)
        } catch (e) {
          if (request === parentRequest.current) setError((e as Error).message)
        } finally {
          if (request === parentRequest.current) setAutoCodeLoading(false)
        }
      }
    } else {
      setAutoCode('')
    }
  }

  const handleSave = async () => {
    let codeToSave: string

    if (isCreatingSubAccount) {
      codeToSave = autoCode
      if (!codeToSave) { setError('科目コードの自動採番中です。しばらくお待ちください'); return }
    } else if (isSubAccountEdit && editTarget?.parent_id) {
      const parent = accounts.find(a => a.id === editTarget.parent_id)
      if (!parent) { setError('親科目が見つかりません'); return }
      if (!/^\d{4}$/.test(subSuffix)) {
        setError('補助科目コードは4桁の数字で入力してください')
        return
      }
      codeToSave = `${parent.code}-${subSuffix}`
    } else {
      codeToSave = form.code.trim()
      if (!codeToSave) { setError('科目コードを入力してください'); return }
    }

    if (!form.name.trim()) { setError('科目名を入力してください'); return }

    // 補助科目のtype・区分は親からDBが継承する。
    if (!isSubAccountEdit && !form.parent_id) {
      if (!form.type) { setError('科目区分を選択してください'); return }
      if (['REVENUE', 'EXPENSE'].includes(form.type) && !form.pl_category) {
        setError('財務諸表区分を選択してください'); return
      }
      if (['ASSET', 'LIABILITY', 'EQUITY'].includes(form.type) && !form.bs_category) {
        setError('財務諸表区分を選択してください'); return
      }
    }

    setSaving(true)
    setError('')

    try {
      await saveAccountMaster({ company, form, code: codeToSave, editTarget, aliases: aliasesDraft })
      setDialogOpen(false)
      await fetchAccounts()
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (account: Account) => {
    if (!confirm(`「${account.name}」を削除しますか？`)) return
    try {
      await deleteAccountMaster(account.id, company.id)
      await fetchAccounts()
    } catch (error) {
      alert(error instanceof Error ? error.message : '削除に失敗しました')
    }
  }

  const getParentName = (parent_id: string | null) => {
    if (!parent_id) return ''
    const parent = accounts.find(a => a.id === parent_id)
    return parent ? `${parent.code} ${parent.name}` : ''
  }

  const getParentOptions = () => {
    return getParentAccountOptions(accounts, editTarget?.id)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">勘定科目マスタ</h1>
        <Button onClick={openCreateDialog}>＋ 新規登録</Button>
      </div>

      {error && !dialogOpen && <p role="alert" className="text-destructive mb-4">{error}</p>}
      {loading ? (
        <p className="text-muted-foreground">読み込み中...</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">科目コード</TableHead>
              <TableHead>科目名</TableHead>
              <TableHead className="w-24">科目区分</TableHead>
              {showCategoryColumn && <TableHead>財務諸表区分</TableHead>}
              <TableHead>親科目</TableHead>
              <TableHead>デフォルト税区分</TableHead>
              <TableHead className="w-28 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={showCategoryColumn ? 7 : 6} className="text-center text-muted-foreground py-8">
                  科目が登録されていません
                </TableCell>
              </TableRow>
            ) : (
              accounts.map(account => (
                <TableRow key={account.id}>
                  <TableCell>{account.code}</TableCell>
                  <TableCell>
                    {account.parent_id ? (
                      <span className="pl-4">└ {account.name}</span>
                    ) : (
                      account.name
                    )}
                  </TableCell>
                  <TableCell>{ACCOUNT_TYPE_LABELS[account.type]}</TableCell>
                  {showCategoryColumn && <TableCell>{getCategoryLabel(company.kind, account.type, account.pl_category, account.bs_category)}</TableCell>}
                  <TableCell className="text-muted-foreground text-sm">
                    {getParentName(account.parent_id)}
                  </TableCell>
                  <TableCell>{getTaxCodeLabel(account.default_tax_code)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditDialog(account)}
                      className="mr-1"
                    >
                      編集
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(account)}
                      className="text-destructive hover:text-destructive"
                    >
                      削除
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      {/* 登録・編集ダイアログ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? '勘定科目を編集' : '勘定科目を新規登録'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* 科目コード */}
            {isSubAccountEdit && editTarget ? (
              <>
                <div className="space-y-1">
                  <Label>科目コード（親科目）</Label>
                  <div className="rounded-md border px-3 py-2 text-sm bg-muted">
                    {accounts.find(a => a.id === editTarget.parent_id)?.code ?? ''}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="subSuffix">補助科目コード <span className="text-destructive">*</span></Label>
                  <Input
                    id="subSuffix"
                    value={subSuffix}
                    onChange={e => setSubSuffix(e.target.value)}
                    placeholder="例：0001"
                    maxLength={4}
                  />
                </div>
              </>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="code">科目コード <span className="text-destructive">*</span></Label>
                {isCreatingSubAccount ? (
                  <div className="rounded-md border px-3 py-2 text-sm bg-muted">
                    {autoCodeLoading
                      ? '採番中...'
                      : autoCode
                        ? <>{autoCode}<span className="ml-2 text-xs text-muted-foreground">（自動採番）</span></>
                        : <span className="text-muted-foreground">親科目を選択してください</span>
                    }
                  </div>
                ) : isParentWithChildren && editTarget ? (
                  <div className="space-y-1">
                    <div className="rounded-md border px-3 py-2 text-sm bg-muted">{form.code}</div>
                    <p className="text-xs text-muted-foreground">補助科目が存在するためコードを変更できません</p>
                  </div>
                ) : (
                  <Input
                    id="code"
                    value={form.code}
                    onChange={e => setForm({ ...form, code: e.target.value })}
                    placeholder="例：1100"
                  />
                )}
              </div>
            )}

            {/* 科目名 */}
            <div className="space-y-1">
              <Label htmlFor="name">科目名 <span className="text-destructive">*</span></Label>
              <Input
                id="name"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="例：現金"
              />
            </div>

            {/* 科目区分 */}
            {inheritedParent ? (
              <div className="space-y-1">
                <Label>科目区分</Label>
                <div className="rounded-md border px-3 py-2 text-sm bg-muted">
                  {ACCOUNT_TYPE_LABELS[inheritedParent.type]}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <Label>科目区分 <span className="text-destructive">*</span></Label>
                <Select
                  value={form.type}
                  onValueChange={value => {
                    const type = value as Account['type']
                    setForm({
                      ...form,
                      type,
                      ...retainValidCategories(company.kind, type, form.pl_category, form.bs_category),
                    })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="選択してください" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ASSET">資産</SelectItem>
                    <SelectItem value="LIABILITY">負債</SelectItem>
                    <SelectItem value="EQUITY">純資産</SelectItem>
                    <SelectItem value="REVENUE">収益</SelectItem>
                    <SelectItem value="EXPENSE">費用</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* 財務諸表区分 */}
            {inheritedParent ? (
              <div className="space-y-1">
                <Label>財務諸表区分</Label>
                <div className="rounded-md border px-3 py-2 text-sm bg-muted">
                  {getCategoryLabel(company.kind, inheritedParent.type, inheritedParent.pl_category, inheritedParent.bs_category)}
                </div>
              </div>
            ) : (
              form.type && (
                <div className="space-y-1">
                  <Label>財務諸表区分 <span className="text-destructive">*</span></Label>
                  {['REVENUE', 'EXPENSE'].includes(form.type) ? (
                    <Select
                      value={form.pl_category || 'none'}
                      onValueChange={value =>
                        setForm({ ...form, pl_category: value === 'none' ? '' : value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="選択してください" />
                      </SelectTrigger>
                      <SelectContent>
                        {getPlCategoryOptions(company.kind, form.type).map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select
                      value={form.bs_category || 'none'}
                      onValueChange={value =>
                        setForm({ ...form, bs_category: value === 'none' ? '' : value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="選択してください" />
                      </SelectTrigger>
                      <SelectContent>
                        {getBsCategoryOptions(company.kind, form.type).map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )
            )}

            {/* 親科目 */}
            {isSubAccountEdit && editTarget ? (
              <div className="space-y-1">
                <Label>親科目</Label>
                <div className="rounded-md border px-3 py-2 text-sm bg-muted">
                  {getParentName(editTarget.parent_id)}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <Label>親科目（補助科目として登録する場合）</Label>
                <Select
                  value={form.parent_id || 'none'}
                  onValueChange={handleParentChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="なし（親科目として登録）" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">なし（親科目として登録）</SelectItem>
                    {getParentOptions().map(account => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.code} {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* デフォルト税区分 */}
            <div className="space-y-1">
              <Label>デフォルト税区分</Label>
              <Select
                value={form.default_tax_code || 'none'}
                onValueChange={value => setForm({ ...form, default_tax_code: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="設定なし" />
                </SelectTrigger>
                <SelectContent>
                  {TAX_CODE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 読み方・別名（補助科目編集時は非表示） */}
            {!isSubAccountEdit && (
              <div className="space-y-2">
                <Label>読み方・別名</Label>
                {aliasesDraft.map((draft, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input
                      className="flex-1"
                      value={draft.alias}
                      onChange={e => {
                        const next = [...aliasesDraft]
                        next[i] = { ...next[i], alias: e.target.value }
                        setAliasesDraft(next)
                      }}
                      placeholder="例：げんきん、genkin"
                    />
                    <Select
                      value={draft.alias_type}
                      onValueChange={value => {
                        const next = [...aliasesDraft]
                        next[i] = { ...next[i], alias_type: value as AliasDraft['alias_type'] }
                        setAliasesDraft(next)
                      }}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ALIAS_TYPE_LABELS) as AliasDraft['alias_type'][]).map(k => (
                          <SelectItem key={k} value={k}>{ALIAS_TYPE_LABELS[k]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setAliasesDraft(aliasesDraft.filter((_, j) => j !== i))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setAliasesDraft([...aliasesDraft, { alias: '', alias_type: 'OTHER' }])
                  }
                >
                  ＋ 読み方を追加
                </Button>
              </div>
            )}

            {/* エラー表示 */}
            {error && (
              <p role="alert" className="text-sm text-destructive whitespace-pre-wrap">{error}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={handleSave} disabled={saving || autoCodeLoading}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
