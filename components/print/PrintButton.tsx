'use client'

import { Button } from '@/components/ui/button'
import { Printer } from 'lucide-react'

export default function PrintButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="no-print"
      onClick={() => window.print()}
    >
      <Printer className="h-4 w-4 mr-1" />
      印刷
    </Button>
  )
}
