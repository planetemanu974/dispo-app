// ActivityFeed.jsx
// Live feed of recent planning changes shown below the admin calendar.
// Merges three sources:
//   1. activity_log                         → admin actions (bookings, slots…)
//   2. fixed_pilot_unavailability (active)  → pilot marked himself unavailable
//   3. fixed_pilot_unavailability (removed) → pilot re-enabled availability (soft-delete)
// Every entry shows WHO / WHAT / WHEN in full (wrapping, never truncated) and is
// tappable: a booking entry opens that booking, any other entry jumps to its day.
// Auto-refreshes silently every 30 seconds.

import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ── Human-readable labels for activity_log action keys ───────────────────────
const ACTION_LABELS = {
  booking_created:        { icon: '📋', text: 'Réservation créée' },
  booking_confirmed:      { icon: '✅', text: 'Réservation confirmée' },
  booking_refused:        { icon: '❌', text: 'Réservation refusée' },
  booking_cancelled:      { icon: '🚫', text: 'Réservation annulée' },
  booking_edited:         { icon: '✏️', text: 'Réservation modifiée' },
  slot_toggled:           { icon: '🔄', text: 'Créneau' },
  bulk_slot_toggle:       { icon: '🔄', text: 'Créneaux (lot)' },
  bulk_slot_delete:       { icon: '🗑️', text: 'Créneaux supprimés' },
  pilot_unavail_added:    { icon: '🚫', text: 'Indisponibilité' },
  pilot_unavail_removed:  { icon: '✅', text: 'Disponibilité rétablie' },
}

// Format ISO timestamp → "mer. 29 oct. à 09:15"
function fmtDT(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return (
    d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) +
    ' à ' +
    d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  )
}

// Format a date string (YYYY-MM-DD) → "mer. 29 oct."
function fmtDate(str) {
  if (!str) return ''
  return new Date(str + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

// Build a short detail string from an activity_log details object
function logDetail(action, details = {}, colleagueName = null) {
  const parts = []

  // Slot toggle: show date + time + what changed (ouvert/fermé)
  if (action === 'slot_toggled') {
    if (details.slot_date) parts.push(fmtDate(details.slot_date))
    if (details.slot_time) parts.push(details.slot_time.slice(0, 5))
    if (details.is_available === true)  parts.push('→ ouvert')
    if (details.is_available === false) parts.push('→ fermé')
    return parts.join(' · ')
  }

  // Bulk slot toggle: count + dates + times
  if (action === 'bulk_slot_toggle') {
    const n = details.count ?? '?'
    const parts2 = [`${n} créneau${n > 1 ? 'x' : ''}`]
    if (details.dates?.length) {
      const unique = [...new Set(details.dates.map(d => fmtDate(d)))]
      parts2.push(unique.length === 1 ? unique[0] : `${unique[0]} → ${unique[unique.length - 1]}`)
    }
    if (details.times?.length) parts2.push(details.times.join(', '))
    return parts2.join(' · ')
  }

  // Bulk slot delete: count + dates
  if (action === 'bulk_slot_delete') {
    const n = details.count ?? '?'
    const parts2 = [`${n} créneau${n > 1 ? 'x' : ''} supprimé${n > 1 ? 's' : ''}`]
    if (details.dates?.length) {
      const unique = [...new Set(details.dates.map(d => fmtDate(d)))]
      parts2.push(unique.length === 1 ? unique[0] : `${unique[0]} → ${unique[unique.length - 1]}`)
    }
    return parts2.join(' · ')
  }

  // Pilot unavailability added/removed: pilot + date range + slot time
  if (action === 'pilot_unavail_added' || action === 'pilot_unavail_removed') {
    if (colleagueName) parts.push(colleagueName)
    if (details.start_date) {
      const start = fmtDate(details.start_date)
      const end   = details.end_date && details.end_date !== details.start_date ? fmtDate(details.end_date) : null
      parts.push(end ? `${start} → ${end}` : start)
    }
    parts.push(details.slot_time ? details.slot_time.slice(0, 5) : 'journée entière')
    return parts.join(' · ')
  }

  // Booking actions: contact name + date + time + pax + status change
  if (details.contact_name) parts.push(details.contact_name)
  if (details.slot_date)    parts.push(fmtDate(details.slot_date))
  if (details.slot_time)    parts.push(details.slot_time.slice(0, 5))
  if (details.pax_count)    parts.push(`${details.pax_count} pax`)
  if (details.new_status)   parts.push(`→ ${details.new_status}`)
  return parts.join(' · ')
}

// The day an activity_log entry is about (used to jump to that day when tapped)
function logDate(action, d = {}) {
  return d.slot_date || d.start_date || d.dates?.[0] || null
}

// Merge consecutive rows created/removed by the same pilot within 10 s into ONE
// entry (a "whole day" request is stored as several rows by the server).
function groupRows(rows, atKey) {
  const groups = []
  for (const r of rows) {
    const g = groups[groups.length - 1]
    if (g && g.colleagueId === r.colleague_id &&
        Math.abs(new Date(g.at) - new Date(r[atKey])) < 10_000) {
      g.rows.push(r)
    } else {
      groups.push({ colleagueId: r.colleague_id, at: r[atKey], name: r.colleagues?.name, rows: [r] })
    }
  }
  return groups
}

function groupDetail(name, rows) {
  const starts = rows.map(r => r.start_date).sort()
  const first  = starts[0]
  const last   = rows.map(r => r.end_date).sort().pop()
  const times  = [...new Set(rows.filter(r => r.slot_time).map(r => r.slot_time.slice(0, 5)))].sort()
  const allDay = rows.some(r => !r.slot_time)
  const day    = first === last ? fmtDate(first) : `${fmtDate(first)} → ${fmtDate(last)}`
  const when   = allDay ? (times.length ? `journée entière + ${times.join(', ')}` : 'journée entière') : times.join(', ')
  return [name, day, when].filter(Boolean).join(' · ')
}

// ── Component ─────────────────────────────────────────────────────────────────
// onOpenBooking(bookingId) → Promise<boolean>  (true when the booking was opened)
// onOpenDay(dateStr)       → jump to that day in the day view

export default function ActivityFeed({ pilotId, onOpenBooking, onOpenDay }) {
  const [entries, setEntries] = useState([])
  const [adminName, setAdminName] = useState('')

  // Fetch the admin's own name once on mount
  useEffect(() => {
    if (!pilotId) return
    supabase
      .from('colleagues')
      .select('name')
      .eq('id', pilotId)
      .single()
      .then(({ data }) => { if (data?.name) setAdminName(data.name) })
  }, [pilotId])

  const load = useCallback(async () => {
    if (!pilotId) return

    // Colleague names, to say WHICH pilot an unavailability is about
    const { data: cols } = await supabase
      .from('colleagues').select('id, name').eq('pilot_id', pilotId)
    const colName = Object.fromEntries((cols || []).map(c => [c.id, c.name]))

    // 1. Admin's own activity log (most recent 15 entries)
    const { data: logs } = await supabase
      .from('activity_log')
      .select('id, action, entity_type, entity_id, details, created_at')
      .eq('pilot_id', pilotId)
      .order('created_at', { ascending: false })
      .limit(15)

    // 2a. Active colleague unavailabilities (pilot marked themselves unavailable)
    const { data: activeUnavails } = await supabase
      .from('fixed_pilot_unavailability')
      .select('id, colleague_id, start_date, end_date, slot_time, created_at, colleagues(name)')
      .eq('pilot_id', pilotId)
      .is('removed_at', null)
      .order('created_at', { ascending: false })
      .limit(30)

    // 2b. Recently re-enabled availabilities (soft-deleted within last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: removedUnavails } = await supabase
      .from('fixed_pilot_unavailability')
      .select('id, colleague_id, start_date, end_date, slot_time, created_at, removed_at, colleagues(name)')
      .eq('pilot_id', pilotId)
      .not('removed_at', 'is', null)
      .gte('removed_at', sevenDaysAgo)
      .order('removed_at', { ascending: false })
      .limit(30)

    const near = (a, b) => Math.abs(new Date(a) - new Date(b)) < 15_000

    // Table-derived entries (grouped)
    const unavailItems = groupRows(activeUnavails || [], 'created_at').map(g => ({
      id: `unavail-${g.rows[0].id}`,
      at: g.at,
      icon: '🚫',
      label: 'Indisponibilité',
      detail: groupDetail(null, g.rows),
      source: 'pilot',
      author: g.name || 'Pilote',
      target: { type: 'day', date: g.rows.map(r => r.start_date).sort()[0] },
    }))
    const removedItems = groupRows(removedUnavails || [], 'removed_at').map(g => ({
      id: `removed-${g.rows[0].id}`,
      at: g.at,
      icon: '✅',
      label: 'Disponibilité rétablie',
      detail: groupDetail(null, g.rows),
      source: 'pilot',
      author: g.name || 'Pilote',
      target: { type: 'day', date: g.rows.map(r => r.start_date).sort()[0] },
    }))

    // activity_log entries. Pilot unavailability events are ALSO written to the log by the
    // server: drop those already covered by a table-derived entry (same pilot, same moment).
    const allRows = [...(activeUnavails || []), ...(removedUnavails || [])]
    const logItems = (logs || [])
      .filter(l => {
        if (l.action === 'pilot_unavail_added') {
          return !allRows.some(r => r.colleague_id === l.details?.colleague_id && near(r.created_at, l.created_at))
        }
        if (l.action === 'pilot_unavail_removed') {
          return !(removedUnavails || []).some(r => r.colleague_id === l.details?.colleague_id && near(r.removed_at, l.created_at))
        }
        return true
      })
      .map(l => {
        const d = l.details || {}
        const isPilotEvent = l.action === 'pilot_unavail_added' || l.action === 'pilot_unavail_removed'
        const who = isPilotEvent ? (colName[d.colleague_id] || 'Pilote') : null
        let { icon, text } = ACTION_LABELS[l.action] || { icon: '•', text: l.action }
        // For slot toggles, include the new state in the label itself
        if (l.action === 'slot_toggled') {
          text = d.is_available === true  ? 'Créneau ouvert'
               : d.is_available === false ? 'Créneau fermé'
               : 'Créneau modifié'
        }
        if (l.action === 'bulk_slot_toggle') {
          text = d.is_available === true  ? 'Créneaux ouverts (lot)'
               : d.is_available === false ? 'Créneaux fermés (lot)'
               : 'Créneaux modifiés (lot)'
        }
        const date = logDate(l.action, d)
        let target = null
        if (l.entity_type === 'booking' && l.entity_id) target = { type: 'booking', id: l.entity_id, date }
        else if (date) target = { type: 'day', date }
        return {
          id: `log-${l.id}`,
          at: l.created_at,
          icon,
          label: text,
          detail: logDetail(l.action, d, who),
          source: isPilotEvent ? 'pilot' : 'admin',
          author: isPilotEvent ? who : null, // admin name filled in at render time
          target,
        }
      })

    // Merge all sources, sort newest-first, keep 15
    const all = [...logItems, ...unavailItems, ...removedItems]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 15)
    setEntries(all)
  }, [pilotId])

  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  // Tap on an entry → open the booking, or jump to the day it is about
  async function handleOpen(entry) {
    const t = entry.target
    if (!t) return
    if (t.type === 'booking') {
      const opened = onOpenBooking ? await onOpenBooking(t.id) : false
      if (opened) return
      if (t.date && onOpenDay) { onOpenDay(t.date); return }
      window.alert("Cette réservation n'existe plus.")
      return
    }
    if (t.type === 'day' && t.date && onOpenDay) onOpenDay(t.date)
  }

  if (!entries.length) return null

  return (
    <div style={{
      padding: '4px 12px 28px',
      maxWidth: 900,
      margin: '0 auto',
      boxSizing: 'border-box',
    }}>
      {/* Section header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
      }}>
        <span style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          color: '#64748b',
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
        }}>
          Derniers changements
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(100,116,139,0.2)' }} />
      </div>

      {/* Entry list */}
      <div style={{
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid rgba(100,116,139,0.15)',
      }}>
        {entries.map((e, i) => {
          const isAdmin = e.source === 'admin'
          const name = isAdmin ? (adminName || 'Admin') : e.author
          const tappable = !!e.target
          return (
            <div
              key={e.id}
              role={tappable ? 'button' : undefined}
              onClick={tappable ? () => handleOpen(e) : undefined}
              style={{
                padding: '8px 12px',
                background: i % 2 === 0 ? 'rgba(30,41,59,0.45)' : 'rgba(15,23,42,0.3)',
                textAlign: 'left',
                cursor: tappable ? 'pointer' : 'default',
                textTransform: 'none',
              }}
            >
              {/* Line 1: icon + label … who */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ flex: '0 0 auto', fontSize: '0.85rem' }}>{e.icon}</span>
                <span style={{ flex: 1, minWidth: 0, color: '#e2e8f0', fontWeight: 700, fontSize: '0.8rem', lineHeight: 1.3 }}>
                  {e.label}
                </span>
                <span style={{
                  flex: '0 0 auto',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  padding: '1px 7px',
                  borderRadius: 10,
                  background: isAdmin ? 'rgba(59,130,246,0.15)' : 'rgba(249,115,22,0.15)',
                  color: isAdmin ? '#93c5fd' : '#fdba74',
                  border: `1px solid ${isAdmin ? 'rgba(59,130,246,0.3)' : 'rgba(249,115,22,0.3)'}`,
                  whiteSpace: 'nowrap',
                }}>
                  {name}
                </span>
                {tappable && <span style={{ flex: '0 0 auto', color: '#64748b', fontSize: '1rem', lineHeight: 1 }}>›</span>}
              </div>

              {/* Line 2: full detail (wraps, never cut) */}
              {e.detail && (
                <div style={{ marginTop: 3, paddingLeft: 26, color: '#cbd5e1', fontSize: '0.76rem', lineHeight: 1.4, overflowWrap: 'anywhere' }}>
                  {e.detail}
                </div>
              )}

              {/* Line 3: when */}
              <div style={{ marginTop: 2, paddingLeft: 26, color: '#64748b', fontSize: '0.68rem', fontVariantNumeric: 'tabular-nums' }}>
                {fmtDT(e.at)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
