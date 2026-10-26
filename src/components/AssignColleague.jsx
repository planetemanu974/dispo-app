// AssignColleague.jsx — Modal to assign one colleague to a booking.
// Opens the native SMS app so the pilot sends the message from their own phone number.
// The colleague replies directly to the pilot by SMS — full trace on both sides.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Normalise phone to E.164 for sms: links (+262XXXXXXXXX)
function toE164(raw) {
  if (!raw) return ''
  const digits = raw.replace(/[\s\-().]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.startsWith('00')) return '+' + digits.slice(2)
  if (digits.startsWith('0')) return '+262' + digits.slice(1)
  return '+262' + digits
}

// Detect mobile device (sms: URI only works on mobile)
function isMobileDevice() {
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)
}

// Open the native SMS app (mobile) or return false (desktop — show fallback)
function openSMSApp(phone, message) {
  const e164 = toE164(phone)
  const encoded = encodeURIComponent(message)
  const link = document.createElement('a')
  link.href = `sms:${e164}?body=${encoded}`
  link.click()
  return isMobileDevice()
}

// ── AssignColleague ───────────────────────────────────────────────────────────
export default function AssignColleague({ booking, pilot, slotDate, slotTime, onClose, onAssigned }) {
  const [colleagues,   setColleagues]   = useState([])
  const [assignments,  setAssignments]  = useState([]) // existing assignments for this booking
  const [loading,      setLoading]      = useState(true)
  const [sending,      setSending]      = useState(null) // id of colleague being assigned
  const [freshSmsName, setFreshSmsName] = useState('') // always up-to-date sms_name from DB
  const [desktopSms,   setDesktopSms]   = useState(null) // { phone, message } shown as fallback on desktop

  useEffect(() => {
    loadData()
  }, [booking.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    setLoading(true)
    const [{ data: cols }, { data: assigns }, { data: freshPilot }] = await Promise.all([
      supabase.from('colleagues').select('*').eq('pilot_id', pilot.id).order('name'),
      supabase.from('booking_assignments').select('*, colleagues(name, phone)')
        .eq('booking_id', booking.id).order('created_at'),
      supabase.from('pilots').select('sms_name, name').eq('id', pilot.id).single(),
    ])
    setColleagues(cols || [])
    setAssignments(assigns || [])
    // Use fresh sms_name from DB — the prop may be stale if updated in Settings this session
    const name = freshPilot?.sms_name?.trim() || freshPilot?.name || pilot.name || 'votre partenaire'
    setFreshSmsName(name)
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

    // Build SMS message — sent from pilot's own phone via native SMS app
    const dateLabel = new Date(slotDate + 'T00:00:00').toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long',
    })
    const timeLabel = slotTime?.slice(0, 5) || ''
    const smsName = freshSmsName || pilot.sms_name?.trim() || pilot.name || 'votre partenaire'
    const smsMsg =
      `Dispo ${dateLabel} a ${timeLabel} pour ${smsName} ? ` +
      `Reponds "Ok dispo" ou "Non pas dispo".`

    // Open native SMS app — colleague sees pilot's real phone number, replies directly
    // On desktop the sms: URI does nothing — show fallback panel with number + message to copy
    const opened = openSMSApp(colleague.phone, smsMsg)
    if (!opened) {
      setDesktopSms({ phone: colleague.phone, e164: toE164(colleague.phone), message: smsMsg })
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

  // Pilot manually marks assignment after reading colleague's SMS reply
  async function handleManualStatus(assignment, newStatus) {
    await supabase
      .from('booking_assignments')
      .update({ status: newStatus, responded_at: new Date().toISOString() })
      .eq('id', assignment.id)
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
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
                {!assign || assign.status === 'refused' ? (
                  <button onClick={() => handleAssign(c)} disabled={!!sending}
                    style={{
                      padding: '7px 12px', background: '#1d4ed8', border: 'none', borderRadius: 8,
                      color: 'white', fontSize: '0.8rem', fontWeight: 700, cursor: isSending ? 'wait' : 'pointer',
                      opacity: (sending && !isSending) ? 0.4 : 1,
                    }}>
                    {isSending ? '…' : '📱 Envoyer par SMS'}
                  </button>
                ) : assign.status === 'pending' ? (<>
                  {/* Pilot marks manually after reading colleague's SMS reply */}
                  <button onClick={() => handleManualStatus(assign, 'accepted')}
                    style={{ padding: '5px 10px', background: '#16a34a', border: 'none', borderRadius: 7, color: 'white', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}>
                    ✅ Accepté
                  </button>
                  <button onClick={() => handleManualStatus(assign, 'refused')}
                    style={{ padding: '5px 10px', background: 'transparent', border: '1px solid #475569', borderRadius: 7, color: '#94a3b8', fontSize: '0.75rem', cursor: 'pointer' }}>
                    ❌ Refusé
                  </button>
                  <button onClick={() => handleRevoke(assign)}
                    style={{ padding: '3px 8px', background: 'transparent', border: 'none', color: '#475569', fontSize: '0.7rem', cursor: 'pointer' }}>
                    Annuler
                  </button>
                </>) : null /* accepted: show status chip only */}
              </div>
            </div>
          )
        })}

        {/* Desktop fallback — sms: URI doesn't work on computers */}
        {desktopSms && (
          <div style={{ marginTop: 16, padding: 14, background: '#0f172a', borderRadius: 10, border: '1px solid #f59e0b' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f59e0b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.5px' }}>
              📋 Envoyez ce SMS depuis votre téléphone
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 2 }}>Destinataire</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ flex: 1, background: '#1e293b', color: '#e2e8f0', padding: '6px 10px', borderRadius: 6, fontSize: '0.88rem', fontFamily: 'monospace' }}>
                  {desktopSms.phone}
                </code>
                <button onClick={() => navigator.clipboard?.writeText(desktopSms.phone)}
                  style={{ padding: '5px 10px', background: '#1e3a5f', border: 'none', borderRadius: 6, color: '#93c5fd', fontSize: '0.75rem', cursor: 'pointer' }}>
                  Copier
                </button>
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 2 }}>Message</div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, background: '#1e293b', color: '#e2e8f0', padding: '8px 10px', borderRadius: 6, fontSize: '0.82rem', lineHeight: 1.5 }}>
                  {desktopSms.message}
                </div>
                <button onClick={() => navigator.clipboard?.writeText(desktopSms.message)}
                  style={{ padding: '5px 10px', background: '#1e3a5f', border: 'none', borderRadius: 6, color: '#93c5fd', fontSize: '0.75rem', cursor: 'pointer', flexShrink: 0 }}>
                  Copier
                </button>
              </div>
            </div>
            <button onClick={() => setDesktopSms(null)}
              style={{ marginTop: 10, width: '100%', padding: '6px', background: 'transparent', border: '1px solid #334155', borderRadius: 6, color: '#64748b', fontSize: '0.75rem', cursor: 'pointer' }}>
              Fermer
            </button>
          </div>
        )}

        {/* Reminder */}
        <p style={{ marginTop: 12, fontSize: '0.75rem', color: '#475569', textAlign: 'center' }}>
          L'app SMS s'ouvre avec le message pré-rempli.<br />
          Envoyez depuis votre propre numéro — le collègue vous répond directement.<br />
          Marquez sa réponse ici avec ✅ ou ❌.
        </p>
      </div>
    </div>
  )
}
