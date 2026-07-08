-- Third-party transaction enrichment (Gokind counterparty identification).
-- Stores a trimmed projection of the enrichment response, not the raw payload:
-- { provider, fetched_at, identified, counterparty { id, name, org_numbers,
--   logo_url }, industries [], tags [], flags [], payment { subscription,
--   vendor_name } }
-- Nullable: enrichment is optional and fail-soft; rows ingested while the
-- provider is unconfigured or unavailable simply have NULL here.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS enrichment jsonb;

NOTIFY pgrst, 'reload schema';
