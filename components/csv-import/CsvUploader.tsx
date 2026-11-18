'use client'

import { useRef, useState, useEffect } from 'react'
import Papa from 'papaparse'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { parseCsvFile, insertStagingRows, CsvImportError, CsvImportWarning } from '@/lib/csv-import'
import { parseYayoiCsvFile } from '@/lib/csv-import-yayoi'
import { decodeCsvText, prepareCsvRows, type CsvFormat } from '@/lib/csv-upload'
import { supabase } from '@/lib/supabase'
import { useCompany } from '@/contexts/CompanyContext'
import { createMappingRule } from '@/lib/mapping-rules'

type Props = {
  onUploaded: (count: number) => void
}

const MAPPABLE_COLUMNS = [
  '借方科目', '貸方科目', '借方補助科目', '貸方補助科目',
  '借方勘定科目', '貸方勘定科目', // 弥生形式のパーサーが使う列名
]

const isMappableError = (error: CsvImportError): boolean =>
  MAPPABLE_COLUMNS.includes(error.column) && error.value !== '' // 空欄は置換ルールで解決できない

export default function CsvUploader({ onUploaded }: Props) {
  const company = useCompany()
  const inputRef = useRef<HTMLInputElement>(null)
  const [format, setFormat] = useState<CsvFormat>('custom')
  const [uploading, setUploading] = useState(false)
  const [errors, setErrors] = useState<CsvImportError[]>([])
  const [warnings, setWarnings] = useState<CsvImportWarning[]>([])
  const [parseError, setParseError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // 科目データ（置換ルール登録Dialog用）
  const [accounts, setAccounts] = useState<{ id: string; code: string; name: string }[]>([])

  // 置換ルール登録Dialog
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false)
  const [mappingTargetError, setMappingTargetError] = useState<CsvImportError | null>(null)
  const [mappingAccountId, setMappingAccountId] = useState('')
  const [mappingSubmitting, setMappingSubmitting] = useState(false)
  const [mappingRegisteredMessage, setMappingRegisteredMessage] = useState('')

  useEffect(() => {
    supabase
      .from('accounts')
      .select('id, code, name')
      .eq('company_id', company.id)
      .order('code', { ascending: true })
      .then(({ data }) => setAccounts(data ?? []))
  }, [company.id])

  const openMappingDialog = (error: CsvImportError) => {
    setMappingTargetError(error)
    setMappingAccountId('')
    setMappingDialogOpen(true)
  }

  const handleMappingSubmit = async () => {
    if (!mappingTargetError || !mappingAccountId) return
    setMappingSubmitting(true)
    try {
      await createMappingRule({
        keyword: mappingTargetError.value,
        account_id: mappingAccountId,
        priority: 10,
      }, company.id)
      setMappingDialogOpen(false)
      setMappingRegisteredMessage(
        '置換ルールを登録しました。CSVを再度アップロードしてください。'
      )
    } catch (e) {
      console.error(e)
      setParseError(e instanceof Error ? e.message : '置換ルールの登録に失敗しました')
    } finally {
      setMappingSubmitting(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    handleUpload(file)
  }

  const handleUpload = async (file: File) => {
    setErrors([])
    setWarnings([])
    setParseError('')
    setSuccessMessage('')
    setMappingRegisteredMessage('')
    setUploading(true)

    try {
      // 文字コードは UTF-8 / Shift-JIS を自動判定する（弥生の出力 CSV は Shift-JIS）
      const { text } = decodeCsvText(await file.arrayBuffer())
      const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true })

      // 独自形式は先頭行を見出し行として捨てる。弥生形式は見出し行なしのため、先頭行も仕訳として扱う
      const prepared = prepareCsvRows(format, parsed.data)
      if (!prepared.ok) {
        setParseError(prepared.message)
        return
      }
      const dataRows = prepared.rows

      if (dataRows.length === 0) {
        setParseError('CSVにデータ行がありません。')
        return
      }

      const { rows, errors: parseErrors, warnings: parseWarnings } = format === 'yayoi'
        ? await parseYayoiCsvFile(dataRows, 1, company.id)
        : await parseCsvFile(dataRows, company.id)

      if (parseErrors.length > 0) {
        setErrors(parseErrors)
        return
      }

      if (rows.length === 0) {
        setParseError('有効な行がありませんでした。')
        return
      }

      await insertStagingRows(rows, company.id)
      setWarnings(parseWarnings)
      setSuccessMessage(`${rows.length}件のデータを取り込みました。`)
      onUploaded(rows.length)
    } catch (e) {
      console.error(e)
      setParseError('アップロード中にエラーが発生しました。')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <h2 className="text-lg font-semibold">CSVアップロード</h2>

      {/* フォーマット選択 */}
      <div className="flex gap-5 text-sm">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="csvFormat"
            value="custom"
            checked={format === 'custom'}
            onChange={() => setFormat('custom')}
          />
          独自形式
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="csvFormat"
            value="yayoi"
            checked={format === 'yayoi'}
            onChange={() => setFormat('yayoi')}
          />
          弥生形式
        </label>
      </div>

      <p className="text-sm text-muted-foreground">
        {format === 'custom'
          ? '列順：日付・借方科目・借方補助・借方税区分・借方金額・貸方科目・貸方補助・貸方税区分・貸方金額・摘要'
          : '弥生会計のCSVエクスポートデータをインポートします（識別フラグ2000・2111の行を処理。複合仕訳はスキップ）。'}
      </p>

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? '処理中...' : 'ファイルを選択'}
        </Button>
        <span className="text-sm text-muted-foreground">CSVファイル (.csv)</span>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {parseError && <div className="text-sm text-red-500">{parseError}</div>}

      {successMessage && <div className="text-sm text-green-600">{successMessage}</div>}

      {errors.length > 0 && (
        <div>
          <p className="text-sm font-medium text-red-600 mb-1">
            取込エラー（{errors.length}件）
          </p>
          {mappingRegisteredMessage && (
            <p className="text-sm text-green-600 mb-2">{mappingRegisteredMessage}</p>
          )}
          <ul className="text-sm text-red-700 space-y-1">
            {errors.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-4">
                <span>
                  {e.row}行目 {e.column}「{e.value}」：{e.message}
                </span>
                {isMappableError(e) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => openMappingDialog(e)}
                  >
                    置換ルールを登録
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div>
          <p className="text-sm font-medium text-amber-600 mb-1">
            取込警告（{warnings.length}件）
          </p>
          <ul className="text-sm text-amber-700 space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>
                {w.row}行目
                {w.column
                  ? ` ${w.column}${w.value ? `「${w.value}」` : ''}：`
                  : '：'}
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 置換ルール登録Dialog */}
      <Dialog open={mappingDialogOpen} onOpenChange={setMappingDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>置換ルールを登録</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label className="text-sm">CSV上の表記</Label>
              <Input value={mappingTargetError?.value ?? ''} readOnly className="bg-muted" />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">正しい科目</Label>
              <select
                className="block w-full border rounded px-3 py-2 text-sm bg-background"
                value={mappingAccountId}
                onChange={(e) => setMappingAccountId(e.target.value)}
              >
                <option value="">科目を選択</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code}：{a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMappingDialogOpen(false)}>
              キャンセル
            </Button>
            <Button
              onClick={handleMappingSubmit}
              disabled={!mappingAccountId || mappingSubmitting}
            >
              {mappingSubmitting ? '登録中...' : '登録'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
