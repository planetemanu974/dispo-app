// PilotPlanning.jsx
// Public page for fixed pilots — accessible via a unique token link (no login required).
// Visual style matches the admin Dashboard (same color scheme, same slot grid logic).
//
// Features:
//   • Week view (7 day cards) and Day view (single day detail)
//   • All 6 time slots always shown per day (dispo / pas dispo / booké)
//   • Booked slots are locked — pilot cannot mark them as unavailable
//   • Full-day and per-slot unavailability management
//   • Date range (vacation) picker

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/pilot-planning`

const AUTH_HEADERS = {
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
}

// All standard time slots — same as getSlotsForDate() in rules.js
const ALL_SLOTS = ['08:00', '09:15', '10:30', '11:45', '13:00', '14:15']

const DAY_LABELS_FULL  = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
const DAY_LABELS_SHORT = ['Lun',   'Mar',   'Mer',      'Jeu',   'Ven',      'Sam',    'Dim']

// ── date helpers ──────────────────────────────────────────────────────────────

function getMondayOf(date) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}

// Timezone-safe ISO string — uses local date parts to avoid UTC shift in UTC+4.
function toISO(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
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

function formatDateLong(isoStr) {
  const d = new Date(isoStr + 'T00:00:00')
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

// ── slot status helpers ───────────────────────────────────────────────────────

// Returns the booking assignment for this slot on this date (if any).
function getAssignmentForSlot(assignments, dateStr, slotTime) {
  return assignments.find(a => {
    const d = a.slot_date || a.bookings?.pilot_slots?.slot_date
    const t = a.slot_time || a.bookings?.pilot_slots?.slot_time
    return d === dateStr && t && t.slice(0, 5) === slotTime
  })
}

// Returns the unavailability entry(ies) covering this slot on this date.
function getUnavailForSlot(unavailList, dateStr, slotTime) {
  return unavailList.filter(u => {
    if (!(u.start_date <= dateStr && dateStr <= u.end_date)) return false
    if (u.slot_time === null) return true  // full-day covers all slots
    return u.slot_time.slice(0, 5) === slotTime
  })
}

function getFullDayUnavail(unavailList, dateStr) {
  return unavailList.filter(u =>
    u.start_date <= dateStr && dateStr <= u.end_date && u.slot_time === null
  )
}

// ── slot status: 'booked' | 'unavailable' | 'available'
function slotStatus(assignments, unavailList, dateStr, slotTime) {
  if (getAssignmentForSlot(assignments, dateStr, slotTime)) return 'booked'
  if (getUnavailForSlot(unavailList, dateStr, slotTime).length > 0) return 'unavailable'
  return 'available'
}

// ── main component ────────────────────────────────────────────────────────────

export default function PilotPlanning() {
  const { token } = useParams()

  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState(null)
  const [colleague, setColleague]           = useState(null)
  const [weekStart, setWeekStart]           = useState(() => toISO(getMondayOf(new Date())))
  const [assignments, setAssignments]       = useState([])
  const [unavailability, setUnavailability] = useState([])

  // View mode: 'week' or 'day'
  const [viewMode, setViewMode]       = useState('week')
  const [selectedDay, setSelectedDay] = useState(() => toISO(new Date()))

  // Modal for date-range unavailability
  const [showRangeModal, setShowRangeModal] = useState(false)
  const [rangeStart, setRangeStart]         = useState('')
  const [rangeEnd, setRangeEnd]             = useState('')
  const [saving, setSaving]                 = useState(false)

  // ── fetch planning data ───────────────────────────────────────────────────
  const fetchPlanning = useCallback(async (week) => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`${FUNCTION_URL}?token=${token}&week=${week}`, { headers: AUTH_HEADERS })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Erreur réseau'); return }
      setColleague(data.colleague)
      setAssignments(data.assignments || [])
      setUnavailability(data.unavailability || [])
    } catch {
      setError('Impossible de charger le planning.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchPlanning(weekStart) }, [fetchPlanning, weekStart])

  // ── week navigation ───────────────────────────────────────────────────────
  function prevWeek() {
    const newStart = toISO(addDays(new Date(weekStart + 'T00:00:00'), -7))
    setWeekStart(newStart)
    if (viewMode === 'day') setSelectedDay(toISO(addDays(new Date(selectedDay + 'T00:00:00'), -7)))
  }
  function nextWeek() {
    const newStart = toISO(addDays(new Date(weekStart + 'T00:00:00'), +7))
    setWeekStart(newStart)
    if (viewMode === 'day') setSelectedDay(toISO(addDays(new Date(selectedDay + 'T00:00:00'), +7)))
  }
  function goToday() {
    const today = toISO(new Date())
    setWeekStart(toISO(getMondayOf(new Date())))
    setSelectedDay(today)
  }

  // Day navigation (day view only)
  function prevDay() {
    const prev = toISO(addDays(new Date(selectedDay + 'T00:00:00'), -1))
    // If crossing week boundary, load that week
    const prevMonday = toISO(getMondayOf(new Date(prev + 'T00:00:00')))
    if (prevMonday !== weekStart) setWeekStart(prevMonday)
    setSelectedDay(prev)
  }
  function nextDay() {
    const next = toISO(addDays(new Date(selectedDay + 'T00:00:00'), +1))
    const nextMonday = toISO(getMondayOf(new Date(next + 'T00:00:00')))
    if (nextMonday !== weekStart) setWeekStart(nextMonday)
    setSelectedDay(next)
  }

  // Switch to day view for a specific day
  function openDayView(dateStr) {
    setSelectedDay(dateStr)
    setViewMode('day')
  }

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
      setShowRangeModal(false)
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

  // ── week days ─────────────────────────────────────────────────────────────
  const weekDays = Array.from({ length: 7 }, (_, i) =>
    toISO(addDays(new Date(weekStart + 'T00:00:00'), i))
  )

  // ── render: loading / error ───────────────────────────────────────────────
  if (loading) return (
    <div style={s.centered}>
      <div style={s.spinner} />
      <p style={{ color: '#94a3b8', marginTop: 16 }}>Chargement du planning…</p>
    </div>
  )

  if (error) return (
    <div style={s.centered}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
      <p style={{ color: '#f87171', fontSize: 15, textAlign: 'center' }}>{error}</p>
    </div>
  )

  const todayStr   = toISO(new Date())
  const weekLabel  = `${formatDate(weekStart)} – ${formatDate(toISO(addDays(new Date(weekStart + 'T00:00:00'), 6)))}`
  const multiDayRanges = unavailability.filter(u => u.start_date !== u.end_date)

  return (
    <div style={s.page}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={s.header}>
        <div style={s.headerTop}>
          <img src="/logo-icon.png" alt="Logo" style={{ height: 40, flexShrink: 0 }} />
          <div>
            <div style={s.appLabel}>DISPO / PAS DISPO</div>
            <div style={s.pilotName}>{colleague?.name}</div>
            <div style={s.headerSub}>Planning personnel</div>
          </div>
        </div>

        {/* View toggle */}
        <div style={s.viewToggle}>
          <button
            style={{ ...s.toggleBtn, ...(viewMode === 'week' ? s.toggleBtnActive : {}) }}
            onClick={() => setViewMode('week')}
          >
            📅 Semaine
          </button>
          <button
            style={{ ...s.toggleBtn, ...(viewMode === 'day' ? s.toggleBtnActive : {}) }}
            onClick={() => { setSelectedDay(todayStr); setViewMode('day') }}
          >
            📆 Jour
          </button>
        </div>

        {/* Navigation */}
        <div style={s.weekNav}>
          <button style={s.navBtn} onClick={viewMode === 'day' ? prevDay : prevWeek}>‹</button>
          <button style={s.weekLabel} onClick={goToday}>
            {viewMode === 'day' ? formatDateLong(selectedDay) : weekLabel}
          </button>
          <button style={s.navBtn} onClick={viewMode === 'day' ? nextDay : nextWeek}>›</button>
        </div>
      </div>

      {/* ── Vacation range button ────────────────────────────────────────── */}
      <div style={{ padding: '10px 16px 0' }}>
        <button
          style={s.vacationBtn}
          onClick={() => { setRangeStart(''); setRangeEnd(''); setShowRangeModal(true) }}
        >
          🏖️ Marquer indispo sur une période
        </button>
      </div>

      {/* ── WEEK VIEW ───────────────────────────────────────────────────── */}
      {viewMode === 'week' && (
        <div style={s.daysWrap}>
          {weekDays.map((dateStr, i) => {
            const isToday      = dateStr === todayStr
            const fullDayUnavailList = getFullDayUnavail(unavailability, dateStr)
            const isFullDayOff = fullDayUnavailList.length > 0

            // Count bookings for this day (for the summary badge)
            const bookedCount = ALL_SLOTS.filter(t =>
              slotStatus(assignments, unavailability, dateStr, t) === 'booked'
            ).length

            return (
              <div key={dateStr} style={{
                ...s.dayCard,
                ...(isToday ? s.dayCardToday : {}),
                ...(isFullDayOff ? s.dayCardOff : {}),
              }}>
                {/* Day header */}
                <div style={s.dayHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <span
                      style={{ ...s.dayName, ...(isToday ? { color: '#60a5fa' } : {}) }}
                      onClick={() => openDayView(dateStr)}
                    >
                      {DAY_LABELS_FULL[i]}
                    </span>
                    <span style={s.dayDate}>{formatDate(dateStr)}</span>
                    {bookedCount > 0 && (
                      <span style={s.bookedBadge}>✈ {bookedCount} vol{bookedCount > 1 ? 's' : ''}</span>
                    )}
                  </div>

                  {/* Full-day toggle */}
                  {isFullDayOff ? (
                    <button
                      style={s.btnIndispoDay}
                      onClick={() => fullDayUnavailList.forEach(u => removeUnavail(u.id))}
                      title="Cliquer pour annuler l'indispo"
                    >
                      🚫 Indispo
                    </button>
                  ) : (
                    <button
                      style={s.btnDispoDay}
                      onClick={() => addUnavail({ start_date: dateStr, end_date: dateStr })}
                    >
                      + Indispo ce jour
                    </button>
                  )}
                </div>

                {/* Slot grid */}
                {isFullDayOff ? (
                  <div style={s.fullDayBanner}>🚫 Journée indisponible — cliquer sur le bouton pour annuler</div>
                ) : (
                  <div style={s.slotGrid}>
                    {ALL_SLOTS.map(slotTime => {
                      const status    = slotStatus(assignments, unavailability, dateStr, slotTime)
                      const unavails  = getUnavailForSlot(unavailability, dateStr, slotTime)
                        .filter(u => u.slot_time !== null) // exclude full-day (handled above)
                      const assignment = getAssignmentForSlot(assignments, dateStr, slotTime)
                      const paxCount  = assignment?.bookings?.passengers?.length ?? null

                      return (
                        <SlotRow
                          key={slotTime}
                          slotTime={slotTime}
                          status={status}
                          paxCount={paxCount}
                          unavails={unavails}
                          compact={true}
                          onMarkUnavail={() => addUnavail({ start_date: dateStr, end_date: dateStr, slot_time: slotTime })}
                          onCancelUnavail={() => unavails.forEach(u => removeUnavail(u.id))}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── DAY VIEW ────────────────────────────────────────────────────── */}
      {viewMode === 'day' && (
        <div style={s.daysWrap}>
          {(() => {
            const dateStr = selectedDay
            const isToday = dateStr === todayStr
            const fullDayUnavailList = getFullDayUnavail(unavailability, dateStr)
            const isFullDayOff = fullDayUnavailList.length > 0
            const dayOfWeek = new Date(dateStr + 'T00:00:00').getDay()
            const dayIndex  = dayOfWeek === 0 ? 6 : dayOfWeek - 1

            return (
              <div style={{ ...s.dayCard, ...(isToday ? s.dayCardToday : {}), ...(isFullDayOff ? s.dayCardOff : {}) }}>
                {/* Day header */}
                <div style={s.dayHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <span style={{ ...s.dayName, fontSize: 18, ...(isToday ? { color: '#60a5fa' } : {}) }}>
                      {DAY_LABELS_FULL[dayIndex]}
                    </span>
                    <span style={s.dayDate}>{formatDate(dateStr)}</span>
                    {isToday && <span style={s.todayBadge}>Aujourd'hui</span>}
                  </div>
                  {/* Full-day toggle */}
                  {isFullDayOff ? (
                    <button
                      style={s.btnIndispoDay}
                      onClick={() => fullDayUnavailList.forEach(u => removeUnavail(u.id))}
                    >
                      🚫 Indispo — annuler
                    </button>
                  ) : (
                    <button
                      style={s.btnDispoDay}
                      onClick={() => addUnavail({ start_date: dateStr, end_date: dateStr })}
                    >
                      + Indispo ce jour
                    </button>
                  )}
                </div>

                {isFullDayOff ? (
                  <div style={s.fullDayBanner}>🚫 Journée indisponible</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {ALL_SLOTS.map(slotTime => {
                      const status     = slotStatus(assignments, unavailability, dateStr, slotTime)
                      const unavails   = getUnavailForSlot(unavailability, dateStr, slotTime)
                        .filter(u => u.slot_time !== null)
                      const assignment = getAssignmentForSlot(assignments, dateStr, slotTime)
                      const paxCount   = assignment?.bookings?.passengers?.length ?? null

                      return (
                        <SlotRow
                          key={slotTime}
                          slotTime={slotTime}
                          status={status}
                          paxCount={paxCount}
                          unavails={unavails}
                          compact={false}
                          onMarkUnavail={() => addUnavail({ start_date: dateStr, end_date: dateStr, slot_time: slotTime })}
                          onCancelUnavail={() => unavails.forEach(u => removeUnavail(u.id))}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* ── Multi-day unavailability ranges ─────────────────────────────── */}
      {multiDayRanges.length > 0 && (
        <div style={s.rangesSection}>
          <div style={s.sectionTitle}>📅 Périodes d'indisponibilité</div>
          {multiDayRanges.map(u => (
            <div key={u.id} style={s.rangeRow}>
              <span style={{ color: '#f87171', fontSize: 13 }}>
                🚫 {formatDate(u.start_date)} → {formatDate(u.end_date)}
                {u.slot_time ? ` (${u.slot_time.slice(0, 5)})` : ' (toute la journée)'}
              </span>
              <button style={s.btnCancelSmall} onClick={() => removeUnavail(u.id)}>✕ Supprimer</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Modal: date range ────────────────────────────────────────────── */}
      {showRangeModal && (
        <div style={s.overlay} onClick={() => setShowRangeModal(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>🏖️ Période d'indisponibilité</div>
            <label style={s.label}>Du</label>
            <input
              type="date" value={rangeStart}
              onChange={e => setRangeStart(e.target.value)}
              style={s.dateInput}
            />
            <label style={s.label}>Au</label>
            <input
              type="date" value={rangeEnd}
              onChange={e => setRangeEnd(e.target.value)}
              min={rangeStart} style={s.dateInput}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button style={s.btnCancel} onClick={() => setShowRangeModal(false)}>Annuler</button>
              <button
                style={{ ...s.btnConfirm, opacity: (!rangeStart || !rangeEnd || saving) ? .5 : 1 }}
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

// ── SlotRow component ─────────────────────────────────────────────────────────
// Renders one time slot with status-driven visual (dispo / pas dispo / booké).
// compact=true → used in week view (smaller, inline)
// compact=false → used in day view (larger, with more detail)

function SlotRow({ slotTime, status, paxCount, unavails, compact, onMarkUnavail, onCancelUnavail }) {
  const isBooked      = status === 'booked'
  const isUnavailable = status === 'unavailable'
  const isAvailable   = status === 'available'

  const cardStyle = {
    ...s.slotCard,
    ...(isBooked      ? s.slotCardBooked : {}),
    ...(isUnavailable ? s.slotCardUnavail : {}),
    ...(isAvailable   ? s.slotCardDispo  : {}),
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Status dot */}
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: isBooked ? '#38bdf8' : isUnavailable ? '#f87171' : '#4ade80',
        }} />

        {/* Time */}
        <span style={{ ...s.slotTimeLabel, flex: 1 }}>
          {slotTime}
        </span>

        {/* Status label + actions */}
        {isBooked && (
          <span style={s.bookedLabel}>
            ✈ Vol — {paxCount != null ? `${paxCount} pax` : '?'} 🔒
          </span>
        )}

        {isUnavailable && !compact && (
          <button style={s.btnCancelUnavail} onClick={onCancelUnavail}>
            ↩ Redevenir dispo
          </button>
        )}

        {isUnavailable && compact && (
          <button style={s.btnCancelSmall} onClick={onCancelUnavail} title="Annuler l'indispo">
            ✕
          </button>
        )}

        {isAvailable && !compact && (
          <button style={s.btnMarkUnavail} onClick={onMarkUnavail}>
            Pas dispo
          </button>
        )}

        {isAvailable && compact && (
          <span style={s.dispoLabel}>Dispo</span>
        )}
      </div>

      {/* In day view: extra info */}
      {!compact && isBooked && (
        <div style={{ fontSize: 11, color: '#7dd3fc', marginTop: 4, marginLeft: 16 }}>
          Créneau verrouillé — vol déjà réservé
        </div>
      )}
      {!compact && isAvailable && (
        <div style={{ fontSize: 11, color: '#86efac', marginTop: 4, marginLeft: 16 }}>
          Disponible pour un vol
        </div>
      )}
      {!compact && isUnavailable && (
        <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 4, marginLeft: 16 }}>
          Marqué indisponible — cliquer pour annuler
        </div>
      )}
    </div>
  )
}

// ── styles ────────────────────────────────────────────────────────────────────
const s = {
  page: {
    minHeight: '100dvh',
    background: '#0a0f1a',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    paddingBottom: 40,
  },
  centered: {
    minHeight: '100dvh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', background: '#0a0f1a', padding: 24,
  },
  spinner: {
    width: 36, height: 36,
    border: '3px solid #1e3a5f', borderTop: '3px solid #60a5fa',
    borderRadius: '50%', animation: 'spin 1s linear infinite',
  },

  // Header
  header: {
    background: 'linear-gradient(135deg, #0f1f3d 0%, #1a2f5a 100%)',
    padding: '20px 16px 16px',
    borderBottom: '1px solid #1e3a5f',
  },
  headerTop: {
    display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14,
  },
  appLabel: {
    fontSize: 11, fontWeight: 800, color: '#60a5fa',
    letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 2,
  },
  pilotName: {
    fontSize: 22, fontWeight: 800, color: '#ffffff', lineHeight: 1.2,
  },
  headerSub: {
    fontSize: 12, color: '#ffffffb3', fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '.05em',
  },

  // View toggle
  viewToggle: {
    display: 'flex', gap: 8, marginBottom: 12,
  },
  toggleBtn: {
    flex: 1, padding: '9px 12px',
    background: '#0f1f3d', border: '1px solid #1e3a5f',
    borderRadius: 8, color: '#94a3b8', fontSize: 13, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  toggleBtnActive: {
    background: '#1d4ed8', border: '1px solid #3b82f6',
    color: '#ffffff',
  },

  // Week navigation
  weekNav: {
    display: 'flex', alignItems: 'center', gap: 8,
  },
  navBtn: {
    width: 36, height: 36, borderRadius: 8, border: '1px solid #1e3a5f',
    background: '#0f1f3d', color: '#ffffff', fontSize: 20, fontWeight: 700,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  weekLabel: {
    flex: 1, padding: '8px 12px', background: '#0f1f3d', border: '1px solid #1e3a5f',
    borderRadius: 8, color: '#ffffff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    textAlign: 'center', fontFamily: 'inherit',
  },

  // Vacation button
  vacationBtn: {
    width: '100%', padding: '11px', background: '#1a1220',
    border: '1px solid #4c1d9544', borderRadius: 10,
    color: '#c4b5fd', fontSize: 13, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // Days
  daysWrap: {
    padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10,
  },
  dayCard: {
    background: '#0d1525', border: '1px solid #1e3a5f33', borderRadius: 12, padding: '12px',
  },
  dayCardToday: {
    border: '1px solid #1d4ed866', background: '#0f1f3d',
  },
  dayCardOff: {
    background: '#160a0a', border: '1px solid #7f1d1d44',
  },
  dayHeader: {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap',
  },
  dayName: {
    fontSize: 15, fontWeight: 800, color: '#ffffff', cursor: 'pointer',
  },
  dayDate: {
    fontSize: 12, color: '#94a3b8',
  },
  todayBadge: {
    fontSize: 10, fontWeight: 700, color: '#60a5fa',
    background: '#1d4ed822', border: '1px solid #1d4ed844',
    borderRadius: 4, padding: '1px 5px', textTransform: 'uppercase',
  },
  bookedBadge: {
    fontSize: 10, fontWeight: 700, color: '#38bdf8',
    background: '#0c4a6e33', border: '1px solid #0c4a6e66',
    borderRadius: 4, padding: '1px 5px',
  },

  // Full-day controls
  btnIndispoDay: {
    fontSize: 11, padding: '4px 8px', background: '#1a0a0a',
    border: '1px solid #7f1d1d66', borderRadius: 6, color: '#f87171',
    cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
  },
  btnDispoDay: {
    fontSize: 11, padding: '4px 8px', background: 'transparent',
    border: '1px dashed #475569', borderRadius: 6, color: '#94a3b8',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  fullDayBanner: {
    background: '#1a0a0a', border: '1px solid #7f1d1d44', borderRadius: 8,
    padding: '8px 12px', fontSize: 13, color: '#f87171', fontWeight: 600,
  },

  // Slot grid (week view)
  slotGrid: {
    display: 'flex', flexDirection: 'column', gap: 4,
  },

  // Slot card (shared base)
  slotCard: {
    borderRadius: 8, padding: '8px 10px',
    border: '1px solid transparent',
  },
  slotCardDispo: {
    background: '#052e0a', border: '1px solid #14532d55',
  },
  slotCardUnavail: {
    background: '#160808', border: '1px solid #7f1d1d55',
  },
  slotCardBooked: {
    background: '#0c2240', border: '1px solid #0c4a6e88',
  },
  slotTimeLabel: {
    fontSize: 13, fontWeight: 700, color: '#ffffff',
  },

  // Booked label
  bookedLabel: {
    fontSize: 12, color: '#7dd3fc', fontWeight: 600,
  },
  dispoLabel: {
    fontSize: 11, color: '#4ade8088', fontStyle: 'italic',
  },

  // Slot action buttons
  btnMarkUnavail: {
    fontSize: 11, padding: '4px 10px', background: 'transparent',
    border: '1px dashed #475569', borderRadius: 6, color: '#94a3b8',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  btnCancelUnavail: {
    fontSize: 11, padding: '4px 10px', background: '#1a0a0a',
    border: '1px solid #7f1d1d66', borderRadius: 6, color: '#f87171',
    cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
  },
  btnCancelSmall: {
    fontSize: 11, padding: '2px 7px', background: 'transparent',
    border: '1px solid #7f1d1d55', borderRadius: 5, color: '#f87171',
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // Ranges section
  rangesSection: {
    margin: '8px 16px 0', background: '#0d1525',
    border: '1px solid #1e3a5f33', borderRadius: 12, padding: 14,
  },
  sectionTitle: {
    fontSize: 12, fontWeight: 700, color: '#ffffff',
    textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10,
  },
  rangeRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 0', borderBottom: '1px solid #1e3a5f22', gap: 8,
  },

  // Modal
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 20,
  },
  modal: {
    background: '#0d1525', border: '1px solid #1e3a5f',
    borderRadius: 16, padding: 24, width: '100%', maxWidth: 360,
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
  btnCancel: {
    flex: 1, padding: '11px', background: '#0f1f3d', border: '1px solid #1e3a5f',
    borderRadius: 8, color: '#ffffff', fontSize: 13, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  btnConfirm: {
    flex: 1, padding: '11px', background: '#1d4ed8', border: 'none',
    borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 800,
    cursor: 'pointer', fontFamily: 'inherit',
  },
}
