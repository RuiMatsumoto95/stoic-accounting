'use client'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { FiscalPeriod, getCurrentPeriod } from '@/lib/fiscal-period'
import { useCompany } from './CompanyContext'
import { createRequestGeneration } from '@/lib/company'

type ContextValue = {
  period: FiscalPeriod | null
  refresh: () => void
}

const FiscalPeriodContext = createContext<ContextValue | undefined>(undefined)

export function FiscalPeriodProvider({ children }: { children: React.ReactNode }) {
  const company = useCompany()
  const [generation] = useState(createRequestGeneration)
  const [period, setPeriod] = useState<FiscalPeriod | null>(null)

  const load = useCallback(async () => {
    const request = generation.next()
    try {
      const p = await getCurrentPeriod(company.id)
      if (generation.isCurrent(request)) setPeriod(p)
    } catch {
      if (generation.isCurrent(request)) setPeriod(null)
    }
  }, [company.id, generation])

  useEffect(() => {
    load()
    return generation.invalidate
  }, [load, generation])

  return (
    <FiscalPeriodContext.Provider value={{ period, refresh: load }}>
      {children}
    </FiscalPeriodContext.Provider>
  )
}

export function useCurrentPeriod(): ContextValue {
  const ctx = useContext(FiscalPeriodContext)
  if (!ctx) throw new Error('useCurrentPeriod must be used within FiscalPeriodProvider')
  return ctx
}
