'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { Loader2, Trash2, Users, ChevronDown } from 'lucide-react'
import { formatAccountWithName } from '@/lib/bookkeeping/client-account-names'
import { formatCounterpartyName } from '@/lib/bookkeeping/counterparty-templates'
import type { CategorizationTemplate } from '@/types'

const SOURCE_LABELS: Record<string, string> = {
  sie_import: 'SIE-import',
  user_approved: 'Godkänd',
  auto_learned: 'Automatisk',
  sni_default: 'Standard',
}

const VAT_LABELS: Record<string, string> = {
  standard_25: '25%',
  reduced_12: '12%',
  reduced_6: '6%',
  reverse_charge: 'Omvänd',
  export: 'Export',
  exempt: 'Momsfri',
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('sv-SE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return 'text-emerald-600 dark:text-emerald-400'
  if (c >= 0.5) return 'text-amber-600 dark:text-amber-400'
  return 'text-muted-foreground'
}

export function CounterpartyTemplatesPanel() {
  const { toast } = useToast()

  const [templates, setTemplates] = useState<CategorizationTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/counterparty-templates')
      const json = await res.json()
      if (json.data) {
        setTemplates(json.data)
      }
    } catch {
      toast({ title: 'Kunde inte hämta mallar', variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch('/api/settings/counterparty-templates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        toast({ title: 'Kunde inte ta bort mall', variant: 'destructive' })
        return
      }
      setTemplates((prev) => prev.filter((t) => t.id !== id))
      if (expandedId === id) setExpandedId(null)
      toast({ title: 'Mall borttagen' })
    } catch {
      toast({ title: 'Kunde inte ta bort mall', variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Bokföringsmallar</CardTitle>
          <CardDescription>
            Inlärda mönster som automatiskt föreslår kontering baserat på motpart.
            Mallar skapas från SIE-import och när du godkänner kategoriseringar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Users className="h-8 w-8 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">Inga mallar ännu.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Mallar skapas automatiskt när du kategoriserar transaktioner eller importerar en SIE-fil.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {templates.map((t) => {
                const isExpanded = expandedId === t.id
                const isMultiLine = t.line_pattern && t.line_pattern.length > 0

                return (
                  <div key={t.id} className="rounded-md border overflow-hidden">
                    {/* Clickable summary row */}
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : t.id)}
                      className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{formatCounterpartyName(t.counterparty_name)}</p>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {SOURCE_LABELS[t.source] || t.source}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                          {isMultiLine ? (
                            <span className="font-mono">
                              {t.line_pattern!.filter(lp => lp.type === 'business').map(lp => lp.account).join(', ')}
                            </span>
                          ) : (
                            <>
                              <span className="font-mono">{t.debit_account}</span>
                              <span className="text-muted-foreground/50">→</span>
                              <span className="font-mono">{t.credit_account}</span>
                            </>
                          )}
                          {t.vat_treatment && (
                            <>
                              <span className="text-muted-foreground/30">·</span>
                              <span>{VAT_LABELS[t.vat_treatment] || t.vat_treatment}</span>
                            </>
                          )}
                          <span className="text-muted-foreground/30">·</span>
                          <span>{t.occurrence_count} ggr</span>
                          <span className={`tabular-nums ${confidenceColor(Number(t.confidence))}`}>
                            {Math.round(Number(t.confidence) * 100)}%
                          </span>
                        </div>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t bg-muted/30 px-4 py-3 space-y-3">
                        {/* Account lines */}
                        <div>
                          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Kontering</p>
                          {isMultiLine ? (
                            <div className="space-y-1">
                              {t.line_pattern!.map((lp, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs">
                                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 w-14 justify-center">
                                    {lp.side === 'debit' ? 'Debet' : 'Kredit'}
                                  </Badge>
                                  <span className="font-mono">{formatAccountWithName(lp.account)}</span>
                                  {lp.type === 'vat' && lp.vat_rate && (
                                    <span className="text-muted-foreground">({Math.round(lp.vat_rate * 100)}% moms)</span>
                                  )}
                                  {lp.ratio !== undefined && (
                                    <span className="text-muted-foreground">({Math.round(lp.ratio * 100)}%)</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-xs">
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 w-14 justify-center">Debet</Badge>
                                <span className="font-mono">{formatAccountWithName(t.debit_account)}</span>
                              </div>
                              <div className="flex items-center gap-2 text-xs">
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 w-14 justify-center">Kredit</Badge>
                                <span className="font-mono">{formatAccountWithName(t.credit_account)}</span>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Metadata */}
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                          {t.vat_treatment && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Moms</span>
                              <span>{VAT_LABELS[t.vat_treatment] || t.vat_treatment}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Antal bokföringar</span>
                            <span className="tabular-nums">{t.occurrence_count}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Säkerhet</span>
                            <span className={`tabular-nums ${confidenceColor(Number(t.confidence))}`}>
                              {Math.round(Number(t.confidence) * 100)}%
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Senast använd</span>
                            <span>{formatDate(t.last_seen_date)}</span>
                          </div>
                          {t.counterparty_aliases && t.counterparty_aliases.length > 1 && (
                            <div className="col-span-2 flex justify-between">
                              <span className="text-muted-foreground">Alias</span>
                              <span className="text-right truncate ml-4">{t.counterparty_aliases.slice(0, 3).join(', ')}{t.counterparty_aliases.length > 3 ? ` +${t.counterparty_aliases.length - 3}` : ''}</span>
                            </div>
                          )}
                        </div>

                        {/* Delete */}
                        <div className="flex justify-end pt-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(t.id)}
                            disabled={deletingId === t.id}
                            className="text-destructive hover:text-destructive text-xs h-7"
                          >
                            {deletingId === t.id ? (
                              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="mr-1.5 h-3 w-3" />
                            )}
                            Ta bort mall
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
