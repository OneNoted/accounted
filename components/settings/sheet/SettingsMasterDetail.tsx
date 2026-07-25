'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Search } from 'lucide-react'
import { useCompany } from '@/contexts/CompanyContext'
import { SettingsProvider } from '../useSettings'
import { SettingsRail } from '../SettingsRail'
import { SettingsLoadingSkeleton } from '../SettingsLoadingSkeleton'
import { useSettingsNavItems } from '../useSettingsNavItems'
import { SETTINGS_SECTIONS } from '../sections'
import { SETTINGS_SUBSECTIONS, type SheetSubsection } from './subsections'
import { SettingsAccordion } from './SettingsAccordion'
import { cn } from '@/lib/utils'

interface SettingsMasterDetailProps {
  /** 'sheet' = inside the routed settings sheet (shallow URL swaps);
   *  'page' = the full-page fallback route (real navigations). */
  variant: 'sheet' | 'page'
}

interface SearchEntry {
  sectionId: string
  href: string
  /** Subsection to open after navigating; null = whole section. */
  subId: string | null
  title: string
  context: string
  haystack: string
}

/**
 * The settings surface: underline search on top, the grouped section rail on
 * the left, and the active section's subsections as a direct-editing accordion
 * on the right. One master-detail view: clicking a section swaps the content
 * in place, there is no intermediate page and no preview.
 */
export function SettingsMasterDetail({ variant }: SettingsMasterDetailProps) {
  const t = useTranslations('settings_sheet')
  const router = useRouter()
  const pathname = usePathname()
  const { items, groups } = useSettingsNavItems()
  const { company, role, isSandbox } = useCompany()
  const subsectionContext = useMemo(
    () => ({
      isAktiebolag: company?.entity_type === 'aktiebolag',
      isSandbox,
      role: role ?? null,
    }),
    [company?.entity_type, isSandbox, role],
  )

  // Bare /settings (the interceptor's catch-all) defaults to Företag when the
  // user has a company, mirroring the old modal's default; account otherwise.
  const active =
    items.find((i) => pathname === i.href || pathname.startsWith(i.href + '/'))?.id ??
    items.find((i) => i.id === 'company')?.id ??
    items[0]?.id
  const activeItem = items.find((i) => i.id === active)

  // Open accordion panel, or null for none. A section always lands fully
  // collapsed: the header rows are the section's table of contents, and
  // auto-expanding the first one buries that under one panel's worth of fields.
  // Only an explicit act opens a panel: a click, 1-9, or a search hit, which
  // can request a panel in another section and is carried across the navigation
  // by pendingSubRef until the section actually changed.
  const [openSub, setOpenSub] = useState<string | null>(null)
  const pendingSubRef = useRef<string | null>(null)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setOpenSub(pendingSubRef.current)
    pendingSubRef.current = null
  }, [active])

  const subsections = useMemo(() => {
    const defs = SETTINGS_SUBSECTIONS[active ?? ''] ?? null
    if (!defs) return null
    const visible = defs.filter((d) => (d.show ? d.show(subsectionContext) : true))
    // Every panel hidden by visibility rules: fall back to the section's own
    // component rather than rendering an empty accordion.
    return visible.length > 0 ? visible : null
  }, [active, subsectionContext])

  // Keyboard: "/" focuses search from anywhere in the surface, 1-9 jumps to
  // the n:th subsection of the active section. Both ignore typing contexts.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const index = parseInt(e.key, 10) - 1
        const def = subsections?.[index]
        if (def) setOpenSub(def.id)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [subsections])

  function navigate(href: string, subId: string | null) {
    pendingSubRef.current = subId
    setQuery('')
    // Same-section hit: no navigation happens, so apply the panel directly.
    const target = items.find((i) => i.href === href)
    if (target?.id === active) {
      setOpenSub(subId)
      pendingSubRef.current = null
      if (variant === 'sheet') window.history.replaceState(null, '', href)
      return
    }
    // Shallow update inside the sheet (mirrors SettingsRail's modal variant);
    // a real navigation on the full page route.
    if (variant === 'sheet') window.history.replaceState(null, '', href)
    else router.push(href)
  }

  const searchIndex = useMemo<SearchEntry[]>(() => {
    const entries: SearchEntry[] = []
    for (const group of groups) {
      for (const item of group.items) {
        entries.push({
          sectionId: item.id,
          href: item.href,
          subId: null,
          title: item.label,
          context: group.label,
          haystack: `${item.label} ${group.label}`.toLowerCase(),
        })
        const defs = SETTINGS_SUBSECTIONS[item.id] ?? []
        for (const def of defs) {
          if (def.show && !def.show(subsectionContext)) continue
          const title = t(def.titleKey)
          entries.push({
            sectionId: item.id,
            href: item.href,
            subId: def.id,
            title,
            context: item.label,
            haystack: `${title} ${item.label} ${(def.keywords ?? []).join(' ')}`.toLowerCase(),
          })
        }
      }
    }
    return entries
  }, [groups, subsectionContext, t])

  const trimmedQuery = query.trim().toLowerCase()
  const hits = trimmedQuery
    ? searchIndex.filter((e) => e.haystack.includes(trimmedQuery))
    : []

  const FallbackSection = active ? SETTINGS_SECTIONS[active] : undefined

  return (
    <SettingsProvider>
      <div className="mx-auto w-full max-w-5xl px-5 py-8 md:px-8 md:py-10">
        {/* The X close button floats at the sheet's top right; keep the title
            row clear of it so the two never collide on narrow panels. */}
        <div className={cn('mb-6', variant === 'sheet' && 'pr-12')}>
          <h1 className="font-display text-2xl leading-8 tracking-tight">
            {t('title')}
          </h1>
        </div>

        {/* Underline search: no box, just a hairline that darkens on focus. */}
        <label className="flex items-center gap-3 border-b border-border pb-2 transition-colors duration-150 focus-within:border-foreground">
          <Search aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search_placeholder')}
            aria-label={t('search_placeholder')}
            className="h-9 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          <kbd className="hidden rounded border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground md:block">
            /
          </kbd>
        </label>

        {trimmedQuery ? (
          <div className="mt-6" role="list">
            {hits.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                {t('search_no_results', { query: query.trim() })}
              </p>
            ) : (
              hits.map((hit) => (
                <button
                  key={`${hit.sectionId}-${hit.subId ?? 'section'}`}
                  type="button"
                  role="listitem"
                  onClick={() => navigate(hit.href, hit.subId)}
                  className="flex min-h-12 w-full items-center gap-4 border-b border-border py-3 text-left transition-colors duration-150 hover:bg-secondary/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{hit.title}</span>
                    <span className="block text-xs text-muted-foreground">{hit.context}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t('search_open')} →
                  </span>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-8 md:flex-row md:gap-12">
            <aside className="shrink-0 md:w-56">
              <div className="mb-4 md:hidden">
                <SettingsRail
                  variant={variant === 'sheet' ? 'modal' : 'page'}
                  display="select"
                  activeId={active}
                />
              </div>
              <div className="hidden md:block">
                <SettingsRail
                  variant={variant === 'sheet' ? 'modal' : 'page'}
                  display="rail"
                  activeId={active}
                />
              </div>
            </aside>
            <div className="min-w-0 flex-1">
              {activeItem && (
                <h2 className="mb-4 font-display text-xl tracking-tight">
                  {activeItem.label}
                </h2>
              )}
              {subsections ? (
                <SettingsAccordion
                  sectionId={active ?? ''}
                  items={subsections.map((d: SheetSubsection) => ({
                    ...d,
                    title: t(d.titleKey),
                    help: d.helpKey ? t(d.helpKey) : undefined,
                    countLabel:
                      d.fieldCount != null
                        ? t('sub_count', { count: d.fieldCount })
                        : undefined,
                  }))}
                  openId={openSub}
                  onOpenChange={setOpenSub}
                />
              ) : FallbackSection ? (
                <Suspense fallback={<SettingsLoadingSkeleton />}>
                  <FallbackSection />
                </Suspense>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </SettingsProvider>
  )
}
