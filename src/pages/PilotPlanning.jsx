// PilotPlanning.jsx
// Public page for fixed pilots — accessible via a unique token link (no login required).
// Visual style matches the admin Dashboard exactly:
//   • Week view: 7-column grid (same as Dashboard week grid)
//   • Day view: horizontal day strip + full-width slot rows (same as Dashboard day view)
//   • Same color charter (blue=dispo, green=booké, gray=pas dispo)
//   • Booked slots locked — pilot cannot mark as unavailable

import React, { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/pilot-planning`
const AUTH_HEADERS = { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }

// All 6 standard time slots
const ALL_SLOTS = ['08:00', '09:15', '10:30', '11:45', '13:00', '14:15']

// End time for each slot (for the "08:00 – 09:15" range label in day view)
const SLOT_END = {
  '08:00': '09:15',
  '09:15': '10:30',
  '10:30': '11:45',
  '11:45': '13:00',
  '13:00': '14:15',
  '14:15': '15:30',
}

const DAY_LABELS_FULL  = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
const DAY_LABELS_SHORT = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM']
const HOUR_LABELS      = ['08h', '09h', '10h', '11h', '12h', '13h', '14h']

// ── date helpers ──────────────────────────────────────────────────────────────

function getMondayOf(date) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}

// Timezone-safe ISO string using local date parts (avoids UTC shift in UTC+4)
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

function formatDateFull(isoStr) {
  const d = new Date(isoStr + 'T00:00:00')
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ── slot status helpers ───────────────────────────────────────────────────────

function getAssignmentForSlot(assignments, dateStr, slotTime) {
  return assignments.find(a => {
    const d = a.slot_date || a.bookings?.pilot_slots?.slot_date
    const t = a.slot_time || a.bookings?.pilot_slots?.slot_time
    return d === dateStr && t && t.slice(0, 5) === slotTime
  })
}

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

// Returns 'booked' | 'unavailable' | 'available'
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

  const [viewMode, setViewMode]       = useState('week')
  const [selectedDay, setSelectedDay] = useState(() => toISO(new Date()))

  const [showRangeModal, setShowRangeModal] = useState(false)
  const [rangeStart, setRangeStart]         = useState('')
  const [rangeEnd, setRangeEnd]             = useState('')
  const [saving, setSaving]                 = useState(false)

  // ── fetch ─────────────────────────────────────────────────────────────────
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

  // ── navigation ────────────────────────────────────────────────────────────
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
  function prevDay() {
    const prev = toISO(addDays(new Date(selectedDay + 'T00:00:00'), -1))
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

  // ── derived data ──────────────────────────────────────────────────────────
  const weekDays = Array.from({ length: 7 }, (_, i) =>
    toISO(addDays(new Date(weekStart + 'T00:00:00'), i))
  )
  const todayStr  = toISO(new Date())
  const weekLabel = `${formatDate(weekStart)} – ${formatDate(toISO(addDays(new Date(weekStart + 'T00:00:00'), 6)))}`
  const multiDayRanges = unavailability.filter(u => u.start_date !== u.end_date)

  // ── loading / error ───────────────────────────────────────────────────────
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

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={s.page}>

      {/* ── Top header ──────────────────────────────────────────────────── */}
      <div style={s.topBar}>
        {/* Logo */}
        <div style={s.logoWrap}>
          <img src="/logo-icon.png" alt="Logo" style={{ height: 32, display: 'block' }}
            onError={e => { e.target.style.display = 'none' }} />
        </div>

        {/* View toggle: Semaine / Jour */}
        <div style={s.viewToggle}>
          <button
            style={{ ...s.toggleBtn, ...(viewMode === 'week' ? s.toggleBtnActive : {}) }}
            onClick={() => setViewMode('week')}
          >
            📅 Semaine
          </button>
          <button
            style={{ ...s.toggleBtn, ...(viewMode === 'day' ? s.toggleBtnActive : {}) }}
            onClick={() => setViewMode('day')}
          >
            📆 Jour
          </button>
        </div>

        {/* Pilot name */}
        <div style={s.pilotName}>{colleague?.name}</div>
      </div>

      {/* ── Navigation bar (week range) ──────────────────────────────────── */}
      <div style={s.navBar}>
        <button style={s.navBtn} onClick={prevWeek}>‹ Préc.</button>
        <span style={s.navLabel}>{weekLabel}</span>
        <button style={s.navBtn} onClick={nextWeek}>Suiv. ›</button>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          WEEK VIEW — 7-column grid matching Dashboard week view
          ════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'week' && (
        <>
          <div style={s.gridScroll}>
            <div style={s.grid}>

              {/* ── Row 0: day header ──────────────────────────────────── */}
              <div style={s.gridCorner} />
              {weekDays.map((dateStr, i) => {
                const isToday = dateStr === todayStr
                const dayNum  = new Date(dateStr + 'T00:00:00').getDate()
                return (
                  <div
                    key={dateStr}
                    style={s.gridDayHeader}
                    onClick={() => { setSelectedDay(dateStr); setViewMode('day') }}
                  >
                    <span style={s.gridDayShort}>{DAY_LABELS_SHORT[i]}</span>
                    <span style={{
                      ...s.gridDayNum,
                      ...(isToday ? s.gridDayNumToday : {}),
                    }}>
                      {dayNum}
                    </span>
                  </div>
                )
              })}

              {/* ── Rows 1-6: time slots ───────────────────────────────── */}
              {ALL_SLOTS.map((slotTime, si) => (
                <React.Fragment key={slotTime}>
                  {/* Hour label (left column) */}
                  <div style={s.gridHourLabel}>{HOUR_LABELS[si]}</div>

                  {/* One cell per day */}
                  {weekDays.map(dateStr => {
                    const status     = slotStatus(assignments, unavailability, dateStr, slotTime)
                    const assignment = getAssignmentForSlot(assignments, dateStr, slotTime)
                    const pax        = assignment?.bookings?.passengers?.length ?? null
                    const isFullOff  = getFullDayUnavail(unavailability, dateStr).length > 0

                    return (
                      <div key={dateStr} style={s.gridCell}
                        onClick={() => { setSelectedDay(dateStr); setViewMode('day') }}>
                        <div style={{
                          ...s.cellBlock,
                          ...(status === 'available'   ? s.cellAvail   : {}),
                          ...(status === 'unavailable' ? s.cellUnavail : {}),
                          ...(status === 'booked'      ? s.cellBooked  : {}),
                        }}>
                          {status === 'unavailable' && (
                            <span style={s.cellPasDispo}>PAS DISPO</span>
                          )}
                          {status === 'booked' && (
                            <span style={s.cellBookedLabel}>✈ {pax != null ? `${pax} pax` : ''}</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </React.Fragment>
              ))}

            </div>
          </div>

          {/* Vacation button */}
          <div style={{ padding: '12px 16px' }}>
            <button style={s.vacationBtn}
              onClick={() => { setRangeStart(''); setRangeEnd(''); setShowRangeModal(true) }}>
              🏖️ Marquer indispo sur une période
            </button>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          DAY VIEW — day strip + full-width slot rows matching Dashboard day view
          ════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'day' && (
        <>
          {/* Day strip */}
          <div style={s.dayStrip}>
            {weekDays.map((dateStr, i) => {
              const isSelected = dateStr === selectedDay
              const isToday    = dateStr === todayStr
              const dayNum     = new Date(dateStr + 'T00:00:00').getDate()
              const bookedCnt  = ALL_SLOTS.filter(t =>
                slotStatus(assignments, unavailability, dateStr, t) === 'booked'
              ).length

              return (
                <button key={dateStr}
                  style={{ ...s.dayStripBtn, ...(isSelected ? s.dayStripBtnSelected : {}) }}
                  onClick={() => setSelectedDay(dateStr)}>
                  <span style={s.dayStripShort}>{DAY_LABELS_SHORT[i]}</span>
                  <span style={{
                    ...s.dayStripNum,
                    ...(isToday ? s.dayStripNumToday : {}),
                    ...(isSelected ? s.dayStripNumSelected : {}),
                  }}>
                    {dayNum}
                  </span>
                  {bookedCnt > 0 && (
                    <span style={s.dayStripDot}>{bookedCnt}</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Day prev/next navigation */}
          <div style={s.dayNav}>
            <button style={s.dayNavBtn} onClick={prevDay}>‹</button>
            <span style={s.dayNavLabel}>{formatDateFull(selectedDay)}</span>
            <button style={s.dayNavBtn} onClick={nextDay}>›</button>
          </div>

          {/* Slot rows */}
          <div style={s.slotRows}>
            {(() => {
              const dateStr        = selectedDay
              const fullDayUnavail = getFullDayUnavail(unavailability, dateStr)
              const isFullDayOff   = fullDayUnavail.length > 0

              if (isFullDayOff) return (
                <div style={s.fullDayBanner}>
                  <span>🚫 Journée entière indisponible</span>
                  <button style={s.btnCancelFull}
                    onClick={() => fullDayUnavail.forEach(u => removeUnavail(u.id))}>
                    Annuler
                  </button>
                </div>
              )

              return ALL_SLOTS.map(slotTime => {
                const status     = slotStatus(assignments, unavailability, dateStr, slotTime)
                const unavails   = getUnavailForSlot(unavailability, dateStr, slotTime)
                  .filter(u => u.slot_time !== null)
                const assignment = getAssignmentForSlot(assignments, dateStr, slotTime)
                const pax        = assignment?.bookings?.passengers?.length ?? null

                const isAvail   = status === 'available'
                const isUnavail = status === 'unavailable'
                const isBooked  = status === 'booked'

                return (
                  <div key={slotTime} style={s.slotRow}>
                    {/* Left: hour label */}
                    <div style={s.slotRowHour}>{slotTime.slice(0, 5)}</div>

                    {/* Right: colored block */}
                    <div style={{
                      ...s.slotRowBlock,
                      ...(isAvail  ? s.slotAvail  : {}),
                      ...(isUnavail ? s.slotUnavail : {}),
                      ...(isBooked ? s.slotBooked : {}),
                    }}>
                      {/* Time range + status label */}
                      <div style={s.slotRowInfo}>
                        <div style={s.slotRowRange}>{slotTime} – {SLOT_END[slotTime]}</div>
                        <div style={s.slotRowStatusLabel}>
                          {isAvail  && 'Libre'}
                          {isUnavail && 'Pas dispo'}
                          {isBooked && `✈ Vol — ${pax ?? '?'} pax`}
                        </div>
                      </div>

                      {/* Action badge */}
                      {isAvail && (
                        <button
                          style={s.badgeDispo}
                          onClick={() => addUnavail({ start_date: dateStr, end_date: dateStr, slot_time: slotTime })}
                          disabled={saving}
                        >
                          DISPO
                        </button>
                      )}
                      {isUnavail && (
                        <button
                          style={s.badgePasDispo}
                          onClick={() => unavails.forEach(u => removeUnavail(u.id))}
                          disabled={saving}
                        >
                          PAS DISPO
                        </button>
                      )}
                      {isBooked && (
                        <span style={s.badgeLocked}>🔒</span>
                      )}
                    </div>
                  </div>
                )
              })
            })()}
          </div>

          {/* Full-day toggle */}
          {!getFullDayUnavail(unavailability, selectedDay).length && (
            <div style={{ padding: '4px 16px 8px' }}>
              <button style={s.btnFullDay}
                onClick={() => addUnavail({ start_date: selectedDay, end_date: selectedDay })}>
                🚫 Indispo toute la journée
              </button>
            </div>
          )}

          {/* Vacation button */}
          <div style={{ padding: '4px 16px 12px' }}>
            <button style={s.vacationBtn}
              onClick={() => { setRangeStart(''); setRangeEnd(''); setShowRangeModal(true) }}>
              🏖️ Marquer indispo sur une période
            </button>
          </div>
        </>
      )}

      {/* ── Multi-day ranges ──────────────────────────────────────────────── */}
      {multiDayRanges.length > 0 && (
        <div style={s.rangesSection}>
          <div style={s.sectionTitle}>📅 Périodes d'indisponibilité</div>
          {multiDayRanges.map(u => (
            <div key={u.id} style={s.rangeRow}>
              <span style={{ color: '#f87171', fontSize: 13 }}>
                🚫 {formatDate(u.start_date)} → {formatDate(u.end_date)}
                {u.slot_time ? ` (${u.slot_time.slice(0, 5)})` : ' (journée entière)'}
              </span>
              <button style={s.btnCancelSmall} onClick={() => removeUnavail(u.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Modal: date range ─────────────────────────────────────────────── */}
      {showRangeModal && (
        <div style={s.overlay} onClick={() => setShowRangeModal(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>🏖️ Période d'indisponibilité</div>
            <label style={s.label}>Du</label>
            <input type="date" value={rangeStart}
              onChange={e => setRangeStart(e.target.value)} style={s.dateInput} />
            <label style={s.label}>Au</label>
            <input type="date" value={rangeEnd}
              onChange={e => setRangeEnd(e.target.value)} min={rangeStart} style={s.dateInput} />
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

// ── styles ────────────────────────────────────────────────────────────────────
const s = {
  // ── Base
  page: {
    minHeight: '100dvh',
    background: '#080e1a',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    paddingBottom: 40,
  },
  centered: {
    minHeight: '100dvh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: '#080e1a', padding: 24,
  },
  spinner: {
    width: 36, height: 36,
    border: '3px solid #1e3a5f', borderTop: '3px solid #60a5fa',
    borderRadius: '50%', animation: 'spin 1s linear infinite',
  },

  // ── Top bar (logo + view toggle + pilot name)
  topBar: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 16px',
    background: '#0d1525',
    borderBottom: '1px solid #1e3a5f44',
  },
  logoWrap: {
    width: 36, height: 36, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  viewToggle: {
    display: 'flex', gap: 4,
  },
  toggleBtn: {
    padding: '7px 12px',
    background: 'transparent',
    border: '1px solid #1e3a5f',
    borderRadius: 8,
    color: '#64748b',
    fontSize: 13, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  toggleBtnActive: {
    background: '#1e3a5f',
    border: '1px solid #3b82f6',
    color: '#ffffff',
  },
  pilotName: {
    flex: 1,
    fontSize: 14, fontWeight: 800, color: '#ffffff',
    textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },

  // ── Nav bar (week prev/next)
  navBar: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 16px',
    background: '#0a1220',
    borderBottom: '1px solid #1e3a5f22',
  },
  navBtn: {
    padding: '6px 12px',
    background: '#0f1f3d', border: '1px solid #1e3a5f',
    borderRadius: 8, color: '#ffffff',
    fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  navLabel: {
    flex: 1, textAlign: 'center',
    fontSize: 14, fontWeight: 700, color: '#ffffff',
  },

  // ── WEEK VIEW GRID ───────────────────────────────────────────────────────
  gridScroll: {
    overflowX: 'auto',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '44px repeat(7, 1fr)',
    minWidth: 480,
    borderTop: '1px solid #1e3a5f22',
  },

  // Corner cell (top-left, empty)
  gridCorner: {
    background: '#0a1220',
    borderRight: '1px solid #1e3a5f22',
    borderBottom: '1px solid #1e3a5f22',
  },

  // Day header cells (row 0)
  gridDayHeader: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 2, padding: '8px 4px',
    background: '#0d1525',
    borderRight: '1px solid #1e3a5f22',
    borderBottom: '1px solid #1e3a5f22',
    cursor: 'pointer',
    userSelect: 'none',
  },
  gridDayShort: {
    fontSize: 10, fontWeight: 800, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '.06em',
  },
  gridDayNum: {
    fontSize: 15, fontWeight: 800, color: '#ffffff',
    width: 26, height: 26, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  gridDayNumToday: {
    background: '#1d4ed8', color: '#ffffff',
  },

  // Hour label cells (left column)
  gridHourLabel: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
    padding: '8px 6px 0 0',
    fontSize: 11, fontWeight: 600, color: '#475569',
    background: '#0a1220',
    borderRight: '1px solid #1e3a5f22',
    borderBottom: '1px solid #1e3a5f22',
    minHeight: 52,
  },

  // Regular grid cells
  gridCell: {
    padding: 3,
    background: '#080e1a',
    borderRight: '1px solid #1e3a5f22',
    borderBottom: '1px solid #1e3a5f22',
    cursor: 'pointer',
    minHeight: 52,
  },

  // Colored block inside each cell
  cellBlock: {
    height: '100%', minHeight: 46,
    borderRadius: 6,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '4px 2px',
  },
  cellAvail: {
    background: '#2563eb',
  },
  cellUnavail: {
    background: '#1e2a3a',
    border: '1px solid #334155',
  },
  cellBooked: {
    background: '#166534',
  },
  cellPasDispo: {
    fontSize: 8, fontWeight: 800, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '.04em',
    textAlign: 'center',
  },
  cellBookedLabel: {
    fontSize: 9, fontWeight: 800, color: '#86efac',
    textAlign: 'center',
  },

  // ── DAY VIEW ──────────────────────────────────────────────────────────────

  // Horizontal day strip
  dayStrip: {
    display: 'flex', gap: 4,
    overflowX: 'auto', padding: '10px 12px',
    background: '#0d1525',
    borderBottom: '1px solid #1e3a5f22',
    scrollbarWidth: 'none',
  },
  dayStripBtn: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    padding: '6px 8px', minWidth: 44,
    background: 'transparent', border: '1px solid transparent',
    borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
    flexShrink: 0,
  },
  dayStripBtnSelected: {
    background: '#0f1f3d', border: '1px solid #3b82f6',
  },
  dayStripShort: {
    fontSize: 10, fontWeight: 800, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '.05em',
  },
  dayStripNum: {
    fontSize: 16, fontWeight: 800, color: '#94a3b8',
    width: 28, height: 28, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  dayStripNumToday: {
    background: '#1d4ed8', color: '#fff',
  },
  dayStripNumSelected: {
    color: '#ffffff',
  },
  dayStripDot: {
    width: 16, height: 16, borderRadius: '50%',
    background: '#16a34a',
    fontSize: 10, fontWeight: 800, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },

  // Day prev/next nav
  dayNav: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 16px',
    background: '#0a1220',
    borderBottom: '1px solid #1e3a5f22',
  },
  dayNavBtn: {
    width: 32, height: 32, borderRadius: 8,
    background: '#0f1f3d', border: '1px solid #1e3a5f',
    color: '#fff', fontSize: 18, fontWeight: 700,
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  dayNavLabel: {
    flex: 1, textAlign: 'center',
    fontSize: 14, fontWeight: 700, color: '#ffffff',
  },

  // Slot rows container
  slotRows: {
    display: 'flex', flexDirection: 'column', gap: 0,
    padding: '8px 0',
  },

  // Individual slot row
  slotRow: {
    display: 'flex', alignItems: 'stretch', gap: 0,
    padding: '3px 12px',
    minHeight: 72,
  },
  slotRowHour: {
    width: 50, flexShrink: 0,
    display: 'flex', alignItems: 'flex-start', paddingTop: 12,
    fontSize: 13, fontWeight: 600, color: '#475569',
  },

  // Colored block (right side of slot row)
  slotRowBlock: {
    flex: 1, borderRadius: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 14px', gap: 10,
  },
  slotAvail: {
    background: '#2563eb',
  },
  slotUnavail: {
    background: '#1e2a3a',
    border: '1px solid #334155',
  },
  slotBooked: {
    background: '#166534',
  },

  // Info inside block (left side)
  slotRowInfo: {
    display: 'flex', flexDirection: 'column', gap: 2,
    flex: 1,
  },
  slotRowRange: {
    fontSize: 14, fontWeight: 700, color: '#ffffff',
  },
  slotRowStatusLabel: {
    fontSize: 12, color: 'rgba(255,255,255,0.7)',
  },

  // Action badges (right side of block)
  badgeDispo: {
    padding: '6px 14px', borderRadius: 8,
    background: '#16a34a', border: 'none',
    color: '#fff', fontSize: 12, fontWeight: 800,
    cursor: 'pointer', fontFamily: 'inherit',
    letterSpacing: '.04em', flexShrink: 0,
  },
  badgePasDispo: {
    padding: '6px 10px', borderRadius: 8,
    background: '#374151', border: '1px solid #4b5563',
    color: '#9ca3af', fontSize: 12, fontWeight: 800,
    cursor: 'pointer', fontFamily: 'inherit',
    letterSpacing: '.04em', flexShrink: 0,
  },
  badgeLocked: {
    fontSize: 18, flexShrink: 0,
  },

  // Full-day banner (when full day is off)
  fullDayBanner: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    margin: '8px 12px', padding: '14px 16px',
    background: '#160808', border: '1px solid #7f1d1d55', borderRadius: 10,
    color: '#f87171', fontSize: 13, fontWeight: 600, gap: 10,
  },
  btnCancelFull: {
    padding: '6px 12px', background: 'transparent',
    border: '1px solid #f87171', borderRadius: 6,
    color: '#f87171', fontSize: 12, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // Full-day toggle button
  btnFullDay: {
    width: '100%', padding: '10px',
    background: 'transparent', border: '1px dashed #475569',
    borderRadius: 8, color: '#64748b', fontSize: 13, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // Vacation button
  vacationBtn: {
    width: '100%', padding: '11px',
    background: '#1a1220', border: '1px solid #4c1d9544',
    borderRadius: 10, color: '#c4b5fd', fontSize: 13, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // Multi-day ranges section
  rangesSection: {
    margin: '8px 16px 0',
    background: '#0d1525', border: '1px solid #1e3a5f33',
    borderRadius: 12, padding: 14,
  },
  sectionTitle: {
    fontSize: 11, fontWeight: 700, color: '#ffffff',
    textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10,
  },
  rangeRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '7px 0', borderBottom: '1px solid #1e3a5f22', gap: 8,
  },
  btnCancelSmall: {
    padding: '3px 8px', background: 'transparent',
    border: '1px solid #7f1d1d55', borderRadius: 5,
    color: '#f87171', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
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
    width: '100%', padding: '10px 12px',
    background: '#0f1f3d', border: '1px solid #1e3a5f',
    borderRadius: 8, color: '#e2e8f0', fontSize: 14,
    marginBottom: 14, boxSizing: 'border-box', fontFamily: 'inherit',
  },
  btnCancel: {
    flex: 1, padding: '11px',
    background: '#0f1f3d', border: '1px solid #1e3a5f',
    borderRadius: 8, color: '#ffffff', fontSize: 13, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  btnConfirm: {
    flex: 1, padding: '11px',
    background: '#1d4ed8', border: 'none',
    borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 800,
    cursor: 'pointer', fontFamily: 'inherit',
  },
}
