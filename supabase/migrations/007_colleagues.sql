-- ─────────────────────────────────────────────────────────────────────────────
-- 007_colleagues.sql
-- Pilot's personal contact list of colleague pilots + booking assignments.
-- A colleague does NOT need an app account — they respond via a one-time SMS link.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── colleagues ───────────────────────────────────────────────────────────────
-- Simple contact book: name + phone per pilot. No auth account required.
CREATE TABLE IF NOT EXISTS public.colleagues (
  id         uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_id   uuid  NOT NULL REFERENCES public.pilots(id) ON DELETE CASCADE,
  name       text  NOT NULL,
  phone      text  NOT NULL,
  notes      text  DEFAULT '',        -- optional notes (e.g. "spécialiste biplace lourd")
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.colleagues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "colleagues_pilot_all"
  ON public.colleagues FOR ALL
  USING  (pilot_id = (SELECT id FROM public.pilots WHERE user_id = auth.uid()))
  WITH CHECK (pilot_id = (SELECT id FROM public.pilots WHERE user_id = auth.uid()));

-- ── booking_assignments ───────────────────────────────────────────────────────
-- One row per (booking, colleague) assignment.
-- token: random hex sent in SMS link so colleague can respond without an account.
CREATE TABLE IF NOT EXISTS public.booking_assignments (
  id            uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid  NOT NULL REFERENCES public.bookings(id)   ON DELETE CASCADE,
  colleague_id  uuid  NOT NULL REFERENCES public.colleagues(id) ON DELETE CASCADE,
  pilot_id      uuid  NOT NULL REFERENCES public.pilots(id)     ON DELETE CASCADE,
  status        text  NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'refused')),
  token         text  NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  -- Denormalised for the public response page (no joins needed from anon context)
  slot_date     date,
  slot_time     time,
  pilot_name    text,
  pilot_phone   text,
  responded_at  timestamptz,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.booking_assignments ENABLE ROW LEVEL SECURITY;

-- Pilot: full access to their own assignments
CREATE POLICY "assignments_pilot_all"
  ON public.booking_assignments FOR ALL
  USING  (pilot_id = (SELECT id FROM public.pilots WHERE user_id = auth.uid()))
  WITH CHECK (pilot_id = (SELECT id FROM public.pilots WHERE user_id = auth.uid()));

-- Anonymous (colleague): can read + update their own assignment by token only
-- SELECT: needed for the response page to fetch job details
CREATE POLICY "assignments_anon_select_by_token"
  ON public.booking_assignments FOR SELECT
  USING (token IS NOT NULL);   -- token is not secret in the URL, but only known to recipient

-- UPDATE: colleague can only flip status + responded_at on their own token row
CREATE POLICY "assignments_anon_update_by_token"
  ON public.booking_assignments FOR UPDATE
  USING (token IS NOT NULL)
  WITH CHECK (token IS NOT NULL);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS assignments_booking_id ON public.booking_assignments (booking_id);
CREATE INDEX IF NOT EXISTS assignments_pilot_id   ON public.booking_assignments (pilot_id);
CREATE INDEX IF NOT EXISTS assignments_token      ON public.booking_assignments (token);
