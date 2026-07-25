'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { SettingsMasterDetail } from './sheet/SettingsMasterDetail'

/** Exit duration. Must stay in sync with the `data-[state=closed]` duration on
 *  the sheet: the history entry is popped when the slide-down has finished. */
const SHEET_CLOSE_MS = 300

/**
 * The settings sheet: the one presentation of settings. It slides up from the
 * bottom and fills exactly the main panel area (the sidebar and the frame stay
 * visible), with an X top right, and slides back down on close.
 *
 * Two routes render it, and the difference is only where closing leads:
 * - The intercepting route (`@settingsModal/(.)settings/[[...section]]`) on
 *   in-app soft navigation. The page the user came from is still mounted in the
 *   `children` slot behind the sheet, so closing pops the history entry that
 *   opened it and lands back on that page.
 * - `@settingsModal/default.tsx` on hard load / refresh / deep link, where the
 *   interceptor never fires. Nothing is mounted underneath, so closing goes to
 *   the dashboard (`closeTo="home"`).
 *
 * It is deliberately non-modal and does not dismiss on outside clicks: the
 * sidebar stays live underneath, so the account popover and the company
 * switcher work with settings up. Three things close it: the X, Esc, and
 * navigating away (a sidebar link), which the derived `open` picks up.
 *
 * The active section is derived from the pathname inside SettingsMasterDetail
 * (tab clicks swap the URL shallowly); the sectionId route param only exists
 * for the intercepting route's contract.
 */
export function SettingsModal({
  sectionId: _sectionId,
  closeTo = 'back',
}: {
  sectionId?: string
  /** 'back' pops the history entry that opened the sheet; 'home' navigates to
   *  the dashboard, for the cold-load case where there is no such entry. */
  closeTo?: 'back' | 'home'
}) {
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations('settings_sheet')
  // Portal into the dashboard shell so the sheet geometry can read the
  // --nav-w custom property (sidebar width, incl. collapsed state) that is
  // defined on #dash-shell. Falls back to <body> before mount.
  const [container, setContainer] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setContainer(document.getElementById('dash-shell'))
  }, [])

  // Open is controlled, not hardcoded. The slot mounts open; closing flips this
  // to false first so Radix renders data-state="closed" and the slide-down
  // actually plays. Popping the history entry straight from onOpenChange (as
  // this used to) unmounted the slot on the same tick, so the sheet vanished
  // instead of sliding out.
  const [dismissed, setDismissed] = useState(false)

  // Leaving /settings closes the sheet too: a sidebar link, or a cross-link
  // inside the sheet like "Kontoplan". Next.js can keep the intercepted slot
  // mounted over the new page, so without this the sheet would sit stranded on
  // top of it. Deriving it rather than syncing in an effect means Radix sees a
  // plain true -> false flip and runs the same exit animation as the X.
  const open = !dismissed && pathname.startsWith('/settings')

  // Cold load: the dashboard is where closing leads but nothing has fetched it
  // yet, so warm it while the user is in settings and the reveal is immediate.
  useEffect(() => {
    if (closeTo === 'home') router.prefetch('/')
  }, [closeTo, router])

  function onOpenChange(next: boolean) {
    // `open` doubles as the re-entrancy guard: false already means closing.
    if (next || !open) return
    setDismissed(true)
    if (closeTo === 'home') {
      // Nothing is mounted behind a cold-loaded sheet, so navigate immediately:
      // the dashboard paints behind while the sheet is still sliding down, and
      // the animation reveals it instead of an empty panel. ColdLoadSettingsSheet
      // keeps this mounted across that navigation.
      router.push('/')
      return
    }
    // The page underneath is already mounted, so wait: popping the history
    // entry unmounts this slot and would cut the animation short. Reduced
    // motion has no animation to wait for.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.setTimeout(() => router.back(), reduced ? 0 : SHEET_CLOSE_MS)
  }

  return (
    // Non-modal: the sidebar is not "outside a dialog" here, it is the app's
    // chrome and stays fully usable with the sheet up. Modal would put
    // pointer-events: none on everything else, so the account popover at the
    // bottom left could not open and a nav link could not be followed.
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal container={container ?? undefined}>
        {/* No veil: the sheet covers the panel exactly; sidebar and frame stay
            visible and untinted. */}
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          // Clicking outside does not dismiss. The sheet closes on the X, on
          // Esc, or by navigating away (which `open` above picks up), so
          // opening the account popover or the company switcher leaves it be.
          onInteractOutside={(e) => e.preventDefault()}
          className={
            'fixed inset-0 z-50 flex flex-col overflow-hidden bg-background focus:outline-none ' +
            'md:inset-auto md:bottom-[10px] md:left-[var(--nav-w,248px)] md:right-[10px] md:top-[10px] ' +
            'md:rounded-xl md:border md:border-border ' +
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=open]:duration-[420ms] ' +
            'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=closed]:duration-300 ' +
            'ease-[cubic-bezier(0.32,0.72,0.28,1)] motion-reduce:animate-none'
          }
        >
          <DialogPrimitive.Title className="sr-only">{t('title')}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {t('description')}
          </DialogPrimitive.Description>
          <DialogPrimitive.Close
            aria-label={t('close')}
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors duration-150 hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden />
          </DialogPrimitive.Close>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SettingsMasterDetail variant="sheet" />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
