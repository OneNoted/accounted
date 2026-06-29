import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Abonnemang' }

// What the paid tier unlocks (mirrors lib/entitlements PAID_CAPABILITIES).
const INCLUDED = [
  'AI-assistent: chatt, kategorisering och dokumenttolkning',
  'Bankkoppling och automatisk synk (PSD2)',
  'Skatteverket: moms- och AGI-inlämning',
  'E-postutskick av fakturor, påminnelser och lönebesked',
]

// Free for everyone — reassures users that the core ledger is never withheld.
const ALWAYS_FREE = 'All bokföring, fakturering, rapporter, SIE-export, org.nr-uppslag och momsnummerkontroll ingår alltid utan kostnad.'

/**
 * Upgrade / subscription page — the destination every "Uppgradera" affordance
 * points to. v1 is intentionally minimal: it states the offer and routes to
 * checkout. The CTA uses a Stripe Payment Link (NEXT_PUBLIC_STRIPE_PAYMENT_LINK)
 * until the automated checkout route lands; without it, it degrades to a
 * clearly-labelled "coming soon" rather than a dead button.
 */
export default function BillingPage() {
  const paymentLink = process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl tracking-tight mb-1">Abonnemang</h1>
      <p className="text-muted-foreground mb-6">
        Lås upp AI-assistenten, bankkoppling, Skatteverket-inlämning och
        e-postutskick.
      </p>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl tracking-tight">199 kr</span>
          <span className="text-muted-foreground">/ månad</span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          eller 1&nbsp;999 kr per år (två månader gratis).
        </p>

        <ul className="mt-5 space-y-2.5">
          {INCLUDED.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-sm">
              <Check className="h-4 w-4 mt-0.5 shrink-0 text-foreground" />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6">
          {paymentLink ? (
            <Button size="lg" asChild className="w-full sm:w-auto">
              <a href={paymentLink}>Uppgradera</a>
            </Button>
          ) : (
            <Button size="lg" disabled className="w-full sm:w-auto">
              Uppgradering öppnar snart
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-4 leading-relaxed">{ALWAYS_FREE}</p>
    </div>
  )
}
