-- 015_colleague_fixed.sql
-- Adds "fixed pilot" flag: direct colleagues promoted to the regular team.
-- Fixed pilots can be assigned to bookings directly without sending an SMS.
ALTER TABLE public.colleagues
  ADD COLUMN IF NOT EXISTS is_fixed boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN public.colleagues.is_fixed IS
  'true = pilote indépendant fixe (part of the current team, assignable without SMS); only meaningful when is_direct = true';
