-- 014_colleague_notes.sql
-- Free-text notes field on colleagues (useful for direct pilots: availability, remarks…)
ALTER TABLE public.colleagues
  ADD COLUMN IF NOT EXISTS notes text DEFAULT NULL;
