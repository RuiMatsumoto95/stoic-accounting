import { Alert, AlertDescription } from '@/components/ui/alert'
import { isPeriodClosed } from '@/lib/period-close-state'
import type { FiscalPeriod } from '@/lib/fiscal-period'

export default function PeriodClosedNotice({ period }: { period: Pick<FiscalPeriod, 'closed_at'> | null | undefined }) {
  return isPeriodClosed(period) ? <Alert><AlertDescription>
    この期は確定済みです（変更できません）。変更するには、設定画面で確定を解除してください。
  </AlertDescription></Alert> : null
}
