// ActivityFeed.jsx
// Live feed of recent planning changes shown below the admin calendar.
// Merges activity_log (admin actions) + fixed_pilot_unavailability inserts
// (pilots marking themselves unavailable from their own planning page).
// Auto-refreshes silently every 30 seconds.

import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ── Human-readable labels for activity_log action keys ───────────────────────
const ACTION_LABELS = {
  booking_created:   { icon: '📋', text: 'Réservation créée' },
  booking_confirmed: { icon: '✅', text: 'Réservation confirmée' },
  booking_refused:   { icon: '❌', text: 'Réservation refusée' },
  booking_cancelled: { icon: '🚫', text: 'Réservation annulée' },
  booking_edited:    { icon: '✏️', text: 'Réservation modifiée' },
  slot_toggled:      { icon: '🔄', text: 'Créneau' },
  bulk_slot_toggle:  { icon: '🔄', text: 'Créneaux (lot)' },
  bulk_slot_delete:  { icon: '🗑️', text: 'Créneaux supprimés' },
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
function logDetail(action, details = {}) {
  const parts = []

  // Slot toggle: show date + time + what changed (ouvert/fermé)
  if (action === 'slot_toggled') {
    if (details.slot_date) parts.push(fmtDate(details.slot_date))
    if (details.slot_time) parts.push(details.slot_time.slice(0, 5))
    if (details.is_available === true)  parts.push('→ ouvert')
    if (details.is_available === false) parts.push('→ fermé')
    return parts.join(' · ')
  }

  // Bulk slot toggle: show count + what changed
  if (action === 'bulk_slot_toggle') {
    const n = details.count || (details.slot_ids?.length ?? '?')
    const etat = details.is_available === true ? 'ouverts' : details.is_available === false ? 'fermés' : ''
    return `${n} créneau${n > 1 ? 'x' : ''} ${etat}`.trim()
  }

  // Bulk slot delete: show count
  if (action === 'bulk_slot_delete') {
    const n = details.count || (details.slot_ids?.length ?? '?')
    return `${n} créneau${n > 1 ? 'x' : ''} supprimé${n > 1 ? 's' : ''}`
  }

  // Booking actions: contact name + date + time + pax + status change
  if (details.contact_name) parts.push(details.contact_name)
  if (details.slot_date)    parts.push(fmtDate(details.slot_date))
  if (details.slot_time)    parts.push(details.slot_time.slice(0, 5))
  if (details.pax_count)    parts.push(`${details.pax_count} pax`)
  if (details.new_status)   parts.push(`→ ${details.new_status}`)
  return parts.join(' · ')
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ActivityFeed({ pilotId }) {
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

    // 1. Admin's own activity log (most recent 12 entries)
    const { data: logs } = await supabase
      .from('activity_log')
      .select('id, action, details, created_at')
      .eq('pilot_id', pilotId)
      .order('created_at', { ascending: false })
      .limit(12)

    // 2. Colleague unavailability inserts — sorted by created_at
    //    (captures when a pilot marks themselves unavailable from their planning page)
    const { data: unavails } = await supabase
      .from('fixed_pilot_unavailability')
      .select('id, start_date, end_date, slot_time, created_at, colleagues(name)')
      .eq('pilot_id', pilotId)
      .order('created_at', { ascending: false })
      .limit(12)

    const logItems = (logs || []).map(l => {
      const d = l.details || {}
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
      return {
        id: `log-${l.id}`,
        at: l.created_at,
        icon,
        label: text,
        detail: logDetail(l.action, d),
        source: 'admin',
        author: null, // filled in render using adminName state
      }
    })

    const unavailItems = (unavails || []).map(u => {
      const name = u.colleagues?.name || 'Pilote'
      const range =
        u.start_date === u.end_date
          ? fmtDate(u.start_date)
          : `${fmtDate(u.start_date)} → ${fmtDate(u.end_date)}`
      const time = u.slot_time ? ` · ${u.slot_time.slice(0, 5)}` : ''
      return {
        id: `unavail-${u.id}`,
        at: u.created_at,
        icon: '🚫',
        label: 'Indisponibilité',
        detail: range + time,
        source: 'pilot',
        author: name, // pilot's name from the colleagues join
      }
    })

    // Merge, sort newest-first, keep 15
    const all = [...logItems, ...unavailItems]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 15)
    setEntries(all)
  }, [pilotId])

  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  if (!entries.length) return null

  return (
    <div style={{
      padding: '4px 12px 28px',
      maxWidth: 900,
      margin: '0 auto',
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
        {entries.map((e, i) => (
          <div
            key={e.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 12px',
              background: i % 2 === 0
                ? 'rgba(30,41,59,0.45)'
                : 'rgba(15,23,42,0.3)',
              fontSize: '0.76rem',
              lineHeight: 1.4,
            }}
          >
            {/* Timestamp */}
            <span style={{
              flex: '0 0 auto',
              color: '#64748b',
              fontVariantNumeric: 'tabular-nums',
              minWidth: 145,
              fontSize: '0.72rem',
            }}>
              {fmtDT(e.at)}
            </span>

            {/* Icon + label */}
            <span style={{ flex: '0 0 auto' }}>{e.icon}</span>
            <span style={{ color: '#cbd5e1', fontWeight: 600 }}>{e.label}</span>

            {/* Detail */}
            {e.detail && (
              <span style={{ color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                — {e.detail}
              </span>
            )}

            {/* Author badge */}
            {(() => {
              const name = e.source === 'admin' ? (adminName || 'Admin') : e.author
              const isAdmin = e.source === 'admin'
              return (
                <span style={{
                  flex: '0 0 auto',
                  marginLeft: 'auto',
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
              )
            })()}
          </div>
        ))}
      </div>
    </div>
  )
}
