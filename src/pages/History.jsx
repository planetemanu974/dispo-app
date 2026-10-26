// History.jsx — Audit log page: every action the pilot took, newest first.
// Accessible from the side menu. Helps recover from entry mistakes and track activity.

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ── Action metadata: icon + human-readable label per action key ───────────────
const ACTION_META = {
  booking_created:   { icon: '➕', label: 'Réservation créée',          color: '#22c55e' },
  booking_confirmed: { icon: '✅', label: 'Réservation confirmée',       color: '#3b82f6' },
  booking_cancelled: { icon: '❌', label: 'Réservation annulée',         color: '#ef4444' },
  booking_refused:   { icon: '🚫', label: 'Réservation refusée',         color: '#f97316' },
  booking_edited:    { icon: '✏️', label: 'Réservation modifiée',        color: '#a855f7' },
  slot_toggled:      { icon: '🔄', label: 'Disponibilité modifiée',      color: '#94a3b8' },
  sms_failed:        { icon: '⚠️', label: 'SMS non envoyé',              color: '#eab308' },
}

function actionMeta(action) {
  return ACTION_META[action] || { icon: '📝', label: action, color: '#64748b' }
}

// Format a UTC timestamp to local Réunion time (UTC+4)
function formatTs(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString('fr-FR', {
    timeZone: 'Indian/Reunion',
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function History({ pilot, onBack }) {
  const [logs, setLogs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage]       = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const PAGE_SIZE = 40

  const loadLogs = useCallback(async (pageIndex = 0) => {
    setLoading(true)
    const from = pageIndex * PAGE_SIZE
    const to   = from + PAGE_SIZE - 1   // inclusive

    const { data, error } = await supabase
      .from('activity_log')
      .select('*')
      .eq('pilot_id', pilot.id)
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) {
      console.error('[History] load error:', error)
      setLoading(false)
      return
    }

    if (pageIndex === 0) {
      setLogs(data || [])
    } else {
      setLogs(prev => [...prev, ...(data || [])])
    }
    setHasMore((data || []).length === PAGE_SIZE)
    setLoading(false)
  }, [pilot.id])

  useEffect(() => { loadLogs(0) }, [loadLogs])

  function loadMore() {
    const next = page + 1
    setPage(next)
    loadLogs(next)
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100dvh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#1e293b', borderBottom: '1px solid #334155', position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>
          ←
        </button>
        <span style={{ fontSize: '1rem', fontWeight: 700, color: '#e2e8f0' }}>📋 Historique</span>
      </header>

      {/* Subtitle */}
      <div style={{ padding: '10px 16px 4px', fontSize: '0.78rem', color: '#64748b' }}>
        Toutes vos actions — du plus récent au plus ancien.
      </div>

      {/* Log list */}
      <div style={{ padding: '4px 0 40px' }}>
        {loading && logs.length === 0 && (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#64748b' }}>
            Chargement…
          </div>
        )}

        {!loading && logs.length === 0 && (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#64748b' }}>
            Aucune action enregistrée pour l'instant.
          </div>
        )}

        {logs.map((log, i) => {
          const meta = actionMeta(log.action)
          const d    = log.details || {}

          return (
            <div key={log.id}
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid #1e293b',
                background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
              }}
            >
              {/* Row 1: icon + action + timestamp */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ fontSize: 18, lineHeight: 1.2, flexShrink: 0 }}>{meta.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem', color: meta.color }}>
                      {meta.label}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: '#475569', flexShrink: 0 }}>
                      {formatTs(log.created_at)}
                    </span>
                  </div>

                  {/* Row 2: details */}
                  <div style={{ marginTop: 3, fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.5 }}>
                    {d.booking_ref && (
                      <span style={{ marginRight: 10, color: '#e2e8f0', fontFamily: 'monospace' }}>
                        #{d.booking_ref}
                      </span>
                    )}
                    {d.contact_name && (
                      <span style={{ marginRight: 10 }}>👤 {d.contact_name}</span>
                    )}
                    {d.contact_phone && (
                      <span style={{ marginRight: 10 }}>📞 {d.contact_phone}</span>
                    )}
                    {d.slot_date && (
                      <span style={{ marginRight: 10 }}>
                        📅 {new Date(d.slot_date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
                        {d.slot_time && ` ${d.slot_time.slice(0, 5)}`}
                      </span>
                    )}
                    {d.pax_count > 0 && (
                      <span style={{ marginRight: 10 }}>🪂 {d.pax_count} pax</span>
                    )}
                    {d.old_phone && (
                      <span style={{ color: '#ef4444', marginRight: 6 }}>
                        📞 {d.old_phone} →
                      </span>
                    )}
                    {d.new_phone && (
                      <span style={{ color: '#22c55e', marginRight: 10 }}>
                        {d.new_phone}
                      </span>
                    )}
                    {d.is_available !== undefined && (
                      <span>
                        {d.is_available ? '🟢 Rendu disponible' : '🔴 Rendu indisponible'}
                        {d.slot_time && ` — créneau ${d.slot_time.slice(0, 5)}`}
                      </span>
                    )}
                    {d.note && (
                      <span style={{ color: '#eab308' }}>{d.note}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {/* Load more */}
        {hasMore && (
          <div style={{ padding: '16px', textAlign: 'center' }}>
            <button onClick={loadMore} disabled={loading}
              style={{ padding: '9px 24px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: '0.85rem', cursor: 'pointer' }}>
              {loading ? 'Chargement…' : 'Voir plus'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
