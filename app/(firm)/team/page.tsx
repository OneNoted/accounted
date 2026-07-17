import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Users } from 'lucide-react'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

export const dynamic = 'force-dynamic'

const ROLE_KEYS: Record<string, string> = {
  owner: 'team.role.owner',
  admin: 'team.role.admin',
  member: 'team.role.member',
}

/**
 * Firm-altitude team roster (read-only). The nav/IA direction relocates team
 * management from /settings/team to the firm altitude; this page is that
 * destination. Invitation management arrives when team invites are
 * re-enabled (they are deliberately disabled today: "teams are single-user",
 * membership flows via per-company invitations).
 */
export default async function FirmTeamPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const t = await getTranslations('bureau')
  const service = createServiceClient()

  // Same resolution as GET /api/team/members, ordered for determinism.
  const { data: membership } = await service
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!membership) {
    return (
      <div className="space-y-8">
        <PageHeader title={t('nav.team')} />
        <Card>
          <CardContent className="p-0">
            <EmptyState icon={Users} title={t('team.empty_title')} description={t('team.empty_description')} />
          </CardContent>
        </Card>
      </div>
    )
  }

  const [{ data: team }, { data: members }] = await Promise.all([
    service.from('teams').select('name').eq('id', membership.team_id).maybeSingle(),
    service
      .from('team_members')
      .select('id, user_id, role, joined_at')
      .eq('team_id', membership.team_id)
      .order('joined_at', { ascending: true }),
  ])

  const userIds = (members ?? []).map((m) => m.user_id)
  const { data: profiles } = userIds.length
    ? await service.from('profiles').select('id, email').in('id', userIds)
    : { data: [] as { id: string; email: string | null }[] }
  const emailById = new Map((profiles ?? []).map((p) => [p.id, p.email]))

  return (
    <div className="space-y-8">
      <PageHeader title={t('nav.team')} description={team?.name ?? undefined} />
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {(members ?? []).map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-4 px-6 py-4">
                <div className="min-w-0">
                  <p className="text-sm truncate">
                    {emailById.get(member.user_id) || member.user_id}
                    {member.user_id === user.id && (
                      <span className="text-muted-foreground"> · {t('team.you')}</span>
                    )}
                  </p>
                </div>
                <Badge variant="secondary">
                  {t(ROLE_KEYS[member.role] ?? 'team.role.member')}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">{t('team.invites_disabled')}</p>
    </div>
  )
}
