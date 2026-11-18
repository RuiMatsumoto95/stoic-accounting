'use client'
import { createContext, useCallback, useContext, useRef, useState } from 'react'

type ToastType = 'info' | 'error' | 'success'
type ToastItem = { id: number; message: string; type: ToastType }
type ToastFn = {
  info:    (message: string) => void
  success: (message: string) => void
  error:   (message: string) => void
}

const STYLES: Record<ToastType, string> = {
  info:    'bg-foreground text-background',
  success: 'bg-green-600 text-white',
  error:   'bg-red-600 text-white',
}

const ToastContext = createContext<ToastFn | undefined>(undefined)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const add = useCallback((message: string, type: ToastType) => {
    const id = ++counter.current
    setItems(prev => [...prev, { id, message, type }])
    setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), 3000)
  }, [])

  const toast: ToastFn = {
    info:    useCallback((message: string) => add(message, 'info'),    [add]),
    success: useCallback((message: string) => add(message, 'success'), [add]),
    error:   useCallback((message: string) => add(message, 'error'),   [add]),
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {items.map(item => (
          <div
            key={item.id}
            className={`${STYLES[item.type]} px-4 py-2 rounded-md shadow-lg text-sm max-w-sm`}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
