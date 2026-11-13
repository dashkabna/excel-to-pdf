import * as React from 'react'
import { cn } from '@/lib/utils'

type SwitchProps = {
  checked: boolean
  onCheckedChange: (value: boolean) => void
  className?: string
  'aria-label'?: string
}

export function Switch({ checked, onCheckedChange, className, 'aria-label': ariaLabel }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onCheckedChange(checked ? false : true)}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full border p-0.5 transition-all duration-150',
        checked
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
          : 'border-[var(--color-border-strong)] bg-[var(--color-border)]',
        className,
      )}
    >
      <span
        className={cn(
          'h-5 w-5 rounded-full bg-white transition-transform duration-150',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  )
}
