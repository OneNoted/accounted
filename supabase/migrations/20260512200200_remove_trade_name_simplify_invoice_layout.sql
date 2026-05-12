-- Simplify company naming: remove trade_name field entirely.
-- Add invoice_show_logo toggle for invoice PDF header.
-- Migrate any existing trade_name into company_name so users who set a
-- handelsnamn keep their preferred invoice display name. Existing users
-- should be notified to verify company_name against Bolagsverket since
-- this value is used in SIE/INK2/NE filings.

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS invoice_show_logo boolean DEFAULT true;

UPDATE public.company_settings
  SET company_name = trade_name
  WHERE trade_name IS NOT NULL
    AND trade_name <> ''
    AND trade_name <> company_name;

ALTER TABLE public.company_settings
  DROP COLUMN IF EXISTS trade_name;

NOTIFY pgrst, 'reload schema';
