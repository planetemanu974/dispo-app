-- ─────────────────────────────────────────────────────────────────────────────
-- 013_colleague_direct.sql
-- Differentiates between "structures" (companies with invite token)
-- and "direct colleagues" (independent pilots added manually, no account needed).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.colleagues
  ADD COLUMN IF NOT EXISTS is_direct boolean DEFAULT false NOT NULL;

-- Direct colleagues don't need an invite token — allow NULL explicitly
-- (invite_token already nullable, this comment just documents intent)

COMMENT ON COLUMN public.colleagues.is_direct IS
  'true = independent pilot added manually (no app account needed); false = structure with invite link';
