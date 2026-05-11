'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { useCompany } from '@/contexts/CompanyContext'
import { formatDateLong } from '@/lib/utils'
import { Loader2, Plus, Trash2, Mail, Clock, Users } from 'lucide-react'

interface CompanyMemberItem {
  id: string
  user_id: string
  email: string
  role: string
  source: 'direct' | 'team'
  joined_at: string
  is_current_user: boolean
}

interface CompanyInvitation {
  id: string
  email: string
  role: string
  status: string
  expires_at: string
  created_at: string
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Ägare',
  admin: 'Admin',
  member: 'Medlem',
  viewer: 'Läsbehörighet',
}

export function CompanyMembersSection() {
  const { toast } = useToast()
  const { company } = useCompany()
  const [isLoading, setIsLoading] = useState(true)
  const [members, setMembers] = useState<CompanyMemberItem[]>([])
  const [invitations, setInvitations] = useState<CompanyInvitation[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('viewer')
  const [isSending, setIsSending] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [canInvite, setCanInvite] = useState(false)

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch('/api/company/members')
      const data = await res.json()
      if (res.ok) {
        setMembers(data.data.members)
        setInvitations(data.data.invitations)
        setCanInvite(data.data.canInvite)
      }
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return

    setIsSending(true)
    try {
      const res = await fetch('/api/company/members/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: inviteRole }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast({ title: data.error, variant: 'destructive' })
        return
      }

      if (data.data.inviteUrl) {
        console.log('[DEV] Company invite URL:', data.data.inviteUrl)
      }
      toast({
        title: 'Inbjudan skickad',
        description: data.data.inviteUrl
          ? 'Länk loggad i konsolen (F12)'
          : `E-post skickad till ${email}.`,
      })
      setInviteEmail('')
      setInviteRole('viewer')
      fetchMembers()
    } catch {
      toast({ title: 'Kunde inte skicka inbjudan.', variant: 'destructive' })
    } finally {
      setIsSending(false)
    }
  }

  const handleRemoveMember = async (memberId: string) => {
    setRemovingId(memberId)
    try {
      const res = await fetch(`/api/company/members/${memberId}`, { method: 'DELETE' })
      const data = await res.json()

      if (!res.ok) {
        toast({ title: data.error, variant: 'destructive' })
        return
      }

      toast({ title: 'Medlem borttagen' })
      fetchMembers()
    } catch {
      toast({ title: 'Kunde inte ta bort medlem.', variant: 'destructive' })
    } finally {
      setRemovingId(null)
    }
  }

  const handleRevokeInvite = async (inviteId: string) => {
    setRevokingId(inviteId)
    try {
      const res = await fetch(`/api/company/members/invite/${inviteId}`, { method: 'DELETE' })
      const data = await res.json()

      if (!res.ok) {
        toast({ title: data.error, variant: 'destructive' })
        return
      }

      toast({ title: 'Inbjudan återkallad' })
      fetchMembers()
    } catch {
      toast({ title: 'Kunde inte återkalla inbjudan.', variant: 'destructive' })
    } finally {
      setRevokingId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Invite form */}
      {canInvite && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bjud in till {company?.name}</CardTitle>
            <CardDescription>
              Personen får tillgång till enbart detta företag.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInvite} className="flex gap-3">
              <div className="flex-1">
                <Label htmlFor="company-invite-email" className="sr-only">E-postadress</Label>
                <Input
                  id="company-invite-email"
                  type="email"
                  placeholder="namn@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={isSending}
                  required
                />
              </div>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Läsbehörighet</SelectItem>
                  <SelectItem value="member">Medlem</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" disabled={isSending || !inviteEmail.trim()}>
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-1.5" />
                    Bjud in
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Members list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Medlemmar
          </CardTitle>
          <CardDescription>
            {members.length} {members.length === 1 ? 'medlem' : 'medlemmar'} i {company?.name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border/40">
            {members.map((member) => (
              <div key={member.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-full bg-muted/60 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-medium text-muted-foreground">
                      {member.email.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {member.email}
                      {member.is_current_user && (
                        <span className="text-muted-foreground font-normal ml-1">(du)</span>
                      )}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        {ROLE_LABELS[member.role] || member.role}
                      </span>
                      {member.source === 'team' && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          Team
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                {canInvite && !member.is_current_user && member.role !== 'owner' && member.source !== 'team' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemoveMember(member.id)}
                    disabled={removingId === member.id}
                  >
                    {removingId === member.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Väntande inbjudningar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border/40">
              {invitations.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-muted/60 flex items-center justify-center flex-shrink-0">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{inv.email}</p>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>
                          Går ut {formatDateLong(inv.expires_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {ROLE_LABELS[inv.role] || inv.role}
                    </Badge>
                    {canInvite && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRevokeInvite(inv.id)}
                        disabled={revokingId === inv.id}
                      >
                        {revokingId === inv.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
