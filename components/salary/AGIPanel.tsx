'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCheck,
  Link2,
  Link2Off,
  Loader2,
  Lock,
  Send,
  ShieldAlert,
  Unlock,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface AGIPanelProps {
  salaryRunId: string
  /** Skatteverket arbetsgivare ID (12-digit) — formatted by parent. */
  arbetsgivare: string
  /** YYYYMM */
  period: string
  /** Already-cached run-level signals for showing what step we're at. */
  agiGeneratedAt?: string | null
  agiSubmittedAt?: string | null
  /** When true, write actions are hidden. */
  readOnly?: boolean
  /** Called after a state-changing action so parent can refresh. */
  onChange?: () => void
}

interface ConnectionStatus {
  connected: boolean
  expired?: boolean
  canRefresh?: boolean
  scope?: string
  expiresAt?: string
}

interface KontrollResult {
  kod: string
  status: 'ERROR' | 'WARNING'
  beskrivning: string
}

interface SubmissionState {
  status?: 'draft_saved' | 'draft_locked' | 'signed'
  signeringslank?: string
  kvittensnummer?: string
  tidpunkt?: string
  inlamningId?: string
}

const ENABLED_KEY = 'EXTENSION_DISABLED'

export function AGIPanel(props: AGIPanelProps) {
  const {
    salaryRunId,
    arbetsgivare,
    period,
    agiGeneratedAt,
    agiSubmittedAt,
    readOnly,
    onChange,
  } = props

  const [extensionDisabled, setExtensionDisabled] = useState(false)
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [submission, setSubmission] = useState<SubmissionState | null>(null)
  const [kontroller, setKontroller] = useState<KontrollResult[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/extensions/ext/skatteverket/status')
      if (res.status === 503) {
        const data = await res.json().catch(() => ({}))
        if (data?.code === ENABLED_KEY) {
          setExtensionDisabled(true)
          return
        }
      }
      if (res.ok) {
        setStatus(await res.json())
      }
    } catch {
      // ignore — UI shows the not-connected state
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSubmission = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/extensions/ext/skatteverket/agi/status?period=${period}`,
      )
      if (res.ok) {
        const json = await res.json()
        setSubmission(json.data ?? null)
      }
    } catch {
      // ignore
    }
  }, [period])

  useEffect(() => {
    fetchStatus()
    fetchSubmission()
  }, [fetchStatus, fetchSubmission])

  const handleConnect = () => {
    window.location.href = '/api/extensions/ext/skatteverket/authorize'
  }

  const handleValidate = async () => {
    setActionLoading('validate')
    setError(null)
    setSuccess(null)
    setKontroller([])
    try {
      const res = await fetch('/api/extensions/ext/skatteverket/agi/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salaryRunId }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || `Validering misslyckades (${res.status})`)
        return
      }
      const controls: KontrollResult[] = json.data?.kontrollresultat?.resultat ?? []
      setKontroller(controls)
      const errs = controls.filter(c => c.status === 'ERROR')
      if (errs.length === 0) setSuccess('Valideringen godkänd')
      else setError(`${errs.length} valideringsfel hittades`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte validera AGI')
    } finally {
      setActionLoading(null)
    }
  }

  const handleSaveDraft = async () => {
    setActionLoading('draft')
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/extensions/ext/skatteverket/agi/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salaryRunId }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || `Kunde inte spara utkast (${res.status})`)
        return
      }
      setSuccess('AGI-utkast sparat hos Skatteverket')
      await fetchSubmission()
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte spara utkast')
    } finally {
      setActionLoading(null)
    }
  }

  const handleLock = async () => {
    setActionLoading('lock')
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(
        `/api/extensions/ext/skatteverket/agi/lock?arbetsgivare=${encodeURIComponent(arbetsgivare)}&period=${period}`,
        { method: 'PUT' },
      )
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || `Kunde inte låsa AGI (${res.status})`)
        return
      }
      setSuccess('AGI låst — öppna signeringslänken för att signera med BankID.')
      await fetchSubmission()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte låsa AGI')
    } finally {
      setActionLoading(null)
    }
  }

  const handleUnlock = async () => {
    setActionLoading('unlock')
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(
        `/api/extensions/ext/skatteverket/agi/lock?arbetsgivare=${encodeURIComponent(arbetsgivare)}&period=${period}`,
        { method: 'DELETE' },
      )
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || `Kunde inte låsa upp (${res.status})`)
        return
      }
      setSuccess('AGI har låsts upp')
      await fetchSubmission()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte låsa upp')
    } finally {
      setActionLoading(null)
    }
  }

  const handleCheckSubmitted = async () => {
    setActionLoading('check')
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(
        `/api/extensions/ext/skatteverket/agi/submitted?arbetsgivare=${encodeURIComponent(arbetsgivare)}&period=${period}`,
      )
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || 'Kunde inte hämta inlämningsstatus')
        return
      }
      if (json.data?.kvittensnummer) {
        setSuccess('AGI har lämnats in')
      } else {
        setSuccess('Ingen inlämning hittades än för perioden')
      }
      await fetchSubmission()
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte kontrollera status')
    } finally {
      setActionLoading(null)
    }
  }

  // ── Render branches ─────────────────────────────────────────────

  if (extensionDisabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Arbetsgivardeklaration (AGI)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Skatteverket-integrationen är inaktiverad i denna miljö. Aktivera
              <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">SKATTEVERKET_ENABLED</code>
              för att skicka AGI direkt till Skatteverket.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Arbetsgivardeklaration (AGI)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Hämtar Skatteverket-status...
        </CardContent>
      </Card>
    )
  }

  if (!status?.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Arbetsgivardeklaration (AGI)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Anslut till Skatteverket med BankID för att skicka AGI direkt från {`gnubok`}.
          </p>
          {!readOnly && (
            <Button onClick={handleConnect}>
              <Link2 className="mr-2 h-4 w-4" />
              Anslut med BankID
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  const subState = submission?.status
  const isLocked = subState === 'draft_locked'
  const isSigned = subState === 'signed' || !!agiSubmittedAt

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>Arbetsgivardeklaration (AGI)</span>
          <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            Ansluten
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status summary */}
        <div className="space-y-1.5 text-sm">
          <StatusRow
            ok={!!agiGeneratedAt}
            okText={agiGeneratedAt ? `AGI-fil genererad ${new Date(agiGeneratedAt).toLocaleString('sv-SE')}` : ''}
            pendingText="AGI-fil har inte genererats ännu."
          />
          <StatusRow
            ok={isSigned}
            okText={
              submission?.kvittensnummer
                ? `Skickad till Skatteverket — kvittens ${submission.kvittensnummer}`
                : agiSubmittedAt
                  ? `Skickad till Skatteverket ${new Date(agiSubmittedAt).toLocaleString('sv-SE')}`
                  : 'Skickad'
            }
            pendingText={
              isLocked
                ? 'AGI låst — väntar på BankID-signatur.'
                : subState === 'draft_saved'
                  ? 'Utkast sparat hos Skatteverket. Lås och signera för att slutföra.'
                  : 'Inte skickad till Skatteverket ännu. Deadline: 12:e i månaden efter utbetalning.'
            }
          />
        </div>

        {submission?.signeringslank && isLocked && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/20">
            <p className="text-sm font-medium">Utkastet är låst och redo att signeras</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Öppna länken nedan och signera med BankID på Skatteverkets sida.
            </p>
            <a
              href={submission.signeringslank}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-amber-900 hover:underline dark:text-amber-200"
            >
              Öppna signeringslänk <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        )}

        {kontroller.length > 0 && (
          <div className="space-y-1 rounded-md border bg-muted/30 p-2.5">
            {kontroller.map((k, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 text-xs ${
                  k.status === 'ERROR' ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <span className="font-mono">{k.kod}</span> — {k.beskrivning}
                </span>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 p-2.5 text-sm text-destructive">
            <AlertCircle className="mr-1 inline h-3.5 w-3.5" />
            {error}
          </div>
        )}
        {success && !error && (
          <div className="rounded-md bg-emerald-50 p-2.5 text-sm text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300">
            <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
            {success}
          </div>
        )}

        {!readOnly && !isSigned && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleValidate}
              disabled={!!actionLoading}
            >
              {actionLoading === 'validate' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileCheck className="mr-1.5 h-3.5 w-3.5" />
              )}
              Validera
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveDraft}
              disabled={!!actionLoading || isLocked}
            >
              {actionLoading === 'draft' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              Spara utkast
            </Button>
            {!isLocked ? (
              <Button
                size="sm"
                onClick={handleLock}
                disabled={!!actionLoading || subState !== 'draft_saved'}
              >
                {actionLoading === 'lock' ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Lock className="mr-1.5 h-3.5 w-3.5" />
                )}
                Lås för signering
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={handleUnlock}
                disabled={!!actionLoading}
              >
                {actionLoading === 'unlock' ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Unlock className="mr-1.5 h-3.5 w-3.5" />
                )}
                Lås upp
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCheckSubmitted}
              disabled={!!actionLoading}
            >
              {actionLoading === 'check' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="mr-1.5 h-3.5 w-3.5" />
              )}
              Hämta status
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatusRow({
  ok,
  okText,
  pendingText,
}: {
  ok: boolean
  okText: string
  pendingText: string
}) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      ) : (
        <Link2Off className="h-4 w-4 text-muted-foreground" />
      )}
      <span className="text-muted-foreground">{ok ? okText : pendingText}</span>
    </div>
  )
}
