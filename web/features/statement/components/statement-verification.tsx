'use client'

import { useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AxiosError } from 'axios'
import { FileCheck2, FileWarning, Loader2, Search, ShieldAlert, ShieldCheck, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useStatementVerification } from '@/hooks/useStatement'
import { cn } from '@/lib/utils'
import {
  VERIFICATION_CODE_PATTERN,
  formatVerificationCode,
  formatVerifiedAt,
  normalizeVerificationCode,
  sha256Hex,
} from '../lib/statement-verify'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-xl space-y-4">
        <div className="flex items-center gap-2 text-text-primary">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[15px] font-semibold leading-tight">TESO ITAM</p>
            <p className="text-[12px] text-text-secondary">Тайлангийн баталгаажуулалт</p>
          </div>
        </div>
        {children}
      </div>
    </main>
  )
}

function CodeForm({ initial = '' }: { initial?: string }) {
  const router = useRouter()
  const [value, setValue] = useState(initial)
  const code = normalizeVerificationCode(value)
  const valid = VERIFICATION_CODE_PATTERN.test(code)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (valid) router.push(`/verify/${code}`)
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="verification-code" className="block text-[13px] font-medium text-text-primary">
        Баталгаажуулах код
      </label>
      <div className="flex gap-2">
        <Input
          id="verification-code"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          className="font-mono uppercase tracking-wider"
        />
        <Button type="submit" disabled={!valid}>
          <Search className="h-4 w-4" />
          Шалгах
        </Button>
      </div>
      <p className="text-[12px] text-text-secondary">PDF-ийн доод хэсэгт QR-ийн хажууд хэвлэгдсэн 16 тэмдэгт.</p>
    </form>
  )
}

/** Код оруулах хуудас (/verify). */
export function StatementVerificationForm() {
  return (
    <Shell>
      <Card>
        <CardContent className="space-y-3">
          <p className="text-[14px] text-text-primary">
            TESO ITAM-аас үүсгэсэн тайлангийн доорх QR кодыг уншуулах эсвэл кодыг нь оруулж бүртгэлийг шалгана уу.
          </p>
          <CodeForm />
        </CardContent>
      </Card>
    </Shell>
  )
}

type FileCheck =
  | { state: 'idle' }
  | { state: 'hashing'; name: string }
  | { state: 'done'; name: string; match: boolean }
  | { state: 'error'; name: string; message: string }

/** Энэ системийн PDF хэдэн MB л байдаг — том файлыг санах ойд уншихаас сэргийлнэ. */
const MAX_PDF_BYTES = 50 * 1024 * 1024

function PdfCheck({ expected }: { expected: string }) {
  const [check, setCheck] = useState<FileCheck>({ state: 'idle' })
  const [dragging, setDragging] = useState(false)
  // Хоёр файлыг дараалан оруулбал зөвхөн сүүлийнх нь үр дүнг харуулна.
  const latestRun = useRef(0)
  // sha256Hex нь HTTPS-гүй үед ч ажилладаг — файл унших боломж л хэрэгтэй.
  const supported = typeof window !== 'undefined' && typeof File !== 'undefined' && 'arrayBuffer' in File.prototype

  const run = async (file: File) => {
    const id = ++latestRun.current
    if (file.size > MAX_PDF_BYTES) {
      setCheck({ state: 'error', name: file.name, message: 'Файл хэт том байна (50MB-аас ихгүй).' })
      return
    }
    setCheck({ state: 'hashing', name: file.name })
    try {
      const hash = await sha256Hex(await file.arrayBuffer())
      if (id === latestRun.current) setCheck({ state: 'done', name: file.name, match: hash === expected.toLowerCase() })
    } catch {
      if (id === latestRun.current) {
        setCheck({ state: 'error', name: file.name, message: 'Файлыг уншиж шалгаж чадсангүй. Өөр хөтчөөр дахин оролдоно уу.' })
      }
    }
  }

  if (!supported) {
    return (
      <p className="rounded-lg border border-border px-3 py-2.5 text-[13px] text-text-secondary">
        Энэ хөтөч файл уншиж чадахгүй тул PDF файлыг тулгах боломжгүй. Өөр хөтчөөр нээнэ үү.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium text-text-primary">PDF файлаа тулгах</p>
      <label
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer.files?.[0]
          if (file) void run(file)
        }}
        className={cn(
          'flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed px-4 py-4 text-[13px] transition-colors',
          'focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40',
          dragging ? 'border-accent bg-accent-light' : 'border-border hover:border-accent hover:bg-surface-raised',
        )}
      >
        {check.state === 'hashing' ? (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-text-secondary" />
        ) : (
          <Upload className="h-5 w-5 shrink-0 text-text-secondary" />
        )}
        <span className="text-text-secondary">
          PDF файлаа сонгох эсвэл энд чирж оруулна уу. Файл таны хөтөч дотор шалгагдана — хаашаа ч илгээгдэхгүй.
        </span>
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void run(file)
            event.target.value = ''
          }}
        />
      </label>
      {check.state === 'error' ? (
        <div
          role="alert"
          className="flex gap-2 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2.5 text-[13px] text-[var(--color-danger)]"
        >
          <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-medium">«{check.name}»</span> — {check.message}
          </span>
        </div>
      ) : null}
      {check.state === 'done' ? (
        <div
          role="status"
          className={cn(
            'flex gap-2 rounded-lg border px-3 py-2.5 text-[13px]',
            check.match
              ? 'border-[var(--color-success)] bg-[var(--color-success-light)] text-[var(--color-text-primary)]'
              : 'border-[var(--color-danger)] bg-[var(--color-danger-light)] text-[var(--color-danger)]',
          )}
        >
          {check.match ? (
            <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" />
          ) : (
            <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>
            <span className="font-medium">«{check.name}»</span>{' '}
            {check.match
              ? 'энэ бүртгэлтэй яг таарч байна — үүсгэснээс хойш өөрчлөгдөөгүй.'
              : 'энэ бүртгэлтэй таарахгүй байна — файл өөрчлөгдсөн эсвэл өөр тайлан байна.'}
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** QR-ийн хаяг (/verify/<code>): бүртгэлийг харуулж, PDF-ийг хэшээр тулгана. */
export function StatementVerificationResult({ code: rawCode }: { code: string }) {
  const code = normalizeVerificationCode(decodeURIComponent(rawCode))
  const valid = VERIFICATION_CODE_PATTERN.test(code)
  const { data, isLoading, error } = useStatementVerification(valid ? code : '')
  const status = error instanceof AxiosError ? error.response?.status : undefined

  if (!valid || status === 404 || status === 422) {
    return (
      <Shell>
        <Card>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-[var(--color-danger)]" />
              <div>
                <p className="text-[15px] font-semibold text-text-primary">Бүртгэл олдсонгүй</p>
                <p className="mt-1 text-[13px] text-text-secondary">
                  {valid
                    ? `${formatVerificationCode(code)} кодтой тайлан TESO ITAM-д бүртгэгдээгүй байна. Кодоо шалгаад дахин оролдоно уу.`
                    : 'Код буруу хэлбэртэй байна — 16 тэмдэгт, жишээ нь ABCD-EFGH-JKMN-PQRS.'}
                </p>
              </div>
            </div>
            <CodeForm initial={valid ? formatVerificationCode(code) : ''} />
          </CardContent>
        </Card>
      </Shell>
    )
  }

  if (isLoading || !data) {
    return (
      <Shell>
        <Card>
          <CardContent className="flex items-center gap-2 text-[13px] text-text-secondary">
            {error ? (
              <>
                <ShieldAlert className="h-4 w-4 text-[var(--color-danger)]" />
                Шалгах үед алдаа гарлаа. Дахин оролдоно уу.
              </>
            ) : (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Бүртгэлийг шалгаж байна…
              </>
            )}
          </CardContent>
        </Card>
      </Shell>
    )
  }

  const rows: Array<[string, string]> = [
    ['Баталгаажуулах код', data.code],
    ['Гарчиг', data.title ?? '—'],
    ['Үүсгэсэн', formatVerifiedAt(data.generatedAt)],
    ['Хуудас', data.pageCount === null ? '—' : String(data.pageCount)],
    ['Мөр', data.rowCount === null ? '—' : data.rowCount.toLocaleString('en-US')],
  ]

  return (
    <Shell>
      <Card>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-[var(--color-success)]" />
            <div>
              <p className="text-[15px] font-semibold text-text-primary">TESO ITAM-д бүртгэлтэй тайлан</p>
              <p className="mt-1 text-[13px] text-text-secondary">Энэ кодтой тайланг TESO ITAM системд доорх үед үүсгэсэн.</p>
            </div>
          </div>
          <dl className="divide-y divide-border rounded-lg border border-border text-[13px]">
            {rows.map(([label, value]) => (
              <div key={label} className="flex gap-3 px-3 py-2">
                <dt className="w-40 shrink-0 text-text-secondary">{label}</dt>
                <dd className={cn('min-w-0 break-words text-text-primary', label === 'Баталгаажуулах код' && 'font-mono')}>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning-light)] px-3 py-2.5 text-[13px] text-text-primary">
            Энэ нь TESO ITAM-ын дотоод тайлан бөгөөд банк болон бусад байгууллагаас гаргасан албан ёсны баримт биш. Тайлангийн
            утгыг хэрэглэгчийн оруулсан Excel файлаас авсан бөгөөд систем тэдгээрийн үнэн зөвийг баталгаажуулахгүй.
          </p>
          {data.pdfSha256 ? <PdfCheck expected={data.pdfSha256} /> : null}
          <p className="text-[12px] text-text-secondary">
            Өөр код шалгах бол{' '}
            <Link href="/verify" className="text-accent underline-offset-2 hover:underline">
              энд дарна уу
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </Shell>
  )
}
