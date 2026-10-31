-- ─────────────────────────────────────────────────────────────────────────────
-- 024_support_requests.sql
-- "Prévenir l'administrateur": help requests sent from inside the app by a signed-in
-- user (e.g. the secretary). Rows are inserted ONLY by the `support-assistant` Edge Function
-- (service role). Signed-in pilots can read them and mark them as done. Nothing is public.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.support_requests (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  from_name    text        NOT NULL DEFAULT '',   -- who asked (pilot name)
  from_user    uuid,                              -- auth user id
  page         text        NOT NULL DEFAULT '',   -- screen the person was on
  message      text        NOT NULL,              -- what the person wrote
  conversation jsonb,                             -- short chat with the advisor, for context
  status       text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done')),
  handled_at   timestamptz
);

ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_requests_pilot_select"
  ON public.support_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pilots WHERE user_id = auth.uid()));

CREATE POLICY "support_requests_pilot_update"
  ON public.support_requests FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.pilots WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pilots WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS support_requests_status_created
  ON public.support_requests (status, created_at DESC);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.support_requests;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
