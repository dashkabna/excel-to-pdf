import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Хуудас олдсонгүй</h2>
      <p className="text-sm text-[var(--color-text-muted)]">Хаяг буруу эсвэл хуудас устсан байна.</p>
      <Link href="/" className="text-sm font-medium text-[var(--color-accent)] underline underline-offset-2">
        Хуулгын тайлан руу буцах
      </Link>
    </div>
  )
}
