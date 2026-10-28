-- ─────────────────────────────────────────────────────────────────────────────
-- 019_soft_delete_unavailability.sql
-- Instead of hard-deleting rows when a pilot re-enables availability,
-- we mark them with removed_at so ActivityFeed can show
-- "Disponibilité rétablie" events reliably without depending on activity_log.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.fixed_pilot_unavailability
  ADD COLUMN IF NOT EXISTS removed_at timestamptz DEFAULT NULL;

-- Index for ActivityFeed's "recently removed" query
CREATE INDEX IF NOT EXISTS idx_fixed_pilot_unavailability_removed
  ON public.fixed_pilot_unavailability (pilot_id, removed_at DESC)
  WHERE removed_at IS NOT NULL;
