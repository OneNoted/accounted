'use client'

import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * The settings sheet's field layout, matching the converged prototype: label
 * (with optional help text) on the left, a compact control right-aligned on
 * the same line. Wide content (textareas, tables, uploads) uses the stacked
 * variant instead: label above, control full width.
 */
interface SettingsFieldRowProps {
  label: React.ReactNode
  htmlFor?: string
  /** Help text rendered under the label, left column. */
  description?: React.ReactNode
  /** Stack label above a full-width control (textareas, tables, uploads). */
  stacked?: boolean
  className?: string
  children: React.ReactNode
}

export function SettingsFieldRow({
  label,
  htmlFor,
  description,
  stacked = false,
  className,
  children,
}: SettingsFieldRowProps) {
  if (stacked) {
    return (
      <div className={cn('space-y-2 py-2', className)}>
        <div>
          <Label htmlFor={htmlFor} className="text-sm font-normal">
            {label}
          </Label>
          {description && (
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {children}
      </div>
    )
  }

  return (
    <div className={cn('flex min-h-10 items-start justify-between gap-6 py-2', className)}>
      <div className="min-w-0 max-w-[55%] pt-2">
        <Label htmlFor={htmlFor} className="text-sm font-normal">
          {label}
        </Label>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center pt-1">{children}</div>
    </div>
  )
}

/** Compact select styling for settings rows (native select, right-aligned). */
export const settingsSelectClassName =
  'flex h-9 rounded-lg border border-input bg-background px-3 py-1 text-sm ' +
  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-ring focus-visible:ring-offset-2'

/** Compact input styling for settings rows (pair with width utilities). */
export const settingsInputClassName = 'h-9 rounded-lg'
