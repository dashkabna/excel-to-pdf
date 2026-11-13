'use client'

import { useEffect } from 'react'

/** Root layout өөрөө унасан үед — globals.css ачаалагдаагүй байж болох тул inline style. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[global.error]', error)
  }, [error])

  return (
    <html lang="mn">
      <body style={{ margin: 0, fontFamily: 'Arial, Helvetica, sans-serif', background: '#edeff2', color: '#202124' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 16,
            textAlign: 'center',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Хуудсыг ачаалахад алдаа гарлаа</h2>
          <p style={{ fontSize: 14, color: '#5f6368', margin: 0 }}>Дахин оролдоод, шаардлагатай бол админд мэдэгдэнэ үү.</p>
          <button
            type="button"
            onClick={reset}
            style={{ border: 0, borderRadius: 8, padding: '8px 16px', background: '#1a73e8', color: '#fff', fontSize: 14, cursor: 'pointer' }}
          >
            Дахин оролдох
          </button>
        </div>
      </body>
    </html>
  )
}
