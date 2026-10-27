-- 017_fixed_pilot_planning.sql
-- Personal planning access for fixed pilots.
-- Each fixed colleague gets a unique token (link) to view their schedule
-- and mark themselves unavailable on specific slots, days, or date ranges.

-- ── Token table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fixed_pilot_tokens (
  id           uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  colleague_id uuid    NOT NULL REFERENCES public.colleagues(id) ON DELETE CASCADE,
  pilot_id     uuid    NOT NULL REFERENCES public.pilots(id)     ON DELETE CASCADE,
  token        text    NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_at   timestamptz DEFAULT now(),
  revoked_at   timestamptz DEFAULT NULL  -- NULL = active, set = revoked (pilot no longer fixed)
);

CREATE INDEX IF NOT EXISTS fixed_pilot_tokens_token_idx      ON public.fixed_pilot_tokens(token);
CREATE INDEX IF NOT EXISTS fixed_pilot_tokens_colleague_idx  ON public.fixed_pilot_tokens(colleague_id);

COMMENT ON TABLE  public.fixed_pilot_tokens IS
  'One active token per fixed colleague, used to access their personal planning page without login.';
COMMENT ON COLUMN public.fixed_pilot_tokens.revoked_at IS
  'Set when the colleague is demoted from fixed status; the link stops working.';

-- ── Unavailability table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fixed_pilot_unavailability (
  id           uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  colleague_id uuid    NOT NULL REFERENCES public.colleagues(id) ON DELETE CASCADE,
  pilot_id     uuid    NOT NULL REFERENCES public.pilots(id)     ON DELETE CASCADE,
  start_date   date    NOT NULL,
  end_date     date    NOT NULL DEFAULT start_date,  -- same as start = single day
  slot_time    time    DEFAULT NULL,                  -- NULL = full day(s), set = specific time slot
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fixed_unavail_colleague_idx ON public.fixed_pilot_unavailability(colleague_id);
CREATE INDEX IF NOT EXISTS fixed_unavail_dates_idx     ON public.fixed_pilot_unavailability(start_date, end_date);

COMMENT ON TABLE  public.fixed_pilot_unavailability IS
  'Unavailability periods declared by the fixed pilot themselves on their personal planning page.';
COMMENT ON COLUMN public.fixed_pilot_unavailability.slot_time IS
  'NULL = unavailable all day; set = unavailable only at this specific time slot.';

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.fixed_pilot_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_pilot_unavailability ENABLE ROW LEVEL SECURITY;

-- Tokens: only the owning pilot can read/write their own tokens
CREATE POLICY "pilot owns tokens"
  ON public.fixed_pilot_tokens
  FOR ALL
  USING  (pilot_id = auth.uid())
  WITH CHECK (pilot_id = auth.uid());

-- Unavailability: owning pilot can read/write; anon can read via token (handled in Edge Function)
CREATE POLICY "pilot owns unavailability"
  ON public.fixed_pilot_unavailability
  FOR ALL
  USING  (pilot_id = auth.uid())
  WITH CHECK (pilot_id = auth.uid());

-- Allow anon/service role reads for the public planning page
-- (done via Edge Function with service role key, not direct RLS)
