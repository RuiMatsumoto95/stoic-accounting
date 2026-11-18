'use client'
import { useEffect, useState, useTransition } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FiscalPeriod, generatePeriodName } from '@/lib/fiscal-period'
import { createPeriod, updatePeriod } from '@/actions/fiscal-period-actions'
import { useCompany } from '@/contexts/CompanyContext'
import { useToast } from '@/lib/toast'

// タイムゾーン安全な日付加算（ローカル時間基準）
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

type Errors = {
  name?: string
  start_date?: string
  end_date?: string
  form?: string
}

type Props = {
  mode: 'create' | 'edit'
  period?: FiscalPeriod
  existingPeriods: FiscalPeriod[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export default function FiscalPeriodModal({
  mode,
  period,
  existingPeriods,
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const company = useCompany()
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false)
  const [errors, setErrors] = useState<Errors>({})

  // 開始日を編集不可にする条件
  const isStartDateReadonly =
    mode === 'edit' || (mode === 'create' && existingPeriods.length > 0)

  useEffect(() => {
    if (!open) return
    setErrors({})
    if (mode === 'edit' && period) {
      setName(period.name)
      setStartDate(period.start_date)
      setEndDate(period.end_date)
      setNameManuallyEdited(true)
    } else {
      // 既存の期間がある場合：最新期の翌日を開始日に自動セット
      const autoStart =
        existingPeriods.length > 0
          ? addDays(
              existingPeriods.reduce((max, p) =>
                p.end_date > max.end_date ? p : max
              ).end_date,
              1
            )
          : ''
      setStartDate(autoStart)
      setEndDate('')
      setName('')
      setNameManuallyEdited(false)
    }
  }, [open, mode, period, existingPeriods])

  function handleEndDateChange(v: string) {
    setEndDate(v)
    setErrors(prev => ({ ...prev, end_date: undefined }))
    if (!nameManuallyEdited && v) {
      setName(generatePeriodName(startDate, v))
    }
  }

  function validate(): Errors {
    const errs: Errors = {}
    if (!name.trim()) errs.name = '期間名を入力してください'
    if (!startDate) errs.start_date = '開始日を入力してください'
    if (!endDate) errs.end_date = '終了日を入力してください'
    else if (startDate && startDate >= endDate)
      errs.end_date = '終了日は開始日より後の日付を入力してください'
    return errs
  }

  function handleSubmit() {
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setErrors({})
    startTransition(async () => {
      let result: { error?: string } | undefined
      if (mode === 'create') {
        result = await createPeriod(company.id, {
          name: name.trim(),
          start_date: startDate,
          end_date: endDate,
        })
      } else if (period) {
        result = await updatePeriod(company.id, period.id, {
          name: name.trim(),
          start_date: startDate,
          end_date: endDate,
        })
      }
      if (result?.error) {
        setErrors({ form: result.error })
        return
      }
      toast.success('保存しました')
      onSuccess()
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? '会計期間を追加' : '会計期間を編集'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="startDate">開始日</Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              readOnly={isStartDateReadonly}
              className={isStartDateReadonly ? 'bg-muted cursor-not-allowed' : ''}
              onChange={
                isStartDateReadonly
                  ? undefined
                  : e => {
                      setStartDate(e.target.value)
                      setErrors(prev => ({ ...prev, start_date: undefined }))
                    }
              }
            />
            {errors.start_date && (
              <p className="text-red-500 text-xs">{errors.start_date}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="endDate">終了日</Label>
            <Input
              id="endDate"
              type="date"
              value={endDate}
              onChange={e => handleEndDateChange(e.target.value)}
            />
            {errors.end_date && (
              <p className="text-red-500 text-xs">{errors.end_date}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="name">期間名</Label>
            <Input
              id="name"
              value={name}
              onChange={e => {
                setName(e.target.value)
                setNameManuallyEdited(true)
                setErrors(prev => ({ ...prev, name: undefined }))
              }}
              placeholder="例: 2026年3月期"
            />
            {errors.name && (
              <p className="text-red-500 text-xs">{errors.name}</p>
            )}
          </div>
          {errors.form && (
            <p className="text-red-500 text-sm">{errors.form}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
