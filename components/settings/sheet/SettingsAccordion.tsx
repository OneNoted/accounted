'use client'

import { Suspense } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SettingsLoadingSkeleton } from '../SettingsLoadingSkeleton'
import type { SheetSubsection } from './subsections'

interface SettingsAccordionProps {
  /** Section id, used to scope panel element ids for aria wiring. */
  sectionId: string
  /** Visible subsections in display order. */
  items: Array<SheetSubsection & { title: string; countLabel?: string }>
  /** Currently open subsection id (exactly one open at a time, or none). */
  openId: string | null
  onOpenChange: (id: string | null) => void
}

/**
 * The settings sheet's content layout (Dragspelet): every subsection of the
 * active section stays visible as a serif header row; exactly one is expanded
 * at a time and its content is editable in place. Closed panels unmount, so a
 * section with heavy subsections only pays for the one that is open.
 */
export function SettingsAccordion({ sectionId, items, openId, onOpenChange }: SettingsAccordionProps) {
  return (
    <div>
      {items.map((item) => {
        const open = item.id === openId
        const panelId = `settings-sub-${sectionId}-${item.id}`
        const Component = item.Component
        return (
          <div key={item.id} className="border-t border-border first:border-t-0">
            <button
              type="button"
              onClick={() => onOpenChange(open ? null : item.id)}
              aria-expanded={open}
              aria-controls={panelId}
              className="flex min-h-12 w-full items-center gap-3 py-3 text-left transition-colors duration-150 hover:text-foreground"
            >
              <ChevronRight
                aria-hidden
                className={cn(
                  'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none',
                  open && 'rotate-90',
                )}
              />
              <span className="font-display text-base tracking-tight">{item.title}</span>
              {item.countLabel && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {item.countLabel}
                </span>
              )}
            </button>
            {open && (
              <div
                id={panelId}
                role="region"
                aria-label={item.title}
                // Some reused subsection components carry their own legacy
                // top separator (border-t pt-8) for the stacked layout;
                // inside an accordion panel the header already separates, so
                // strip it off the panel's root element.
                className="pb-8 pl-7 animate-in fade-in duration-200 motion-reduce:animate-none [&>*:first-child]:!border-t-0 [&>*:first-child]:!pt-0"
              >
                <Suspense fallback={<SettingsLoadingSkeleton />}>
                  <Component />
                </Suspense>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
