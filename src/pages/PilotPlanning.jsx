// PilotPlanning.jsx
// Public page for fixed pilots — accessible via a unique token link (no login required).
// Shows the week's assignments and lets the pilot mark unavailability:
//   • single slot (specific time on a day)
//   • full day
//   • date range (e.g. vacations)

import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/pilot-planning`

// Supabase Edge Functions require a Bearer token even for public (token-based) pages.
// We pass the anon key — the function itself uses the service role key internally.
const AUTH_HEADERS = {
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
}

// ── helpers ──────────────────────────────────────────────────────────────────

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const FULL_DAY_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']

function getMondayOf(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

// UTC-safe ISO string — uses local date parts to avoid UTC shift in UTC+4 (La Réunion).
// toISOString() returns UTC, which shifts the date by -1 day when local time is before midnight UTC.
function toISO(date) {
  const y  = date.getFullYear()
  const m  = String(date.getMonth() + 1).padStart(2, '0')
  const d  = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function formatDate(isoStr) {
  const d = new Date(isoStr + 'T00:00:00')
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

function formatTime(timeStr) {
  if (!timeStr) return null
  return timeStr.slice(0, 5)
}

// Is date (YYYY-MM-DD) covered by unavailability entry?
function isDateUnavailable(dateStr, unavailList) {
  return unavailList.some(u =>
    u.start_date <= dateStr && dateStr <= u.end_date && u.slot_time === null
  )
}

function isSlotUnavailable(dateStr, slotTime, unavailList) {
  return unavailList.some(u => {
    if (u.start_date <= dateStr && dateStr <= u.end_date) {
      if (u.slot_time === null) return true          // full-day covers any slot
      if (u.slot_time && slotTime && u.slot_time.slice(0,5) === slotTime.slice(0,5)) return true
    }
    return false
  })
}

// ── main component ────────────────────────────────────────────────────────────

export default function PilotPlanning() {
  const { token } = useParams()

  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [colleague, setColleague]     = useState(null)
  const [weekStart, setWeekStart]     = useState(() => toISO(getMondayOf(new Date())))
  const [assignments, setAssignments] = useState([])
  const [unavailability, setUnavailability] = useState([])

  // Modal state for adding unavailability
  const [modal, setModal]   = useState(null)   // { type: 'slot'|'day'|'range', date?, slotTime? }
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd]     = useState('')
  const [saving, setSaving] = useState(false)

  // ── fetch planning data ───────────────────────────────────────────────────
  const fetchPlanning = useCallback(async (week) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${FUNCTION_URL}?token=${token}&week=${week}`, {
        headers: AUTH_HEADERS,
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Erreur réseau'); return }
      setColleague(data.colleague)
      setAssignments(data.assignments || [])
      setUnavailability(data.unavailability || [])
    } catch (e) {
      setError('Impossible de charger le planning.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchPlanning(weekStart) }, [fetchPlanning, weekStart])

  // ── week navigation ───────────────────────────────────────────────────────
  function prevWeek() { setWeekStart(toISO(addDays(new Date(weekStart), -7))) }
  function nextWeek() { setWeekStart(toISO(addDays(new Date(weekStart), +7))) }
  function goToday()  { setWeekStart(toISO(getMondayOf(new Date()))) }

  // ── unavailability actions ────────────────────────────────────────────────
  async function addUnavail(body) {
    setSaving(true)
    try {
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
        body: JSON.stringify({ token, action: 'add_unavail', ...body }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error || 'Erreur'); return }
      await fetchPlanning(weekStart)
    } finally {
      setSaving(false)
      setModal(null)
    }
  }

  async function removeUnavail(id) {
    setSaving(true)
    try {
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
        body: JSON.stringify({ token, action: 'remove_unavail', id }),
      })
      if (res.ok) await fetchPlanning(weekStart)
    } finally {
      setSaving(false)
    }
  }

  // ── build week days ───────────────────────────────────────────────────────
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(new Date(weekStart + 'T00:00:00'), i)
    return toISO(date)
  })

  // Group assignments by day
  const assignmentsByDay = {}
  for (const a of assignments) {
    const d = a.slot_date || a.bookings?.pilot_slots?.slot_date
    if (!d) continue
    if (!assignmentsByDay[d]) assignmentsByDay[d] = []
    assignmentsByDay[d].push(a)
  }

  // ── render: loading / error ───────────────────────────────────────────────
  if (loading) return (
    <div style={styles.loadingWrap}>
      <div style={styles.spinner} />
      <p style={{ color: '#94a3b8', marginTop: 16 }}>Chargement du planning…</p>
    </div>
  )

  if (error) return (
    <div style={styles.errorWrap}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
      <p style={{ color: '#f87171', fontSize: 15, textAlign: 'center' }}>{error}</p>
    </div>
  )

  const todayStr = toISO(new Date())
  const weekLabel = `${formatDate(weekStart)} – ${formatDate(toISO(addDays(new Date(weekStart), 6)))}`

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTop}>
          {/* App logo */}
          <div style={styles.logoWrap}>
            <img src="/logo-icon.png" alt="Logo" style={{ height: 40, display: 'block' }} />
          </div>
          <div>
            <div style={styles.appName}>DISPO / PAS DISPO</div>
            <div style={styles.pilotName}>{colleague?.name}</div>
            <div style={styles.subtitle}>Planning personnel</div>
          </div>
        </div>

        {/* Week navigation */}
        <div style={styles.weekNav}>
          <button style={styles.navBtn} onClick={prevWeek}>‹</button>
          <button style={styles.weekLabel} onClick={goToday}>{weekLabel}</button>
          <button style={styles.navBtn} onClick={nextWeek}>›</button>
        </div>
      </div>

      {/* "Pas dispo" vacation range button */}
      <div style={{ padding: '10px 16px 0' }}>
        <button
          style={styles.vacationBtn}
          onClick={() => { setRangeStart(''); setRangeEnd(''); setModal({ type: 'range' }) }}
        >
          🏖️ Marquer indispo sur une période
        </button>
      </div>

      {/* Days */}
      <div style={styles.daysWrap}>
        {weekDays.map((dateStr, i) => {
          const isToday = dateStr === todayStr
          const dayAssignments = assignmentsByDay[dateStr] || []
          const fullDayUnavail = unavailability.filter(u =>
            u.start_date <= dateStr && dateStr <= u.end_date && u.slot_time === null
          )
          const slotUnavail = unavailability.filter(u =>
            u.start_date <= dateStr && dateStr <= u.end_date && u.slot_time !== null
          )

          return (
            <div key={dateStr} style={{
              ...styles.dayCard,
              ...(isToday ? styles.dayCardToday : {}),
            }}>
              {/* Day header */}
              <div style={styles.dayHeader}>
                <span style={{ ...styles.dayName, ...(isToday ? { color: '#60a5fa' } : {}) }}>
                  {FULL_DAY_LABELS[i]}
                </span>
                <span style={styles.dayDate}>{formatDate(dateStr)}</span>
                {/* Full-day indispo toggle */}
                {fullDayUnavail.length > 0 ? (
                  <button
                    style={styles.indispoChip}
                    onClick={() => fullDayUnavail.forEach(u => removeUnavail(u.id))}
                    title="Cliquer pour annuler"
                  >
                    🚫 Indispo — annuler
                  </button>
                ) : (
                  <button
                    style={styles.markDayBtn}
                    onClick={() => addUnavail({ start_date: dateStr, end_date: dateStr })}
                  >
                    + Indispo ce jour
                  </button>
                )}
              </div>

              {/* Assignments */}
              {dayAssignments.length === 0 && fullDayUnavail.length === 0 && slotUnavail.length === 0 && (
                <div style={styles.emptyDay}>Aucun vol prévu</div>
              )}

              {fullDayUnavail.length > 0 && (
                <div style={styles.fullDayBanner}>
                  🚫 Journée indisponible
                </div>
              )}

              {dayAssignments.map(a => {
                const slot = a.bookings?.pilot_slots
                const slotTime = a.slot_time || slot?.slot_time
                const paxCount = a.bookings?.passengers?.length || '?'
                const unavailForSlot = slotUnavail.find(u =>
                  u.slot_time && slotTime && u.slot_time.slice(0,5) === slotTime.slice(0,5)
                )
                const isSlotUnavail = !!unavailForSlot || fullDayUnavail.length > 0

                return (
                  <div key={a.id} style={{ ...styles.assignCard, ...(isSlotUnavail ? styles.assignCardUnavail : {}) }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={styles.slotTime}>🕐 {formatTime(slotTime) || '—'}</span>
                      <span style={styles.paxBadge}>👤×{paxCount}</span>
                    </div>
                    {isSlotUnavail && (
                      <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>
                        ⚠️ Tu es indisponible sur ce créneau
                      </div>
                    )}
                    {!isSlotUnavail && slotTime && (
                      <button
                        style={styles.markSlotBtn}
                        onClick={() => addUnavail({ start_date: dateStr, end_date: dateStr, slot_time: slotTime })}
                      >
                        Marquer indispo ce créneau
                      </button>
                    )}
                    {unavailForSlot && (
                      <button
                        style={styles.cancelSlotBtn}
                        onClick={() => removeUnavail(unavailForSlot.id)}
                      >
                        ↩ Annuler l'indispo
                      </button>
                    )}
                  </div>
                )
              })}

              {/* Slot-level indispo without assignment */}
              {slotUnavail.filter(u => !dayAssignments.some(a => {
                const st = a.slot_time || a.bookings?.pilot_slots?.slot_time
                return st && u.slot_time && st.slice(0,5) === u.slot_time.slice(0,5)
              })).map(u => (
                <div key={u.id} style={styles.orphanSlotUnavail}>
                  <span>🚫 {formatTime(u.slot_time)}</span>
                  <button style={styles.cancelSmallBtn} onClick={() => removeUnavail(u.id)}>✕</button>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* Existing unavailability ranges */}
      {unavailability.filter(u => {
        // show only multi-day ranges (more than 1 day)
        return u.start_date !== u.end_date
      }).length > 0 && (
        <div style={styles.rangesSection}>
          <div style={styles.sectionTitle}>📅 Périodes d'indisponibilité</div>
          {unavailability.filter(u => u.start_date !== u.end_date).map(u => (
            <div key={u.id} style={styles.rangeRow}>
              <span style={{ color: '#f87171' }}>
                🚫 {formatDate(u.start_date)} → {formatDate(u.end_date)}
                {u.slot_time ? ` (${formatTime(u.slot_time)})` : ' (toute la journée)'}
              </span>
              <button style={styles.cancelSmallBtn} onClick={() => removeUnavail(u.id)}>✕ Supprimer</button>
            </div>
          ))}
        </div>
      )}

      {/* Modal: date range */}
      {modal?.type === 'range' && (
        <div style={styles.overlay} onClick={() => setModal(null)}>
          <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
            <div style={styles.modalTitle}>🏖️ Période d'indisponibilité</div>
            <label style={styles.label}>Du</label>
            <input
              type="date"
              value={rangeStart}
              onChange={e => setRangeStart(e.target.value)}
              style={styles.dateInput}
            />
            <label style={styles.label}>Au</label>
            <input
              type="date"
              value={rangeEnd}
              onChange={e => setRangeEnd(e.target.value)}
              min={rangeStart}
              style={styles.dateInput}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button style={styles.cancelBtn} onClick={() => setModal(null)}>Annuler</button>
              <button
                style={{ ...styles.confirmBtn, opacity: (!rangeStart || !rangeEnd) ? .5 : 1 }}
                disabled={!rangeStart || !rangeEnd || saving}
                onClick={() => addUnavail({ start_date: rangeStart, end_date: rangeEnd })}
              >
                {saving ? '…' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── styles ────────────────────────────────────────────────────────────────────
const styles = {
  page: {
    minHeight: '100dvh',
    background: '#0a0f1a',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    paddingBottom: 40,
  },
  loadingWrap: {
    minHeight: '100dvh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', background: '#0a0f1a',
  },
  spinner: {
    width: 36, height: 36, border: '3px solid #1e3a5f',
    borderTop: '3px solid #60a5fa', borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  errorWrap: {
    minHeight: '100dvh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', background: '#0a0f1a',
    padding: 24,
  },
  header: {
    background: 'linear-gradient(135deg, #0f1f3d 0%, #1a2f5a 100%)',
    padding: '20px 16px 16px',
    borderBottom: '1px solid #1e3a5f',
  },
  headerTop: {
    display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16,
  },
  logoWrap: { flexShrink: 0 },
  appName: { fontSize: 11, fontWeight: 800, color: '#60a5fa', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 2 },
  pilotName: { fontSize: 22, fontWeight: 800, color: '#ffffff', lineHeight: 1.2 },
  subtitle: { fontSize: 12, color: '#ffffff', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', opacity: 0.7 },
  weekNav: {
    display: 'flex', alignItems: 'center', gap: 8,
  },
  navBtn: {
    width: 36, height: 36, borderRadius: 8, border: '1px solid #1e3a5f',
    background: '#0f1f3d', color: '#ffffff', fontSize: 20, fontWeight: 700,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  weekLabel: {
    flex: 1, padding: '8px 12px', background: '#0f1f3d', border: '1px solid #1e3a5f',
    borderRadius: 8, color: '#ffffff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    textAlign: 'center',
  },
  vacationBtn: {
    width: '100%', padding: '11px', background: '#1a1220', border: '1px solid #4c1d9544',
    borderRadius: 10, color: '#c4b5fd', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    fontFamily: 'inherit',
  },
  daysWrap: {
    padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10,
  },
  dayCard: {
    background: '#0d1525', border: '1px solid #1e3a5f33', borderRadius: 12, padding: '12px',
  },
  dayCardToday: {
    border: '1px solid #1d4ed866', background: '#0f1f3d',
  },
  dayHeader: {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap',
  },
  dayName: {
    fontSize: 14, fontWeight: 800, color: '#ffffff', minWidth: 60,
  },
  dayDate: {
    fontSize: 12, color: '#cbd5e1', flex: 1,
  },
  markDayBtn: {
    fontSize: 11, padding: '3px 8px', background: 'transparent',
    border: '1px dashed #475569', borderRadius: 6, color: '#cbd5e1',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  indispoChip: {
    fontSize: 11, padding: '3px 8px', background: '#1a0a0a',
    border: '1px solid #7f1d1d55', borderRadius: 6, color: '#f87171',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  emptyDay: {
    fontSize: 12, color: '#94a3b8', fontStyle: 'italic', padding: '4px 0',
  },
  fullDayBanner: {
    background: '#1a0a0a', border: '1px solid #7f1d1d44', borderRadius: 8,
    padding: '8px 12px', fontSize: 13, color: '#f87171', fontWeight: 600,
  },
  assignCard: {
    background: '#0f2027', border: '1px solid #1d4ed844', borderRadius: 8,
    padding: '10px 12px', marginBottom: 6,
  },
  assignCardUnavail: {
    background: '#1a0a0a', border: '1px solid #7f1d1d44',
  },
  slotTime: {
    fontSize: 14, fontWeight: 700, color: '#ffffff',
  },
  paxBadge: {
    fontSize: 12, color: '#cbd5e1',
  },
  markSlotBtn: {
    fontSize: 11, padding: '3px 8px', marginTop: 6, background: 'transparent',
    border: '1px dashed #475569', borderRadius: 6, color: '#cbd5e1',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  cancelSlotBtn: {
    fontSize: 11, padding: '3px 8px', marginTop: 6, background: '#1a0a0a',
    border: '1px solid #7f1d1d55', borderRadius: 6, color: '#f87171',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  orphanSlotUnavail: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: '#1a0a0a', border: '1px solid #7f1d1d33', borderRadius: 6,
    padding: '6px 10px', marginBottom: 4, fontSize: 12, color: '#f87171',
  },
  cancelSmallBtn: {
    fontSize: 11, padding: '2px 8px', background: 'transparent',
    border: '1px solid #7f1d1d55', borderRadius: 5, color: '#f87171',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  rangesSection: {
    margin: '8px 16px 0', background: '#0d1525', border: '1px solid #1e3a5f33',
    borderRadius: 12, padding: 14,
  },
  sectionTitle: {
    fontSize: 12, fontWeight: 700, color: '#ffffff', textTransform: 'uppercase',
    letterSpacing: '.05em', marginBottom: 10,
  },
  rangeRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 0', borderBottom: '1px solid #1e3a5f22', fontSize: 13, gap: 8,
  },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 20,
  },
  modalBox: {
    background: '#0d1525', border: '1px solid #1e3a5f', borderRadius: 16,
    padding: '24px', width: '100%', maxWidth: 360,
  },
  modalTitle: {
    fontSize: 16, fontWeight: 800, color: '#ffffff', marginBottom: 20,
  },
  label: {
    display: 'block', fontSize: 12, color: '#ffffff', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6,
  },
  dateInput: {
    width: '100%', padding: '10px 12px', background: '#0f1f3d',
    border: '1px solid #1e3a5f', borderRadius: 8, color: '#e2e8f0',
    fontSize: 14, marginBottom: 14, boxSizing: 'border-box', fontFamily: 'inherit',
  },
  cancelBtn: {
    flex: 1, padding: '11px', background: '#0f1f3d', border: '1px solid #1e3a5f',
    borderRadius: 8, color: '#ffffff', fontSize: 13, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  confirmBtn: {
    flex: 1, padding: '11px', background: '#1d4ed8', border: 'none',
    borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 800,
    cursor: 'pointer', fontFamily: 'inherit',
  },
}
