import Link from 'next/link'

/** Тайлан бүтээгчийн дээд мөр. Шалгах хуудсууд (/verify) өөрийн брэндтэй хүрээтэй. */
export function AppHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="text-[20px] font-bold tracking-tight text-[#0b2e59]">TESO</span>
          <span className="h-5 w-px bg-border" aria-hidden />
          <span className="text-[14px] font-medium text-text-primary">Хуулгын тайлан</span>
        </Link>
        <Link href="/verify" className="ml-auto text-[13px] text-text-secondary hover:text-text-primary">
          Тайлан шалгах
        </Link>
      </div>
    </header>
  )
}
