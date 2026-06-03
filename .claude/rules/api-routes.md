---
paths:
  - "app/api/**"
---

# API Route Pattern

Use the `/erp-api-route` skill when scaffolding new endpoints.

```typescript
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/init'
import { validateBody } from '@/lib/api/validate'
import { MySchema } from '@/lib/api/schemas'

ensureInitialized()  // Module-level — loads extensions for event emission

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await validateBody(request, MySchema)
  if (!result.success) return result.response

  // Business logic... always filter by company_id (defense in depth alongside RLS)
  return NextResponse.json({ data: result })
}
```

- Dynamic route params: `{ params }: { params: Promise<{ id: string }> }` (Next.js 16 — params are async).
- Response shapes: `{ data }` for success, `{ error }` for failures.
- Zod schemas in `lib/api/schemas.ts` — 100+ schemas with shared primitives (uuid, isoDate, accountNumber, nonNegativeAmount).
- Routes that emit events must call `ensureInitialized()` at module level.
- API-key auth uses `createServiceClientNoCookies()`; every query still filters by `company_id`.

## Endpoint map (`app/api/`)

- `/api/bookkeeping/*` — accounts, fiscal periods, journal entries (CRUD/reverse/correct), mapping rules, voucher gaps
- `/api/invoices/*`, `/api/supplier-invoices/*` — CRUD + state transitions
- `/api/transactions/*` — categorize, describe, book, match-{invoice,supplier-invoice}, batch, AI suggestions
- `/api/customers/*`, `/api/suppliers/*` — CRUD
- `/api/documents/*` — CRUD, versions, link, match-sweep, verify cron
- `/api/reports/*` — report endpoints (GL, TB, BS, IS, AR/supplier ledger, VAT, SIE, INK2, NE-bilaga, KPI, audit, continuity, monthly, full-archive, salary, vacation, avgifter)
- `/api/salary/*` — employees, payroll-config, tax-tables, KU, runs
- `/api/import/*` — bank-file, SIE (parse/execute/mappings)
- `/api/reconciliation/bank/*`, `/api/settings/*`, `/api/company/*`, `/api/team/*`
- `/api/deadlines/*`, `/api/tax-deadlines/*` — CRUD + crons
- `/api/pending-operations/*`, `/api/events/*`, `/api/audit-trail/*`
- `/api/calendar/feed/[token]`, `/api/mcp-oauth/*`, `/api/support/contact`, `/api/account/delete`
- `/api/log`, `/api/health`, `/api/vat/validate`, `/api/currency/rate`, `/api/sandbox/*`
- `/api/extensions/ext/[...path]` — dynamic extension routes (catch-all → `/api/extensions/ext/{extensionId}/{routePath}`, path params as `_paramName` query)
