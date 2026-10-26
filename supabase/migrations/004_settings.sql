-- ============================================================
-- Settings table — one row per authenticated user
-- Stores slots, flight types, theme colors, school identity
-- ============================================================

CREATE TABLE IF NOT EXISTS public.settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- School identity (shown on booking page header)
  school_name     text NOT NULL DEFAULT 'Planete Parapente',
  school_location text NOT NULL DEFAULT 'Saint-Leu',

  -- Time slots as ordered JSON array of "HH:MM" strings
  slots jsonb NOT NULL DEFAULT '["08:00","09:15","10:30","11:45","13:00","14:15"]'::jsonb,

  -- Flight types — fully dynamic array
  -- Each item: { id, label, duration_min, price_eur, min_age, max_age (null = no limit), max_weight_kg }
  flight_types jsonb NOT NULL DEFAULT '[
    {"id":"discovery","label":"Découverte","duration_min":20,"price_eur":90,"min_age":6,"max_age":null,"max_weight_kg":100},
    {"id":"marmaille","label":"Vol marmaille","duration_min":20,"price_eur":80,"min_age":6,"max_age":14,"max_weight_kg":100},
    {"id":"performance","label":"Performance","duration_min":35,"price_eur":115,"min_age":15,"max_age":null,"max_weight_kg":100}
  ]'::jsonb,

  -- Theme colors (hex strings)
  color_bg              text NOT NULL DEFAULT '#000000',
  color_card            text NOT NULL DEFAULT '#0f172a',
  color_input           text NOT NULL DEFAULT '#1e293b',
  color_border          text NOT NULL DEFAULT '#334155',
  color_text            text NOT NULL DEFAULT '#e2e8f0',
  color_text_secondary  text NOT NULL DEFAULT '#94a3b8',
  color_accent          text NOT NULL DEFAULT '#3b82f6',
  color_btn_bg          text NOT NULL DEFAULT '#ffffff',
  color_btn_text        text NOT NULL DEFAULT '#000000',

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id)
);

-- RLS: each user sees only their own settings
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settings_select_own" ON public.settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "settings_insert_own" ON public.settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "settings_update_own" ON public.settings
  FOR UPDATE USING (auth.uid() = user_id);

-- Auto-update updated_at on every change
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER settings_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
