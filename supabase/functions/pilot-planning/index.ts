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

      // Fetch ALL accepted assignments for this colleague (no date filter here).
      // We filter by week in JS using the CANONICAL slot_date from pilot_slots —
      // not the denormalized booking_assignments.slot_date which may be stale/wrong.
      const { data: rawAssignments } = await supabase
        .from('booking_assignments')
        .select(`
          id, status, slot_date, slot_time,
          bookings(id, pilot_slot_id, passengers(*), pilot_slots(slot_date, slot_time))
        `)
        .eq('colleague_id', colleagueId)
        .eq('pilot_id', pilotId)
        .eq('status', 'accepted')

      // Filter to the requested week using canonical pilot_slots.slot_date.
      // Falls back to the denormalized field only when no booking is joined.
      const weekRaw = (rawAssignments || []).filter(a => {
        const d = (a.bookings as any)?.pilot_slots?.slot_date ?? a.slot_date
        return d && d >= startStr && d <= endStr
      })

      // Deduplicate: if the same booking appears multiple times (duplicate rows in
      // booking_assignments from concurrent auto-assign calls), keep only the most
      // recent one per booking_id.  The partial UNIQUE index (migration
      // 20261028_fix_assignment_duplicates.sql) prevents new duplicates, but rows
      // created before that migration may still exist in older data.
      const seenBookingIds = new Set<string>()
      const dedupedAssignments = weekRaw.filter(a => {
        const bId = (a.bookings as { id?: string } | null)?.id
        if (!bId) return true          // no booking joined – keep as-is
        if (seenBookingIds.has(bId)) return false
        seenBookingIds.add(bId)
        return true
      })

      // ── Self-pilot detection ─────────────────────────────────────────────
      // If the colleague IS the main pilot (same phone number → same person),
      // their planning page must also show their OWN confirmed bookings as BOOKÉ.
      // Colleagues only appear in booking_assignments when they are called in as
      // backup; the pilot who owns the slot is never inserted there for their own
      // flights, which is why MANU1 would otherwise show all DISPO.

      // Fetch pilot's phone to compare
      const { data: pilotContact } = await supabase
        .from('pilots')
        .select('phone, name')
        .eq('id', pilotId)
        .single()

      const normalizePhone = (p: string) => (p || '').replace(/\D/g, '')
      const colleaguePhone = (tokenRow.colleagues as any)?.phone || ''
      const isSelfPilot =
        pilotContact?.phone &&
        colleaguePhone &&
        normalizePhone(pilotContact.phone) === normalizePhone(colleaguePhone)

      // If self-pilot: synthesise BOOKÉ entries from pilot_slots + confirmed bookings
      let selfPilotAssignments: any[] = []
      if (isSelfPilot) {
        const { data: pilotSlotsRaw } = await supabase
          .from('pilot_slots')
          .select('id, slot_date, slot_time, bookings(id, status, passengers(*))')
          .eq('pilot_id', pilotId)
          .gte('slot_date', startStr)
          .lte('slot_date', endStr)

        // One synthetic assignment per confirmed booking in the week
        selfPilotAssignments = (pilotSlotsRaw || []).flatMap((ps: any) => {
          const confirmedBookings = ((ps.bookings as any[]) || []).filter(
            (b: any) => b.status === 'confirmed'
          )
          return confirmedBookings.map((b: any) => ({
            id: `self-${b.id}`,
            status: 'accepted',
            slot_date: ps.slot_date,
            slot_time: ps.slot_time,
            bookings: {
              id: b.id,
              pilot_slot_id: ps.id,
              passengers: b.passengers || [],
              pilot_slots: {
                slot_date: ps.slot_date,
                slot_time: ps.slot_time,
              },
            },
          }))
        })
      }

      // Merge colleague assignments + self-pilot entries.
      // Self-pilot entries are appended AFTER dedup, so they won't clash with
      // any manually-created assignment rows for the same booking.
      const allAssignments = [...dedupedAssignments, ...selfPilotAssignments]

      // Fetch unavailability for this colleague in the week range
      // Exclude soft-deleted rows (removed by the pilot via remove_unavail)
      const { data: unavailability } = await supabase
        .from('fixed_pilot_unavailability')
        .select('*')
        .eq('colleague_id', colleagueId)
        .eq('pilot_id', pilotId)
        .lte('start_date', endStr)
        .gte('end_date', startStr)
        .is('removed_at', null)

      return json({
        colleague: tokenRow.colleagues,
        week_start: startStr,
        assignments: allAssignments,
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
        const endDate: string = end_date || start_date
        if (endDate < start_date) return json({ error: 'La date de fin précède la date de début.' }, 400)

        // ── Booked slots are LOCKED ────────────────────────────────────────
        // A pilot can never become "unavailable" on a slot where he is already
        // booked. Full-day and period requests are therefore expanded: days
        // without any booking stay a single row, days with bookings get one
        // row per non-booked slot only.
        const dates = eachDate(start_date, endDate)
        if (dates.length > 366) return json({ error: 'Période trop longue (366 jours max).' }, 400)

        const booked = await getBookedKeys(supabase, colleague_id, pilot_id, start_date, endDate)
        const wanted = slot_time ? String(slot_time).slice(0, 5) : null

        // rows = [{ start, end, time }] to insert
        const rows: { start: string; end: string; time: string | null }[] = []
        let skipped = 0

        if (wanted) {
          // One specific slot time, over one or several days
          const free = dates.filter(d => {
            const isBooked = booked.has(`${d}|${wanted}`)
            if (isBooked) skipped++
            return !isBooked
          })
          for (const [s, e] of groupContiguous(free)) rows.push({ start: s, end: e, time: slot_time })
        } else {
          // Whole day(s)
          const daysWithoutBooking: string[] = []
          for (const d of dates) {
            const bookedTimes = ALL_SLOTS.filter(t => booked.has(`${d}|${t}`))
            if (bookedTimes.length === 0) { daysWithoutBooking.push(d); continue }
            // Day has bookings: close only the free slots, one row each
            skipped += bookedTimes.length
            for (const t of ALL_SLOTS) {
              if (!booked.has(`${d}|${t}`)) rows.push({ start: d, end: d, time: t + ':00' })
            }
          }
          for (const [s, e] of groupContiguous(daysWithoutBooking)) rows.push({ start: s, end: e, time: null })
        }

        if (rows.length === 0) {
          return json({ error: 'Ce créneau est déjà réservé : il ne peut pas être marqué indisponible.' }, 409)
        }

        const { data: inserted, error } = await supabase
          .from('fixed_pilot_unavailability')
          .insert(rows.map(r => ({
            colleague_id,
            pilot_id,
            start_date: r.start,
            end_date: r.end,
            slot_time: r.time,
          })))
          .select()

        if (error) return json({ error: error.message }, 500)

        // Log activity so admin sees it in DERNIERS CHANGEMENTS (best-effort)
        await supabase.from('activity_log').insert({
          pilot_id,
          action: 'pilot_unavail_added',
          entity_type: 'unavailability',
          entity_id: inserted?.[0]?.id ?? null,
          details: { colleague_id, start_date, end_date: endDate, slot_time: slot_time || null },
        })

        return json({ unavailability: inserted?.[0] ?? null, created: inserted?.length ?? 0, skipped_booked: skipped })
      }

      if (action === 'remove_unavail') {
        const { id } = body
        if (!id) return json({ error: 'Missing id' }, 400)

        // Soft-delete: mark the row as removed rather than deleting it.
        // This lets ActivityFeed reliably show "Disponibilité rétablie" by
        // querying recently-removed rows directly from fixed_pilot_unavailability,
        // without depending on an activity_log insert that could fail silently.
        const { data: row, error: updateError } = await supabase
          .from('fixed_pilot_unavailability')
          .update({ removed_at: new Date().toISOString() })
          .eq('id', id)
          .eq('colleague_id', colleague_id) // safety: can only remove own entries
          .is('removed_at', null)            // idempotent: ignore already-removed rows
          .select()
          .single()

        if (updateError) return json({ error: updateError.message }, 500)

        // Also write to activity_log for audit trail (best-effort, no hard failure)
        await supabase.from('activity_log').insert({
          pilot_id,
          action: 'pilot_unavail_removed',
          entity_type: 'unavailability',
          entity_id: null,
          details: {
            colleague_id,
            start_date: row?.start_date ?? null,
            end_date:   row?.end_date   ?? null,
            slot_time:  row?.slot_time  ?? null,
          },
        })

        return json({ success: true })
      }

      return json({ error: 'Unknown action' }, 400)
    }

    return json({ error: 'Method not allowed' }, 405)

  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

const ALL_SLOTS = ['08:00', '09:15', '10:30', '11:45', '13:00', '14:15']

// Every YYYY-MM-DD between two dates, inclusive (UTC maths: no timezone drift).
function eachDate(startStr: string, endStr: string): string[] {
  const out: string[] = []
  const d = new Date(startStr + 'T00:00:00Z')
  const end = new Date(endStr + 'T00:00:00Z')
  while (d <= end && out.length <= 400) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

// Groups sorted YYYY-MM-DD strings into [start, end] runs of consecutive days.
function groupContiguous(dates: string[]): [string, string][] {
  const runs: [string, string][] = []
  for (const d of dates) {
    const last = runs[runs.length - 1]
    if (last) {
      const next = new Date(last[1] + 'T00:00:00Z')
      next.setUTCDate(next.getUTCDate() + 1)
      if (next.toISOString().slice(0, 10) === d) { last[1] = d; continue }
    }
    runs.push([d, d])
  }
  return runs
}

// Set of "YYYY-MM-DD|HH:MM" keys where this colleague is booked in [startStr, endStr].
// Mirrors the GET handler: accepted assignments (canonical pilot_slots date) plus,
// when the colleague IS the main pilot, his own confirmed bookings.
async function getBookedKeys(
  supabase: ReturnType<typeof createClient>,
  colleagueId: string, pilotId: string, startStr: string, endStr: string,
): Promise<Set<string>> {
  const keys = new Set<string>()

  const { data: assignments } = await supabase
    .from('booking_assignments')
    .select('slot_date, slot_time, bookings(pilot_slots(slot_date, slot_time))')
    .eq('colleague_id', colleagueId)
    .eq('pilot_id', pilotId)
    .eq('status', 'accepted')

  for (const a of (assignments || []) as any[]) {
    const d = a.bookings?.pilot_slots?.slot_date ?? a.slot_date
    const t = a.bookings?.pilot_slots?.slot_time ?? a.slot_time
    if (d && t && d >= startStr && d <= endStr) keys.add(`${d}|${String(t).slice(0, 5)}`)
  }

  // Self-pilot: the main pilot's own confirmed bookings are never in booking_assignments
  const [{ data: col }, { data: pil }] = await Promise.all([
    supabase.from('colleagues').select('phone').eq('id', colleagueId).single(),
    supabase.from('pilots').select('phone').eq('id', pilotId).single(),
  ])
  const norm = (p: string) => (p || '').replace(/\D/g, '')
  if (col?.phone && pil?.phone && norm(col.phone) === norm(pil.phone)) {
    const { data: slots } = await supabase
      .from('pilot_slots')
      .select('slot_date, slot_time, bookings(status)')
      .eq('pilot_id', pilotId)
      .gte('slot_date', startStr)
      .lte('slot_date', endStr)
    for (const ps of (slots || []) as any[]) {
      if ((ps.bookings || []).some((b: any) => b.status === 'confirmed')) {
        keys.add(`${ps.slot_date}|${String(ps.slot_time).slice(0, 5)}`)
      }
    }
  }
  return keys
}

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
