-- BFL 7 kap. 2 § requires accounting information to be preserved through
-- the end of the seventh calendar year after the calendar year in which the
-- fiscal year ended. retention_expires_at stores the first date on which the
-- statutory minimum retention period has elapsed.

CREATE OR REPLACE FUNCTION public.set_bfl_retention_expiry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.retention_expires_at := make_date(
    extract(year FROM NEW.period_end)::integer + 8,
    1,
    1
  );
  RETURN NEW;
END;
$$;

-- PostgreSQL fires triggers with the same timing alphabetically. The zz
-- prefix makes this legal correction run after the original migration 017
-- trigger without modifying that shipped enforcement migration.
CREATE TRIGGER zz_set_bfl_retention_expiry
  BEFORE INSERT OR UPDATE OF period_end ON public.fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION public.set_bfl_retention_expiry();

UPDATE public.fiscal_periods
SET retention_expires_at = make_date(
  extract(year FROM period_end)::integer + 8,
  1,
  1
);
