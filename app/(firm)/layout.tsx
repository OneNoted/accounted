import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getActiveCompanyId, getCompanyDisplayName } from '@/lib/company/context'
import { BrandWordmark } from '@/components/branding/BrandWordmark'
import { FirmNav } from '@/components/bureau/FirmNav'

/**
 * Firm-altitude shell: the level ABOVE a single company. Deliberately has no
 * company sidebar and no company switcher: at this altitude the user is not
 * "in" a company, and entering one (via the roster's Öppna button) drops them
 * down into the normal per-company dashboard shell.
 *
 * This layout is the seed of the full firm dashboard: workflow runs,
 * team/firm management, and firm settings land here as siblings of
 * /companies when they arrive. Keep it thin until they do.
 */
export default async function FirmLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Sandbox hides the firm plane entirely.
  const activeCompanyId = await getActiveCompanyId(supabase, user.id)
  let activeCompanyName: string | null = null
  if (activeCompanyId) {
    const { data: settings } = await supabase
      .from('company_settings')
      .select('is_sandbox')
      .eq('company_id', activeCompanyId)
      .maybeSingle()
    if (settings?.is_sandbox) redirect('/')
    activeCompanyName = await getCompanyDisplayName(supabase, activeCompanyId)
  }

  const t = await getTranslations('bureau')

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-5 md:px-8">
          <div className="h-14 flex items-center justify-between">
            <BrandWordmark size="inline" />
            {activeCompanyName && (
              <Link
                href="/"
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors duration-150"
              >
                {t('back_to_company', { name: activeCompanyName })}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            )}
          </div>
          <FirmNav />
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-5 py-8 md:px-8 md:py-10">{children}</main>
    </div>
  )
}
