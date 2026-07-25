'use client'

import { Label } from '@/components/ui/label'
import { HelpPopover } from '@/components/ui/help-popover'
import { cn } from '@/lib/utils'

/**
 * The settings sheet's field layout, matching the converged prototype: label
 * (with optional help text) on the left, a compact control right-aligned on
 * the same line. Wide content (textareas, tables, uploads) uses the stacked
 * variant instead: label above, control full width.
 *
 * Two help slots, and which one a string belongs in is a length question
 * (UI-migration convention 7: no instructional copy in the page flow):
 * - `description`: one scannable line answering "what is this field". Anything
 *   that wraps past a line belongs in `help` instead.
 * - `help`: the paragraph. Rendered behind a "?" next to the label, so the
 *   regulatory detail is one click away instead of pushing every other field
 *   down the panel.
 *
 * Neither is the place for something the user must read before acting: a
 * warning that only appears when it applies stays visible in the flow.
 */
interface SettingsFieldRowProps {
  label: React.ReactNode
  htmlFor?: string
  /** One-line help under the label, left column. */
  description?: React.ReactNode
  /** Longer explanation, behind a "?" beside the label. */
  help?: React.ReactNode
  /** Stack label above a full-width control (textareas, tables, uploads). */
  stacked?: boolean
  className?: string
  children: React.ReactNode
}

function FieldLabel({
  label,
  htmlFor,
  description,
  help,
}: Pick<SettingsFieldRowProps, 'label' | 'htmlFor' | 'description' | 'help'>) {
  return (
    <>
      <span className="flex items-center gap-1.5">
        <Label htmlFor={htmlFor} className="text-sm font-normal">
          {label}
        </Label>
        {help && <HelpPopover>{help}</HelpPopover>}
      </span>
      {description && (
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      )}
    </>
  )
}

export function SettingsFieldRow({
  label,
  htmlFor,
  description,
  help,
  stacked = false,
  className,
  children,
}: SettingsFieldRowProps) {
  if (stacked) {
    return (
      <div className={cn('space-y-2 py-2', className)}>
        <div>
          <FieldLabel label={label} htmlFor={htmlFor} description={description} help={help} />
        </div>
        {children}
      </div>
    )
  }

  return (
    <div className={cn('flex min-h-10 items-start justify-between gap-6 py-2', className)}>
      <div className="min-w-0 max-w-[55%] pt-2">
        <FieldLabel label={label} htmlFor={htmlFor} description={description} help={help} />
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
