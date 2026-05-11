'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Loader2, Trash2, Plus, ChevronDown, Download, Upload, Building2, Users, Globe } from 'lucide-react'
import { TEMPLATE_CATEGORY_LABELS } from '@/lib/bookkeeping/template-library'
import { useCanWrite } from '@/lib/hooks/use-can-write'
import type { BookingTemplateLibrary, BookingTemplateCategory, BookingTemplateLibraryLine } from '@/types'

const ENTITY_LABELS: Record<string, string> = {
  all: 'Alla',
  enskild_firma: 'Enskild firma',
  aktiebolag: 'Aktiebolag',
}

export function BookingTemplatesPanel() {
  const { toast } = useToast()
  const { canWrite } = useCanWrite()

  const [templates, setTemplates] = useState<BookingTemplateLibrary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/booking-templates')
      const json = await res.json()
      if (json.data) setTemplates(json.data)
    } catch {
      toast({ title: 'Kunde inte hämta mallar', variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch('/api/settings/booking-templates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        toast({ title: 'Kunde inte ta bort mall', variant: 'destructive' })
        return
      }
      setTemplates((prev) => prev.filter((t) => t.id !== id))
      toast({ title: 'Mall borttagen' })
    } finally {
      setDeletingId(null)
    }
  }

  async function handleExport() {
    try {
      const res = await fetch('/api/settings/booking-templates/export')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'bokforingsmallar.json'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast({ title: 'Kunde inte exportera mallar', variant: 'destructive' })
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const payload = JSON.parse(text)
      const res = await fetch('/api/settings/booking-templates/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) {
        toast({ title: 'Importfel', description: json.error || 'Kunde inte importera', variant: 'destructive' })
        return
      }
      toast({ title: 'Import klar', description: `${json.imported} mall(ar) importerade.` })
      fetchTemplates()
    } catch {
      toast({ title: 'Importfel', description: 'Ogiltig fil', variant: 'destructive' })
    } finally {
      // Reset input so same file can be imported again
      if (importRef.current) importRef.current.value = ''
    }
  }

  // Group templates by scope
  const systemTemplates = templates.filter((t) => t.is_system)
  const teamTemplates = templates.filter((t) => t.team_id && !t.is_system)
  const companyTemplates = templates.filter((t) => t.company_id && !t.is_system)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Bokföringsmallar</CardTitle>
            <CardDescription>
              Återanvändbara mallar för vanliga bokföringstransaktioner. Standardmallar visas för alla, egna mallar kan skapas och delas.
            </CardDescription>
          </div>
          {canWrite && (
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Exportera
              </Button>
              <Button variant="outline" size="sm" onClick={() => importRef.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Importera
              </Button>
              <input
                ref={importRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleImport}
              />
              <Dialog open={showCreate} onOpenChange={setShowCreate}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Ny mall
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Skapa bokföringsmall</DialogTitle>
                  </DialogHeader>
                  <CreateTemplateForm
                    onCreated={() => {
                      setShowCreate(false)
                      fetchTemplates()
                    }}
                  />
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            Inga mallar hittades.
          </p>
        ) : (
          <div className="space-y-6">
            {/* System templates */}
            {systemTemplates.length > 0 && (
              <TemplateSection
                title="Standardmallar"
                icon={Globe}
                templates={systemTemplates}
                expandedId={expandedId}
                onToggle={setExpandedId}
                deletingId={deletingId}
                onDelete={handleDelete}
                canDelete={false}
              />
            )}

            {/* Team templates */}
            {teamTemplates.length > 0 && (
              <TemplateSection
                title="Teammallar"
                icon={Users}
                templates={teamTemplates}
                expandedId={expandedId}
                onToggle={setExpandedId}
                deletingId={deletingId}
                onDelete={handleDelete}
                canDelete={canWrite}
              />
            )}

            {/* Company templates */}
            {companyTemplates.length > 0 && (
              <TemplateSection
                title="Företagsmallar"
                icon={Building2}
                templates={companyTemplates}
                expandedId={expandedId}
                onToggle={setExpandedId}
                deletingId={deletingId}
                onDelete={handleDelete}
                canDelete={canWrite}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TemplateSection({
  title,
  icon: Icon,
  templates,
  expandedId,
  onToggle,
  deletingId,
  onDelete,
  canDelete,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  templates: BookingTemplateLibrary[]
  expandedId: string | null
  onToggle: (id: string | null) => void
  deletingId: string | null
  onDelete: (id: string) => void
  canDelete: boolean
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">{title}</h3>
        <Badge variant="secondary" className="text-xs">{templates.length}</Badge>
      </div>
      <div className="space-y-1">
        {templates.map((t) => {
          const isExpanded = expandedId === t.id
          return (
            <div
              key={t.id}
              className="rounded-lg border"
            >
              <button
                type="button"
                onClick={() => onToggle(isExpanded ? null : t.id)}
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/50 transition-colors"
              >
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{t.name}</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {TEMPLATE_CATEGORY_LABELS[t.category]}
                    </Badge>
                    {t.entity_type !== 'all' && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {ENTITY_LABELS[t.entity_type]}
                      </Badge>
                    )}
                  </div>
                </div>
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(t.id)
                    }}
                    disabled={deletingId === t.id}
                    className="h-8 w-8 p-0 shrink-0"
                  >
                    {deletingId === t.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
              </button>
              {isExpanded && (
                <div className="px-3 pb-3 pt-0">
                  {t.description && (
                    <p className="text-xs text-muted-foreground mb-2">{t.description}</p>
                  )}
                  <table className="w-full text-xs">
                    <thead className="[&_th]:font-medium [&_th]:text-[11px] [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                      <tr className="border-b">
                        <th className="text-left py-1 w-14">Konto</th>
                        <th className="text-left py-1">Beskrivning</th>
                        <th className="text-center py-1 w-16">Typ</th>
                        <th className="text-right py-1 w-12">Debet</th>
                        <th className="text-right py-1 w-12">Kredit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.lines.map((line: BookingTemplateLibraryLine, i: number) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-1 font-mono">{line.account}</td>
                          <td className="py-1">{line.label}</td>
                          <td className="py-1 text-center">
                            {line.type === 'vat' && line.vat_rate
                              ? `Moms ${(line.vat_rate * 100).toFixed(0)}%`
                              : line.type === 'settlement' ? 'Betalning' : 'Kostnad/Intäkt'}
                          </td>
                          <td className="py-1 text-right">{line.side === 'debit' ? 'D' : ''}</td>
                          <td className="py-1 text-right">{line.side === 'credit' ? 'K' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CreateTemplateForm({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<BookingTemplateCategory>('other')
  const [entityType, setEntityType] = useState<'all' | 'enskild_firma' | 'aktiebolag'>('all')
  const [lines, setLines] = useState<BookingTemplateLibraryLine[]>([
    { account: '', label: '', side: 'debit', type: 'business', ratio: 1 },
    { account: '', label: '', side: 'credit', type: 'settlement', ratio: 1 },
  ])

  function updateLine(index: number, field: keyof BookingTemplateLibraryLine, value: string | number) {
    setLines((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }

  function addLine() {
    setLines((prev) => [...prev, { account: '', label: '', side: 'debit', type: 'business', ratio: 1 }])
  }

  function removeLine(index: number) {
    if (lines.length <= 2) return
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name || lines.some((l) => !l.account || !l.label)) {
      toast({ title: 'Fyll i alla fält', variant: 'destructive' })
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch('/api/settings/booking-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, category, entity_type: entityType, lines }),
      })
      if (!res.ok) {
        const json = await res.json()
        toast({ title: json.error || 'Kunde inte skapa mall', variant: 'destructive' })
        return
      }
      toast({ title: 'Mall skapad' })
      onCreated()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label>Namn</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="T.ex. Inköp EU-varor" />
      </div>
      <div>
        <Label>Beskrivning <span className="text-muted-foreground font-normal">(valfritt)</span></Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="När ska denna mall användas?" rows={2} className="resize-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Kategori</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as BookingTemplateCategory)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(TEMPLATE_CATEGORY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Företagstyp</Label>
          <Select value={entityType} onValueChange={(v) => setEntityType(v as typeof entityType)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(ENTITY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label>Rader</Label>
        <div className="space-y-2 mt-1">
          {lines.map((line, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={line.account}
                onChange={(e) => updateLine(i, 'account', e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Konto"
                className="w-20 font-mono"
                maxLength={4}
              />
              <Input
                value={line.label}
                onChange={(e) => updateLine(i, 'label', e.target.value)}
                placeholder="Beskrivning"
                className="flex-1"
              />
              <Select value={line.side} onValueChange={(v) => updateLine(i, 'side', v)}>
                <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="debit">Debet</SelectItem>
                  <SelectItem value="credit">Kredit</SelectItem>
                </SelectContent>
              </Select>
              <Select value={line.type} onValueChange={(v) => updateLine(i, 'type', v)}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="business">Kostnad</SelectItem>
                  <SelectItem value="vat">Moms</SelectItem>
                  <SelectItem value="settlement">Betalning</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeLine(i)}
                disabled={lines.length <= 2}
                className="h-8 w-8 p-0 shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus className="h-3 w-3 mr-1" />
            Lägg till rad
          </Button>
        </div>
      </div>

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Skapa mall
      </Button>
    </form>
  )
}
