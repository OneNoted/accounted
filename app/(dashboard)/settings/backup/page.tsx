import { getTranslations } from 'next-intl/server'
import { BackupDownloadForm } from '@/components/settings/BackupDownloadForm'
import { getBranding } from '@/lib/branding/service'

export default async function BackupSettingsPage() {
  const t = await getTranslations('settings_backup')
  const { appName } = getBranding()
  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {t('heading')}
        </h2>
        <p className="text-sm text-muted-foreground max-w-prose">
          {t('intro', { appName: appName.toLowerCase() })}
        </p>
      </section>

      <BackupDownloadForm />
    </div>
  )
}
