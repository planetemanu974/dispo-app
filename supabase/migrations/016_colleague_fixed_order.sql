-- 016_colleague_fixed_order.sql
-- Adds priority order for fixed pilots within a pilot's team.
-- fixed_order = 1 is highest priority (main pilot), 2 is second, etc.
-- NULL means not a fixed pilot (or order not yet assigned).
ALTER TABLE public.colleagues
  ADD COLUMN IF NOT EXISTS fixed_order integer DEFAULT NULL;

COMMENT ON COLUMN public.colleagues.fixed_order IS
  'Display/priority order among fixed pilots for the same pilot_id. 1 = highest priority. NULL for non-fixed colleagues.';
