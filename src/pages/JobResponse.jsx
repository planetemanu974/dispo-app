// JobResponse.jsx — Public page for a colleague to accept or refuse a job.
// No authentication required. Accessible at /job/:token
// The pilot sends this link via SMS when assigning a colleague to a booking.

import { useEffect, useState } from 'react'
import { useParams }           from 'react-router-dom'
import { supabase }            from '../lib/supabase'

// Format a date string (YYYY-MM-DD) in French, Réunion timezone
function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', {
    timeZone: 'Indian/Reunion',
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

// Format time (HH:MM:SS or HH:MM)
function formatTime(t) {
  if (!t) return ''
  return t.slice(0, 5)
}

export default function JobResponse() {
  const { token } = useParams()

  const [job,      setJob]      = useState(null)   // assignment row
  const [status,   setStatus]   = useState('idle') // 'idle'|'loading'|'submitting'|'done'|'error'
  const [response, setResponse] = useState(null)   // 'accepted'|'refused'
  const [errMsg,   setErrMsg]   = useState('')

  useEffect(() => {
    if (!token) return
    setStatus('loading')
    supabase
      .from('booking_assignments')
      .select('id, status, slot_date, slot_time, pilot_name, pilot_phone, colleague_id, responded_at')
      .eq('token', token)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setErrMsg('Lien invalide ou expiré.')
          setStatus('error')
          return
        }
        setJob(data)
        // If already answered, go straight to done view
        if (data.status !== 'pending') {
          setResponse(data.status)
          setStatus('done')
        } else {
          setStatus('idle')
        }
      })
  }, [token])

  async function handleRespond(choice) {
    if (!job || status === 'submitting') return
    setStatus('submitting')

    const { error } = await supabase
      .from('booking_assignments')
      .update({
        status:       choice,
        responded_at: new Date().toISOString(),
      })
      .eq('token', token)

    if (error) {
      setErrMsg('Erreur lors de l\'envoi. Réessayez.')
      setStatus('idle')
      return
    }

    setResponse(choice)
    setStatus('done')

    // Notify the pilot via SMS (via Edge Function)
    try {
      const dateLabel = formatDate(job.slot_date)
      const timeLabel = formatTime(job.slot_time)
      const choiceLabel = choice === 'accepted' ? 'accepté' : 'refusé'
      const smsMsg = `Bonjour, votre collègue a ${choiceLabel} la mission du ${dateLabel} à ${timeLabel}. App DISPO/PAS DISPO`
      if (job.pilot_phone) {
        await supabase.functions.invoke('send-sms', {
          body: { to: job.pilot_phone, message: smsMsg },
        })
      }
    } catch (_) {
      // Non-fatal: pilot SMS failure doesn't affect colleague's response
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const cardStyle = {
    minHeight: '100dvh',
    background: '#0f172a',
    color: '#e2e8f0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 20px',
  }

  const boxStyle = {
    background: '#1e293b',
    borderRadius: 16,
    padding: '28px 24px',
    maxWidth: 420,
    width: '100%',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  }

  if (status === 'loading') {
    return (
      <div style={cardStyle}>
        <div style={{ color: '#64748b', fontSize: '1rem' }}>Chargement…</div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div style={cardStyle}>
        <div style={boxStyle}>
          <div style={{ fontSize: '2rem', marginBottom: 12, textAlign: 'center' }}>❌</div>
          <p style={{ textAlign: 'center', color: '#f87171' }}>{errMsg}</p>
          <p style={{ textAlign: 'center', color: '#64748b', fontSize: '0.85rem', marginTop: 8 }}>
            Ce lien est à usage unique ou n'existe plus.
          </p>
        </div>
      </div>
    )
  }

  if (status === 'done') {
    const accepted = response === 'accepted'
    return (
      <div style={cardStyle}>
        <div style={boxStyle}>
          <div style={{ fontSize: '3rem', marginBottom: 12, textAlign: 'center' }}>
            {accepted ? '✅' : '❌'}
          </div>
          <h2 style={{ textAlign: 'center', margin: '0 0 8px', fontSize: '1.2rem', color: accepted ? '#4ade80' : '#f87171' }}>
            {accepted ? 'Mission acceptée !' : 'Mission refusée'}
          </h2>
          <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.88rem', margin: 0 }}>
            {accepted
              ? `Le pilote a été prévenu. À bientôt sur la plage !`
              : `Pas de problème. Le pilote cherchera quelqu'un d'autre.`}
          </p>
          {job && (
            <div style={{ marginTop: 20, padding: '12px 16px', background: '#0f172a', borderRadius: 10, fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.7 }}>
              📅 {formatDate(job.slot_date)}<br />
              🕐 {formatTime(job.slot_time)}<br />
              📍 Plage de l'Étang-Salé / Kelonia, Saint-Leu
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Main: job offer ──────────────────────────────────────────────────────────
  return (
    <div style={cardStyle}>
      <div style={boxStyle}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🪂</div>
          <h1 style={{ margin: '0 0 4px', fontSize: '1.2rem', fontWeight: 700, color: '#e2e8f0' }}>
            Proposition de vol
          </h1>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.82rem' }}>
            {job?.pilot_name || 'Un pilote'} vous propose une mission
          </p>
        </div>

        {/* Job details */}
        {job && (
          <div style={{ background: '#0f172a', borderRadius: 12, padding: '16px', marginBottom: 24, lineHeight: 1.8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: '1.2rem' }}>📅</span>
              <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#e2e8f0' }}>
                {formatDate(job.slot_date)}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: '1.2rem' }}>🕐</span>
              <span style={{ fontSize: '0.95rem', color: '#cbd5e1' }}>
                Décollage prévu à {formatTime(job.slot_time)}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.2rem' }}>📍</span>
              <span style={{ fontSize: '0.88rem', color: '#94a3b8' }}>
                Plage de Kelonia, Saint-Leu — Réunion
              </span>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            onClick={() => handleRespond('accepted')}
            disabled={status === 'submitting'}
            style={{
              padding: '14px',
              background: '#16a34a',
              border: 'none',
              borderRadius: 10,
              color: 'white',
              fontSize: '1rem',
              fontWeight: 700,
              cursor: 'pointer',
              opacity: status === 'submitting' ? 0.6 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            ✅ J'accepte cette mission
          </button>

          <button
            onClick={() => handleRespond('refused')}
            disabled={status === 'submitting'}
            style={{
              padding: '14px',
              background: 'transparent',
              border: '1px solid #475569',
              borderRadius: 10,
              color: '#94a3b8',
              fontSize: '0.95rem',
              fontWeight: 600,
              cursor: 'pointer',
              opacity: status === 'submitting' ? 0.6 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            ❌ Je ne suis pas disponible
          </button>
        </div>

        {/* Contact pilot */}
        {job?.pilot_phone && (
          <p style={{ textAlign: 'center', marginTop: 18, fontSize: '0.78rem', color: '#475569' }}>
            Une question ? Contactez {job.pilot_name || 'le pilote'} :{' '}
            <span style={{ color: '#94a3b8', userSelect: 'all' }}>{job.pilot_phone}</span>
          </p>
        )}
      </div>
    </div>
  )
}
