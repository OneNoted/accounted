'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  ArrowRight,
  ArrowRightLeft,
  FileCheck,
  Landmark,
  MessageCircle,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useErrorToast } from '@/lib/hooks/use-error-toast'
import { ENABLED_EXTENSION_IDS } from '@/lib/extensions/_generated/enabled-extensions'
import { useCapability } from '@/contexts/CompanyContext'
import { CAPABILITY } from '@/lib/entitlements/keys'
import type { InitialSetupPath, InitialSetupState } from '@/types'

interface NewUserChecklistProps {
  initialState: InitialSetupState
  className?: string
  hasBookkeepingImported?: boolean
  hasBankConnected?: boolean
  hasSkatteverketConnected?: boolean
  hasAgentBuilt?: boolean
}

const pathIcons = {
  migration: ArrowRightLeft,
  bank: Landmark,
  fresh: Sparkles,
} as const

export default function NewUserChecklist({
  initialState,
  className,
  hasBookkeepingImported = false,
  hasBankConnected = false,
  hasSkatteverketConnected = false,
  hasAgentBuilt = false,
}: NewUserChecklistProps) {
  const t = useTranslations('initial_setup')
  const router = useRouter()
  const showError = useErrorToast()
  const hasAi = useCapability(CAPABILITY.ai)
  const [state, setState] = useState(initialState)
  const [saving, setSaving] = useState<InitialSetupPath | 'dismiss' | 'complete' | null>(null)

  const hasMigration = ENABLED_EXTENSION_IDS.has('arcim-migration')
  const hasBanking = ENABLED_EXTENSION_IDS.has('enable-banking')
  const hasSkatteverket = ENABLED_EXTENSION_IDS.has('skatteverket')

  const persist = async (
    body: Record<string, unknown>,
    pending: InitialSetupPath | 'dismiss' | 'complete',
  ): Promise<InitialSetupState | null> => {
    setSaving(pending)
    try {
      const response = await fetch('/api/onboarding/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        await showError(response, { context: 'settings' })
        return null
      }
      const payload = await response.json() as { data: InitialSetupState }
      setState(payload.data)
      return payload.data
    } catch (error) {
      await showError(error, { context: 'settings' })
      return null
    } finally {
      setSaving(null)
    }
  }

  useEffect(() => {
    const selectedPathComplete =
      (state.path === 'migration' && hasBookkeepingImported) ||
      (state.path === 'bank' && hasBankConnected)
    if (!state.completedAt && selectedPathComplete && saving === null) {
      void persist({ completed: true }, 'complete')
    }
  // persist intentionally stays out: its identity follows the toast hook and
  // would retrigger this completion sync after every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBankConnected, hasBookkeepingImported, saving, state.completedAt, state.path])

  if (state.dismissedAt || state.completedAt) return null

  const choosePath = async (path: InitialSetupPath) => {
    const updated = await persist({ path }, path)
    if (!updated || path === 'fresh') return
    if (path === 'migration') {
      router.push(hasMigration ? '/import?mode=migration' : '/import?mode=sie')
    } else {
      router.push(hasBanking ? '/import?mode=psd2' : '/import?mode=bank')
    }
  }

  if (!state.path) {
    return (
      <Card className={cn('border-foreground/20', className)}>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {(['migration', 'bank', 'fresh'] as const).map((path) => {
            const Icon = pathIcons[path]
            return (
              <button
                key={path}
                type="button"
                disabled={saving !== null}
                onClick={() => void choosePath(path)}
                className="group min-h-28 rounded-lg border border-border p-4 text-left transition-colors hover:border-foreground/40 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <Icon className="h-5 w-5" />
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="mt-4 text-sm font-medium">{t(`${path}_title`)}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t(`${path}_description`)}
                </p>
              </button>
            )
          })}
        </CardContent>
      </Card>
    )
  }

  const primaryHref = state.path === 'migration'
    ? (hasMigration ? '/import?mode=migration' : '/import?mode=sie')
    : (hasBanking ? '/import?mode=psd2' : '/import?mode=bank')
  const PrimaryIcon = pathIcons[state.path]

  return (
    <Card className={cn('border-foreground/20', className)}>
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-lg">{t(`${state.path}_selected_title`)}</CardTitle>
            <CardDescription className="mt-1">{t(`${state.path}_selected_description`)}</CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={saving !== null}
            onClick={() => void persist({ dismissed: true }, 'dismiss')}
          >
            {t('dismiss')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Button asChild>
          <Link href={primaryHref}>
            <PrimaryIcon className="mr-2 h-4 w-4" />
            {t(`${state.path}_action`)}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {hasSkatteverket && !hasSkatteverketConnected && (
            // The authorize endpoint redirects off-site to Skatteverket.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a href="/api/extensions/ext/skatteverket/authorize?return_to=/" className="inline-flex min-h-10 items-center hover:text-foreground">
              <FileCheck className="mr-2 h-4 w-4" />
              {t('optional_skatteverket')}
            </a>
          )}
          {!hasAgentBuilt && (
            <Link href={hasAi ? '/onboarding/agent' : '/settings/billing'} className="inline-flex min-h-10 items-center hover:text-foreground">
              <MessageCircle className="mr-2 h-4 w-4" />
              {t('optional_assistant')}
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
