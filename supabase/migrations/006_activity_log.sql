-- ─────────────────────────────────────────────────────────────────────────────
-- 006_activity_log.sql
-- Audit trail: every meaningful action the pilot takes is logged here.
-- The pilot can review this log from the History page to recover from mistakes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.activity_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_id    uuid        NOT NULL REFERENCES public.pilots(id) ON DELETE CASCADE,
  action      text        NOT NULL,   -- e.g. 'booking_created', 'booking_confirmed', ...
  entity_type text        NOT NULL,   -- 'booking' | 'slot'
  entity_id   uuid,                   -- id of the affected booking or slot (nullable for bulk ops)
  details     jsonb       DEFAULT '{}',  -- booking_ref, contact_name, contact_phone, old values…
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Pilots can only read and insert their own logs; no update or delete
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_log_pilot_select"
  ON public.activity_log FOR SELECT
  USING (pilot_id = (SELECT id FROM public.pilots WHERE user_id = auth.uid()));

CREATE POLICY "activity_log_pilot_insert"
  ON public.activity_log FOR INSERT
  WITH CHECK (pilot_id = (SELECT id FROM public.pilots WHERE user_id = auth.uid()));

-- Speed up the most common query: pilot's recent events
CREATE INDEX IF NOT EXISTS activity_log_pilot_created
  ON public.activity_log (pilot_id, created_at DESC);
