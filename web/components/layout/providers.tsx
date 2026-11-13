'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="top-right"
        richColors
        closeButton
        expand
        duration={6000}
        toastOptions={{
          style: { wordBreak: 'break-word' },
          classNames: { description: 'text-xs whitespace-pre-wrap' },
        }}
      />
    </QueryClientProvider>
  )
}
