-- Migration: webhook_deliveries_retention
--
-- Round-1 review fix on PR #496 (Phase 6 PR-1 webhooks substrate).
--
-- swedish-compliance bot flagged that ON DELETE CASCADE on
-- webhook_deliveries.webhook_id silently removes terminal delivery rows
-- when a webhook is deleted. Terminal rows for accounting-event types
-- (journal_entry.committed, journal_entry.reversed, journal_entry.corrected,
-- period.locked, period.year_closed, salary_run.booked, agi.generated, ...)
-- constitute behandlingshistorik under BFNAR 2013:2 kap 8 § and must be
-- retained for 7 years post-period-end.
--
-- Fix: change the FK to ON DELETE SET NULL and make webhook_id nullable.
-- A webhook DELETE then leaves the delivery audit trail in place — it just
-- loses the back-reference to the no-longer-existing webhook row.
--
-- Read-side impact: GET /webhooks/{id}/deliveries already scopes by
-- (company_id, webhook_id) so dangling rows (webhook_id=NULL) don't appear
-- on that endpoint. A future per-company audit-trail endpoint can surface
-- them by selecting on company_id alone.
--
-- Pending and in_flight rows: these are operationally meaningless once the
-- webhook they target is gone (no receiver to POST to). The dispatcher's
-- existing webhook-not-found branch (lib/webhooks/dispatcher.ts) already
-- marks them dead with reason='webhook_deleted', which is correct under
-- the new FK semantics: they enter terminal state immediately and are
-- preserved for the audit trail.

ALTER TABLE public.webhook_deliveries
  ALTER COLUMN webhook_id DROP NOT NULL;

ALTER TABLE public.webhook_deliveries
  DROP CONSTRAINT IF EXISTS webhook_deliveries_webhook_id_fkey;

ALTER TABLE public.webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_webhook_id_fkey
    FOREIGN KEY (webhook_id) REFERENCES public.webhooks(id) ON DELETE SET NULL;

-- Dispatcher filters webhook_id IS NOT NULL at query time (see
-- lib/webhooks/dispatcher.ts:claimDueDeliveries) so pending/failed rows
-- whose webhook was deleted between enqueue and dispatch sit dormant in
-- the audit trail rather than retrying against nothing. The existing
-- idx_webhook_deliveries_due partial index continues to serve that query
-- — Postgres applies the additional NOT NULL predicate at fetch time;
-- the dormant dangling-row count is bounded and the extra cost is
-- negligible.

NOTIFY pgrst, 'reload schema';
