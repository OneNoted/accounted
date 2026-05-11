'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'

export default function SalarySettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Löneinställningar" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bokföring</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Standard verifikationsserie för löner</label>
            <select className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm" defaultValue="A">
              <option value="A">A — Standard</option>
              <option value="L">L — Löner</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Kan ändras per lönekörning. Varje serie har obrutna verifikationsnummer per räkenskapsår.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Semester</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Standard semesterregel</label>
            <select className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm" defaultValue="procentregeln">
              <option value="procentregeln">Procentregeln (12%)</option>
              <option value="sammaloneregeln">Sammalöneregeln</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Semestertillägg</label>
            <select className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm" defaultValue="0.0043">
              <option value="0.0043">0,43% (lagstadgat minimum)</option>
              <option value="0.008">0,80% (vanligt kollektivavtalsbelopp)</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Tillämpas vid sammalöneregeln. Kan ändras per anställd.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-2">
            <p>Lönemodulen hanterar löner för aktiebolag. Enskild firma-ägare använder eget uttag istället.</p>
            <p>Arbetsgivaravgifter och skattetabeller uppdateras årligen baserat på Skatteverkets publiceringar.</p>
            <p>
              <strong>Aktuellt år:</strong> 2026 — Arbetsgivaravgifter 31,42%, prisbasbelopp 59 200 SEK
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
