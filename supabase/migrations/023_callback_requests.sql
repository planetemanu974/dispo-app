-- ─────────────────────────────────────────────────────────────────────────────
-- 023_callback_requests.sql
-- "Please call me back" requests left by customers in the booking assistant.
--
-- Privacy: nobody can read or write this table from the public site. Rows are inserted
-- ONLY by the `booking-assistant` Edge Function (service role, bypasses RLS). Signed-in
-- pilots can read them and mark them as done.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.callback_requests (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  contact_name  text        NOT NULL,
  contact_phone text        NOT NULL,
  wanted_date   date,                       -- date the customer asked for, if any
  summary       text        NOT NULL DEFAULT '',   -- group, wishes, why a call is needed
  draft         jsonb,                      -- passengers collected by the assistant
  status        text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done')),
  handled_at    timestamptz
);

ALTER TABLE public.callback_requests ENABLE ROW LEVEL SECURITY;

-- Signed-in pilots only (the public/anon role gets nothing)
CREATE POLICY "callback_requests_pilot_select"
  ON public.callback_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pilots WHERE user_id = auth.uid()));

CREATE POLICY "callback_requests_pilot_update"
  ON public.callback_requests FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.pilots WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pilots WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS callback_requests_status_created
  ON public.callback_requests (status, created_at DESC);

-- Live banner in the dashboard (INSERT / UPDATE events)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.callback_requests;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
