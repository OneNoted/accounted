'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { SettingsModal } from './SettingsModal'
import { isSheetSection, useSettingsNavItems } from './useSettingsNavItems'

/**
 * The settings sheet on a cold load. Interception is a soft-navigation feature:
 * refreshing on /settings, pasting a deep link, or opening one in a new tab all
 * bypass `(.)settings` and fall through to the slot's default, which used to
 * render nothing and left settings drawn as a plain page (no X, no slide).
 * Rendering the sheet here instead makes settings look and behave the same
 * however the user arrived.
 *
 * Only sections the sheet owns qualify; the rest of /settings keeps the legacy
 * page layout, so this must agree with the settings layout on which is which.
 * `isSheetSection` is the shared predicate.
 *
 * Nothing is mounted behind the sheet in this case (the section's page
 * component is a stub), so closing navigates to the dashboard rather than
 * popping a history entry that may not exist.
 */
export function ColdLoadSettingsSheet() {
  const pathname = usePathname()
  const { items } = useSettingsNavItems()
  const active = isSheetSection(pathname, items)

  // Latch, because closing to the dashboard navigates *before* the slide-down
  // has finished (so the dashboard is what the animation reveals). Re-reading
  // the pathname after that navigation would unmount the sheet mid-animation.
  // Once the sheet has closed it renders nothing, so leaving it mounted for the
  // rest of the visit is free; a later soft navigation to settings swaps this
  // whole slot to the intercepting route anyway.
  const [latched, setLatched] = useState(active)
  if (active && !latched) setLatched(true)

  if (!active && !latched) return null

  return <SettingsModal closeTo="home" />
}
