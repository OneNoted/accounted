-- Seed trial + comp capability grants so the fail-closed gate (migration
-- 20260628140000) can be deployed without locking anyone out.
--
-- THREE parts:
--   1. A trigger that grants every NEW company a 30-day trial on the PAID keys,
--      at creation, on EVERY creation path (RPC / MCP / direct insert). This is
--      what makes a new signup able to use onboarding AI immediately.
--   2. A one-time backfill of trial grants for EXISTING companies, using the
--      cutover rule: created on/before 2026-06-07 -> trial ends 2026-07-07;
--      created after -> created_at + 30 days.
--   3. Permanent comp grants (never expire) for the two comp companies.
--
-- PAID keys mirror lib/entitlements/keys.ts PAID_CAPABILITIES
-- (ai, bank_sync, skatteverket, email_send). Free keys (org_lookup,
-- vat_validation, currency_rates, cloud_backup) are intentionally NOT seeded.
-- Grants are company-scoped (team_id NULL); firm/team-scoped plans come later.

-- =============================================================================
-- 1. Trigger: trial grant on new company creation
-- =============================================================================
-- SECURITY DEFINER so it can write capability_grants regardless of the caller's
-- RLS (the table has no INSERT policy for authenticated — writes are
-- service-role/definer only, so a user can never self-grant).
CREATE OR REPLACE FUNCTION public.seed_trial_capability_grants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.capability_grants (company_id, capability_key, source, expires_at)
  SELECT NEW.id, k.key, 'trial', NEW.created_at + interval '30 days'
  FROM (VALUES ('ai'), ('bank_sync'), ('skatteverket'), ('email_send')) AS k(key)
  ON CONFLICT (company_id, team_id, capability_key, source) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seed_trial_capability_grants
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.seed_trial_capability_grants();

-- =============================================================================
-- 2. Backfill: existing companies get a trial until the cutover
-- =============================================================================
-- created on/before 2026-06-07 (i.e. before 2026-06-08) -> ends 2026-07-07;
-- created after -> created_at + 30 days. Skips already-granted rows.
INSERT INTO public.capability_grants (company_id, capability_key, source, expires_at)
SELECT
  c.id,
  k.key,
  'trial',
  CASE
    WHEN c.created_at < timestamptz '2026-06-08 00:00:00+00'
      THEN timestamptz '2026-07-07 00:00:00+00'
    ELSE c.created_at + interval '30 days'
  END
FROM public.companies c
CROSS JOIN (VALUES ('ai'), ('bank_sync'), ('skatteverket'), ('email_send')) AS k(key)
WHERE c.archived_at IS NULL
ON CONFLICT (company_id, team_id, capability_key, source) DO NOTHING;

-- =============================================================================
-- 3. Comp companies: permanent grants (never expire)
-- =============================================================================
-- Matched by name (no hardcoded UUIDs). If a name doesn't match in this DB,
-- zero rows are inserted — safe. Verify the names against prod before relying on
-- the comp status.
INSERT INTO public.capability_grants (company_id, capability_key, source, expires_at)
SELECT c.id, k.key, 'comp', NULL
FROM public.companies c
CROSS JOIN (VALUES ('ai'), ('bank_sync'), ('skatteverket'), ('email_send')) AS k(key)
WHERE c.name IN ('Arcim Technology AB', 'Mattsson Systems AB')
ON CONFLICT (company_id, team_id, capability_key, source) DO NOTHING;

NOTIFY pgrst, 'reload schema';
