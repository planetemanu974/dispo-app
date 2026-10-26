// AssignColleague.jsx — Modal to assign one colleague to a booking.
// Shown inside the booking detail panel when the pilot wants to call for help.
// Sends an SMS to the colleague with a link they can use to accept or refuse.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Base URL for the job response page
const APP_URL = import.meta.env.VITE_APP_URL || 'https://dispo-app-six.vercel.app'

async function sendSMS(to, message) {
  try {
    const { data, error } = await supabase.functions.invoke('send-sms', {
      body: { to, message },
    })
    if (error) console.error('[AssignColleague] SMS error:', error)
    return { data, error }
  } catch (err) {
    return { error: err }
  }
}

// ── AssignColleague ───────────────────────────────────────────────────────────
export default function AssignColleague({ booking, pilot, slotDate, slotTime, onClose, onAssigned }) {
  const [colleagues,   setColleagues]   = useState([])
  const [assignments,  setAssignments]  = useState([]) // existing assignments for this booking
  const [loading,      setLoading]      = useState(true)
  const [sending,      setSending]      = useState(null) // id of colleague being assigned

  useEffect(() => {
    loadData()
  }, [booking.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    setLoading(true)
    const [{ data: cols }, { data: assigns }] = await Promise.all([
      supabase.from('colleagues').select('*').eq('pilot_id', pilot.id).order('name'),
      supabase.from('booking_assignments').select('*, colleagues(name, phone)')
        .eq('booking_id', booking.id).order('created_at'),
    ])
    setColleagues(cols || [])
    setAssignments(assigns || [])
    setLoading(false)
  }

  // Check if a colleague is already assigned (pending or accepted)
  function getAssignment(colleagueId) {
    return assignments.find(a => a.colleague_id === colleagueId)
  }

  async function handleAssign(colleague) {
    if (sending) return
    const existing = getAssignment(colleague.id)
    if (existing && existing.status !== 'refused') return // already active

    setSending(colleague.id)

    // If previously refused, delete old assignment before re-assigning
    if (existing?.status === 'refused') {
      await supabase.from('booking_assignments').delete().eq('id', existing.id)
    }

    // Create assignment row
    const { data: assign, error: assignErr } = await supabase
      .from('booking_assignments')
      .insert({
        booking_id:   booking.id,
        colleague_id: colleague.id,
        pilot_id:     pilot.id,
        slot_date:    slotDate,
        slot_time:    slotTime,
        pilot_name:   pilot.name,
        pilot_phone:  pilot.phone || '',
      })
      .select()
      .single()

    if (assignErr || !assign) {
      alert('Erreur lors de la création de la mission. Réessayez.')
      setSending(null)
      return
    }

    // Build SMS
    const dateLabel = new Date(slotDate + 'T00:00:00').toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long',
    })
    const timeLabel = slotTime?.slice(0, 5) || ''
    const responseUrl = `${APP_URL}/job/${assign.token}`
    const smsMsg =
      `Bonjour ${colleague.name}, ${pilot.name} vous propose un vol biplace ` +
      `le ${dateLabel} a ${timeLabel} a Kelonia Saint-Leu. ` +
      `Acceptez ou refusez ici : ${responseUrl}`

    const { error: smsErr } = await sendSMS(colleague.phone, smsMsg)

    if (smsErr) {
      alert(`Mission créée mais le SMS n'a pas pu être envoyé à ${colleague.name}.\nNuméro : ${colleague.phone}`)
    }

    await loadData()
    setSending(null)
    if (onAssigned) onAssigned()
  }

  async function handleRevoke(assignment) {
    if (!window.confirm(`Annuler la mission de ${assignment.colleagues?.name} ?`)) return
    await supabase.from('booking_assignments').delete().eq('id', assignment.id)
    await loadData()
    if (onAssigned) onAssigned()
  }

  // ── Status chip ─────────────────────────────────────────────────────────────
  function StatusChip({ status }) {
    const map = {
      pending:  { bg: '#1e3a5f', color: '#93c5fd', label: 'En attente' },
      accepted: { bg: '#14532d', color: '#86efac', label: 'Accepté ✅' },
      refused:  { bg: '#450a0a', color: '#fca5a5', label: 'Refusé ❌' },
    }
    const s = map[status] || map.pending
    return (
      <span style={{ padding: '2px 8px', borderRadius: 6, background: s.bg, color: s.color, fontSize: '0.75rem', fontWeight: 600 }}>
        {s.label}
      </span>
    )
  }

  const dateLabel = slotDate
    ? new Date(slotDate + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    : ''

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'flex-end' }}>
      {/* Overlay */}
      <div onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />

      {/* Drawer */}
      <div style={{
        position: 'relative', width: '100%', maxHeight: '85dvh',
        background: '#1e293b', borderRadius: '16px 16px 0 0',
        padding: '20px 16px 32px', overflowY: 'auto',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
      }}>
        {/* Handle */}
        <div style={{ width: 40, height: 4, background: '#334155', borderRadius: 2, margin: '0 auto 16px' }} />

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#e2e8f0' }}>
            🧑‍✈️ Appeler un collègue en renfort
          </h2>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer', padding: 4 }}>✕</button>
        </div>
        <p style={{ margin: '0 0 18px', fontSize: '0.8rem', color: '#64748b' }}>
          {dateLabel}{slotTime ? ` à ${slotTime.slice(0, 5)}` : ''} — {booking.contact_name}
        </p>

        {loading && <div style={{ color: '#64748b', padding: '12px 0' }}>Chargement…</div>}

        {!loading && colleagues.length === 0 && (
          <p style={{ color: '#64748b', fontSize: '0.88rem' }}>
            Vous n'avez aucun collègue enregistré.<br />
            Ajoutez-en dans les Paramètres → Mes collègues.
          </p>
        )}

        {/* Colleague list */}
        {colleagues.map(c => {
          const assign = getAssignment(c.id)
          const isSending = sending === c.id
          const isActive  = assign && assign.status !== 'refused'

          return (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px', borderRadius: 10, marginBottom: 8,
              background: '#0f172a', border: '1px solid #1e293b',
            }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#1e3a5f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0 }}>
                🧑‍✈️
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#e2e8f0' }}>{c.name}</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{c.phone}</div>
                {c.notes && <div style={{ fontSize: '0.72rem', color: '#475569' }}>{c.notes}</div>}
                {assign && (
                  <div style={{ marginTop: 4 }}>
                    <StatusChip status={assign.status} />
                  </div>
                )}
              </div>

              {/* Action button */}
              <div style={{ flexShrink: 0 }}>
                {!assign || assign.status === 'refused' ? (
                  <button onClick={() => handleAssign(c)} disabled={!!sending}
                    style={{
                      padding: '7px 12px', background: '#1d4ed8', border: 'none', borderRadius: 8,
                      color: 'white', fontSize: '0.8rem', fontWeight: 700, cursor: isSending ? 'wait' : 'pointer',
                      opacity: (sending && !isSending) ? 0.4 : 1,
                    }}>
                    {isSending ? '…' : '📩 Envoyer'}
                  </button>
                ) : assign.status === 'pending' ? (
                  <button onClick={() => handleRevoke(assign)}
                    style={{ padding: '7px 12px', background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: '0.78rem', cursor: 'pointer' }}>
                    Annuler
                  </button>
                ) : null /* accepted: show status chip only */}
              </div>
            </div>
          )
        })}

        {/* Reminder */}
        <p style={{ marginTop: 12, fontSize: '0.75rem', color: '#475569', textAlign: 'center' }}>
          Le collègue reçoit un SMS avec un lien pour accepter ou refuser.<br />
          Vous recevez un SMS dès qu'il répond.
        </p>
      </div>
    </div>
  )
}
