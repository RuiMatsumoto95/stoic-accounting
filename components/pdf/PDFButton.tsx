'use client'

import { useState } from 'react'
import { FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  href: string
  filename?: string
}

export default function PDFButton({ href, filename = 'document.pdf' }: Props) {
  const [loading, setLoading] = useState(false)

  const handleClick = async () => {
    setLoading(true)
    try {
      const res = await fetch(href)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(typeof body?.error === 'string' ? body.error : 'PDF生成に失敗しました')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'PDF生成に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="no-print"
      onClick={handleClick}
      disabled={loading}
    >
      <FileDown className="h-4 w-4 mr-1" />
      {loading ? '生成中...' : 'PDF'}
    </Button>
  )
}
