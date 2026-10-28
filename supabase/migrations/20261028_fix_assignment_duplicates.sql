-- Fix duplicate booking_assignments rows and add a partial unique index
-- to prevent future duplicates caused by concurrent auto-assign calls.
--
-- Root cause: React StrictMode (dev) and concurrent booking selection
-- could trigger fetchAndAutoAssign twice before the first DELETE completed,
-- leading to duplicate (booking_id, colleague_id) rows with status='accepted'.

-- ── Step 1: Remove duplicate accepted rows ────────────────────────────────────
-- For each (booking_id, colleague_id, 'accepted') group, keep only the most
-- recently created row; delete all older duplicates.
DELETE FROM booking_assignments
WHERE id NOT IN (
  SELECT DISTINCT ON (booking_id, colleague_id, status) id
  FROM booking_assignments
  WHERE status = 'accepted'
  ORDER BY booking_id, colleague_id, status, created_at DESC
)
AND status = 'accepted';

-- ── Step 2: Add partial unique index ─────────────────────────────────────────
-- Only one "accepted" assignment per (booking_id, colleague_id) pair is allowed.
-- Non-accepted rows (refused, pending) are not constrained by this index,
-- so replacing a refused assignment with a new accepted one still works.
CREATE UNIQUE INDEX IF NOT EXISTS booking_assignments_accepted_unique
ON booking_assignments (booking_id, colleague_id)
WHERE status = 'accepted';
