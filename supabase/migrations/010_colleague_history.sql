-- ─────────────────────────────────────────────────────────────────────────────
-- 010_colleague_history.sql
-- RPC pour récupérer l'historique des demandes d'un collègue.
-- Utilisé par ColleagueDispo.jsx pour afficher l'onglet "Historique".
-- ─────────────────────────────────────────────────────────────────────────────

-- Returns all past requests made by a given colleague,
-- joined with slot date/time for display. Ordered most recent first.
CREATE OR REPLACE FUNCTION public.get_colleague_history(
  p_colleague_id uuid,
  p_limit        int DEFAULT 50
)
RETURNS TABLE (
  request_id  uuid,
  slot_date   date,
  slot_time   time,
  status      text,
  note        text,
  created_at  timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cr.id         AS request_id,
    ps.slot_date,
    ps.slot_time,
    cr.status,
    cr.note,
    cr.created_at
  FROM colleague_requests cr
  JOIN pilot_slots ps ON ps.id = cr.pilot_slot_id
  WHERE cr.colleague_id = p_colleague_id
  ORDER BY ps.slot_date DESC, ps.slot_time DESC
  LIMIT p_limit;
$$;

-- Accessible in anon context (colleague is not a Supabase auth user)
GRANT EXECUTE ON FUNCTION public.get_colleague_history TO anon, authenticated;
