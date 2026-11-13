import * as React from 'react'
import { cn } from '@/lib/utils'

export function Table(props: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table {...props} className={cn('w-full text-sm', props.className)} />
}

export function TableHeader(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} className={cn('', props.className)} />
}

export function TableBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} className={cn('', props.className)} />
}

export function TableRow(props: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props} className={cn('border-b border-[var(--color-border)]', props.className)} />
}

export function TableHead(props: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...props}
      className={cn(
        'h-9 px-4 text-center text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]',
        props.className,
      )}
    />
  )
}

export function TableCell(props: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...props} className={cn('px-4 py-3 text-center text-sm text-[var(--color-text-primary)]', props.className)} />
}
