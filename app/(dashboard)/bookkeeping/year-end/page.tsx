import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Lock } from 'lucide-react'
import { SupportLink } from '@/components/ui/support-link'

export default function YearEndPage() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl md:text-3xl font-medium tracking-tight">Årsbokslut</h1>
        <Button variant="outline" asChild>
          <Link href="/bookkeeping">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Bokföring
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mb-4">
            <Lock className="h-7 w-7 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Kommer snart</h2>
          <p className="text-muted-foreground max-w-md">
            Årsbokslut är under utveckling och kommer att finnas tillgängligt i en kommande version.
          </p>
          <div className="mt-4">
            <SupportLink variant="muted" subject="Fråga om årsbokslut">
              Behöver du hjälp med bokslut? Kontakta oss
            </SupportLink>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
