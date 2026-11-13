'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[app.error]', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Хуудсыг ачаалахад алдаа гарлаа</h2>
      <p className="text-sm text-[var(--color-text-muted)]">Дахин оролдоод, шаардлагатай бол админд мэдэгдэнэ үү.</p>
      <Button type="button" onClick={reset}>
        Дахин оролдох
      </Button>
    </div>
  )
}
