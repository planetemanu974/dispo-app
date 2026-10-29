-- ─────────────────────────────────────────────────────────────────────────────
-- 020_fix_unavailability_rls.sql
-- Migration 017 compared pilot_id to auth.uid() directly, but every other table
-- resolves the pilot through pilots.user_id = auth.uid() (pilots.id is NOT the
-- auth user id). As a result the admin dashboard could not read, insert or
-- update rows in fixed_pilot_unavailability / fixed_pilot_tokens.
-- The new policies accept both forms. Rows stay private to their owner pilot.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "pilot owns unavailability" ON public.fixed_pilot_unavailability;
CREATE POLICY "pilot owns unavailability"
  ON public.fixed_pilot_unavailability
  FOR ALL
  USING (
    pilot_id = auth.uid()
    OR pilot_id IN (SELECT id FROM public.pilots WHERE user_id = auth.uid())
  )
  WITH CHECK (
    pilot_id = auth.uid()
    OR pilot_id IN (SELECT id FROM public.pilots WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "pilot owns tokens" ON public.fixed_pilot_tokens;
CREATE POLICY "pilot owns tokens"
  ON public.fixed_pilot_tokens
  FOR ALL
  USING (
    pilot_id = auth.uid()
    OR pilot_id IN (SELECT id FROM public.pilots WHERE user_id = auth.uid())
  )
  WITH CHECK (
    pilot_id = auth.uid()
    OR pilot_id IN (SELECT id FROM public.pilots WHERE user_id = auth.uid())
  );

-- Make PostgREST pick up the schema/policy changes immediately.
NOTIFY pgrst, 'reload schema';
