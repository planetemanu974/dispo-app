// pilot-planning/index.ts
// Public API for fixed pilot planning pages.
// Called with a token (no auth required) to:
//   GET  ?token=xxx&week=YYYY-MM-DD  → pilot info + assignments + unavailability for the week
//   POST { token, action: 'add_unavail', start_date, end_date, slot_time? }
//   POST { token, action: 'remove_unavail', id }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    // ── GET: fetch planning data ──────────────────────────────────────────
    if (req.method === 'GET') {
      const url  = new URL(req.url)
      const token = url.searchParams.get('token')
      const week  = url.searchParams.get('week') // YYYY-MM-DD (Monday of the week)

      if (!token) return json({ error: 'Missing token' }, 400)

      // Validate token
      const { data: tokenRow } = await supabase
        .from('fixed_pilot_tokens')
        .select('*, colleagues(id, name, phone)')
        .eq('token', token)
        .is('revoked_at', null)
        .single()

      if (!tokenRow) return json({ error: 'Lien invalide ou révoqué.' }, 403)

      const colleagueId = tokenRow.colleague_id
      const pilotId     = tokenRow.pilot_id

      // Week range
      const monday = week ? new Date(week) : getMondayOf(new Date())
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      const startStr = monday.toISOString().slice(0, 10)
      const endStr   = sunday.toISOString().slice(0, 10)

      // Fetch assignments for this colleague during the week
      const { data: assignments } = await supabase
        .from('booking_assignments')
        .select(`
          id, status, slot_date, slot_time,
          bookings(id, pilot_slot_id, passengers(*), pilot_slots(slot_date, slot_time))
        `)
        .eq('colleague_id', colleagueId)
        .eq('pilot_id', pilotId)
        .eq('status', 'accepted')
        .gte('slot_date', startStr)
        .lte('slot_date', endStr)

      // Deduplicate: if the same booking appears multiple times (duplicate rows in
      // booking_assignments from concurrent auto-assign calls), keep only the most
      // recent one per booking_id.  The partial UNIQUE index (migration
      // 20261028_fix_assignment_duplicates.sql) prevents new duplicates, but rows
      // created before that migration may still exist in older data.
      const seenBookingIds = new Set<string>()
      const dedupedAssignments = (assignments || []).filter(a => {
        const bId = (a.bookings as { id?: string } | null)?.id
        if (!bId) return true          // no booking joined – keep as-is
        if (seenBookingIds.has(bId)) return false
        seenBookingIds.add(bId)
        return true
      })

      // Fetch unavailability for this colleague in the week range
      const { data: unavailability } = await supabase
        .from('fixed_pilot_unavailability')
        .select('*')
        .eq('colleague_id', colleagueId)
        .eq('pilot_id', pilotId)
        .lte('start_date', endStr)
        .gte('end_date', startStr)

      return json({
        colleague: tokenRow.colleagues,
        week_start: startStr,
        assignments: dedupedAssignments,
        unavailability: unavailability || [],
      })
    }

    // ── POST: add or remove unavailability ───────────────────────────────
    if (req.method === 'POST') {
      const body = await req.json()
      const { token, action } = body

      if (!token) return json({ error: 'Missing token' }, 400)

      // Validate token
      const { data: tokenRow } = await supabase
        .from('fixed_pilot_tokens')
        .select('colleague_id, pilot_id')
        .eq('token', token)
        .is('revoked_at', null)
        .single()

      if (!tokenRow) return json({ error: 'Lien invalide ou révoqué.' }, 403)

      const { colleague_id, pilot_id } = tokenRow

      if (action === 'add_unavail') {
        const { start_date, end_date, slot_time } = body
        if (!start_date) return json({ error: 'Missing start_date' }, 400)

        const { data, error } = await supabase
          .from('fixed_pilot_unavailability')
          .insert({
            colleague_id,
            pilot_id,
            start_date,
            end_date: end_date || start_date,
            slot_time: slot_time || null,
          })
          .select()
          .single()

        if (error) return json({ error: error.message }, 500)
        return json({ unavailability: data })
      }

      if (action === 'remove_unavail') {
        const { id } = body
        if (!id) return json({ error: 'Missing id' }, 400)

        await supabase
          .from('fixed_pilot_unavailability')
          .delete()
          .eq('id', id)
          .eq('colleague_id', colleague_id) // safety: can only delete own entries

        return json({ success: true })
      }

      return json({ error: 'Unknown action' }, 400)
    }

    return json({ error: 'Method not allowed' }, 405)

  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function getMondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1 - day)
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}
