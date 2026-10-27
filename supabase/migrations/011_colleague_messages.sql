-- ─────────────────────────────────────────────────────────────────────────────
-- 011_colleague_messages.sql
-- Simple one-way messaging: a colleague can send a text message to the pilot.
-- The pilot reads messages in their Dashboard. No reply mechanism (phase 1).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.colleague_messages (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_id         uuid        NOT NULL REFERENCES public.pilots(id) ON DELETE CASCADE,
  colleague_id     uuid        NOT NULL REFERENCES public.colleagues(id) ON DELETE CASCADE,
  colleague_name   text        NOT NULL,    -- denormalised — display without join
  body             text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  read_at          timestamptz,             -- NULL = non lu
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.colleague_messages ENABLE ROW LEVEL SECURITY;

-- Pilot: full access to their own messages
CREATE POLICY "messages_pilot_all"
  ON public.colleague_messages FOR ALL
  USING  (pilot_id = (SELECT id FROM public.pilots WHERE user_id = auth.uid()))
  WITH CHECK (pilot_id = (SELECT id FROM public.pilots WHERE user_id = auth.uid()));

-- Colleague (anon): can INSERT only — they supply pilot_id + colleague_id from their session
CREATE POLICY "messages_colleague_insert"
  ON public.colleague_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.colleagues c
      WHERE c.id = colleague_id
        AND c.pilot_id = colleague_messages.pilot_id
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS messages_pilot_id     ON public.colleague_messages (pilot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_unread       ON public.colleague_messages (pilot_id) WHERE read_at IS NULL;
