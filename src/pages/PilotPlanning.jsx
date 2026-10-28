// PilotPlanning.jsx
// Public page for fixed pilots — accessible via a unique token link (no login required).
// Visual style matches the admin Dashboard:
//   • Week view: 7-column grid with status badge inside each cell
//   • Day view: horizontal day strip + full-width slot rows
//   • Multi-select mode: select multiple slots → bulk mark unavailable
//   • Booked slots show "Booké" (not pax count)

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/pilot-planning`
const AUTH_HEADERS = { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }

const ALL_SLOTS = ['08:00', '09:15', '10:30', '11:45', '13:00', '14:15']

const SLOT_END = {
  '08:00': '09:15', '09:15': '10:30', '10:30': '11:45',
  '11:45': '13:00', '13:00': '14:15', '14:15': '15:30',
}

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
    // Prefer canonical pilot_slots date over the denormalized booking_assignments.slot_date
    const d = a.bookings?.pilot_slots?.slot_date || a.slot_date
    const t = a.bookings?.pilot_slots?.slot_time || a.slot_time
    return d === dateStr && t && t.slice(0, 5) === slotTime
  })
}

function getUnavailForSlot(unavailList, dateStr, slotTime) {
  return unavailList.filter(u => {
    if (!(u.start_date <= dateStr && dateStr <= u.end_date)) return false
    if (u.slot_time === null) return true
    return u.slot_time.slice(0, 5) === slotTime
  })
}

function getFullDayUnavail(unavailList, dateStr) {
  return unavailList.filter(u =>
    u.start_date <= dateStr && dateStr <= u.end_date && u.slot_time === null
  )
}

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

  // Multi-select: pilot selects several slots then bulk-marks them unavailable
  const [selectMode, setSelectMode]       = useState(false)
  const [selectedSlots, setSelectedSlots] = useState(new Set())   // keys: "dateStr|slotTime"

  // ── fetch ─────────────────────────────────────────────────────────────────
  // silent=true → background refresh (no spinner, no error banner reset)
  const fetchPlanning = useCallback(async (week, silent = false) => {
    if (!silent) { setLoading(true); setError(null) }
    try {
      const res  = await fetch(`${FUNCTION_URL}?token=${token}&week=${week}`, { headers: AUTH_HEADERS })
      const data = await res.json()
      if (!res.ok) {
        if (!silent) setError(data.error || 'Erreur réseau')
        return
      }
      setColleague(data.colleague)
      setAssignments(data.assignments || [])
      setUnavailability(data.unavailability || [])
    } catch { if (!silent) setError('Impossible de charger le planning.') }
    finally   { if (!silent) setLoading(false) }
  }, [token])

  // Initial load when week changes
  useEffect(() => { fetchPlanning(weekStart) }, [fetchPlanning, weekStart])

  // Auto-refresh every 60 s — keeps the page live without manual reload
  const weekStartRef = useRef(weekStart)
  useEffect(() => { weekStartRef.current = weekStart }, [weekStart])
  useEffect(() => {
    const id = setInterval(() => fetchPlanning(weekStartRef.current, true), 60_000)
    return () => clearInterval(id)
  }, [fetchPlanning])

  // ── navigation ────────────────────────────────────────────────────────────
  function prevWeek() {
    const s = toISO(addDays(new Date(weekStart + 'T00:00:00'), -7))
    setWeekStart(s)
    if (viewMode === 'day') setSelectedDay(toISO(addDays(new Date(selectedDay + 'T00:00:00'), -7)))
  }
  function nextWeek() {
    const s = toISO(addDays(new Date(weekStart + 'T00:00:00'), +7))
    setWeekStart(s)
    if (viewMode === 'day') setSelectedDay(toISO(addDays(new Date(selectedDay + 'T00:00:00'), +7)))
  }
  function prevDay() {
    const prev = toISO(addDays(new Date(selectedDay + 'T00:00:00'), -1))
    const mon  = toISO(getMondayOf(new Date(prev + 'T00:00:00')))
    if (mon !== weekStart) setWeekStart(mon)
    setSelectedDay(prev)
  }
  function nextDay() {
    const next = toISO(addDays(new Date(selectedDay + 'T00:00:00'), +1))
    const mon  = toISO(getMondayOf(new Date(next + 'T00:00:00')))
    if (mon !== weekStart) setWeekStart(mon)
    setSelectedDay(next)
  }

  // ── single-cell toggle: tap DISPO → pas dispo, tap PAS DISPO → dispo ────────
  async function toggleCellAvail(dateStr, slotTime, status) {
    if (status === 'booked' || saving) return
    setSaving(true)
    try {
      if (status === 'available') {
        // Mark this slot unavailable
        await fetch(FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
          body: JSON.stringify({ token, action: 'add_unavail', start_date: dateStr, end_date: dateStr, slot_time: slotTime }),
        })
      } else if (status === 'unavailable') {
        // Remove all unavailability entries covering this slot
        const matches = getUnavailForSlot(unavailability, dateStr, slotTime)
        for (const u of matches) {
          await fetch(FUNCTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
            body: JSON.stringify({ token, action: 'remove_unavail', id: u.id }),
          })
        }
      }
      await fetchPlanning(weekStart)
    } finally { setSaving(false) }
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
    } finally { setSaving(false); setShowRangeModal(false) }
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
    } finally { setSaving(false) }
  }

  // Bulk: mark all selected slots unavailable in one sweep, single refetch at the end
  async function markSelectedUnavail() {
    if (!selectedSlots.size) return
    setSaving(true)
    try {
      for (const key of selectedSlots) {
        const [dateStr, slotTime] = key.split('|')
        await fetch(FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
          body: JSON.stringify({ token, action: 'add_unavail', start_date: dateStr, end_date: dateStr, slot_time: slotTime }),
        })
      }
      await fetchPlanning(weekStart)
    } finally {
      setSaving(false)
      setSelectedSlots(new Set())
      setSelectMode(false)
    }
  }

  // Bulk: mark all selected slots available (remove unavailability entries)
  async function markSelectedDispo() {
    if (!selectedSlots.size) return
    setSaving(true)
    try {
      for (const key of selectedSlots) {
        const [dateStr, slotTime] = key.split('|')
        const matches = getUnavailForSlot(unavailability, dateStr, slotTime)
        for (const u of matches) {
          await fetch(FUNCTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
            body: JSON.stringify({ token, action: 'remove_unavail', id: u.id }),
          })
        }
      }
      await fetchPlanning(weekStart)
    } finally {
      setSaving(false)
      setSelectedSlots(new Set())
      setSelectMode(false)
    }
  }

  function toggleSlotSelect(dateStr, slotTime) {
    const key = `${dateStr}|${slotTime}`
    setSelectedSlots(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function cancelSelectMode() {
    setSelectedSlots(new Set())
    setSelectMode(false)
  }

  // ── derived ───────────────────────────────────────────────────────────────
  const weekDays = Array.from({ length: 7 }, (_, i) =>
    toISO(addDays(new Date(weekStart + 'T00:00:00'), i))
  )
  const todayStr       = toISO(new Date())
  const weekLabel      = `${formatDate(weekStart)} – ${formatDate(toISO(addDays(new Date(weekStart + 'T00:00:00'), 6)))}`
  const multiDayRanges = unavailability.filter(u => u.start_date !== u.end_date)
  const selectionCount = selectedSlots.size

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
        {/* Left: logo + pilot name */}
        <div style={s.topLeft}>
          <img src="/logo-icon.png" alt="Logo" style={{ height: 32, display: 'block', flexShrink: 0 }}
            onError={e => { e.target.style.display = 'none' }} />
          <span style={s.pilotName}>{colleague?.name}</span>
        </div>
        {/* Center: view toggle */}
        <div style={s.viewToggle}>
          <button style={{ ...s.toggleBtn, ...(viewMode === 'week' ? s.toggleBtnActive : {}) }}
            onClick={() => setViewMode('week')}>📅 Semaine</button>
          <button style={{ ...s.toggleBtn, ...(viewMode === 'day' ? s.toggleBtnActive : {}) }}
            onClick={() => setViewMode('day')}>📆 Jour</button>
        </div>
        {/* Right spacer — mirrors left to keep toggle truly centred */}
        <div style={s.topRight} />
      </div>

      {/* ── Navigation bar ──────────────────────────────────────────────── */}
      <div style={s.navBar}>
        <button style={s.navBtn} onClick={prevWeek}>‹ Préc.</button>
        <span style={s.navLabel}>{weekLabel}</span>
        <button style={s.navBtn} onClick={nextWeek}>Suiv. ›</button>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          WEEK VIEW
          ════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'week' && (
        <>
          <div style={s.gridScroll}>
            <div style={s.grid}>

              {/* Row 0: day headers */}
              <div style={s.gridCorner} />
              {weekDays.map((dateStr, i) => {
                const isToday = dateStr === todayStr
                const dayNum  = new Date(dateStr + 'T00:00:00').getDate()
                return (
                  <div key={dateStr} style={s.gridDayHeader}
                    onClick={() => { if (!selectMode) { setSelectedDay(dateStr); setViewMode('day') } }}>
                    <span style={s.gridDayShort}>{DAY_LABELS_SHORT[i]}</span>
                    <span style={{ ...s.gridDayNum, ...(isToday ? s.gridDayNumToday : {}) }}>
                      {dayNum}
                    </span>
                  </div>
                )
              })}

              {/* Rows 1-6: time slots */}
              {ALL_SLOTS.map((slotTime, si) => (
                <React.Fragment key={slotTime}>
                  <div style={s.gridHourLabel}>{HOUR_LABELS[si]}</div>
                  {weekDays.map(dateStr => {
                    const status   = slotStatus(assignments, unavailability, dateStr, slotTime)
                    const key      = `${dateStr}|${slotTime}`
                    const checked  = selectedSlots.has(key)
                    const isBooked = status === 'booked'

                    function handleCellClick() {
                      if (selectMode) {
                        if (!isBooked) toggleSlotSelect(dateStr, slotTime)
                      } else {
                        // Tap dispo → pas dispo, tap pas dispo → dispo, tap booké → rien
                        toggleCellAvail(dateStr, slotTime, status)
                      }
                    }

                    return (
                      <div key={dateStr} style={s.gridCell} onClick={handleCellClick}>
                        <div style={{
                          ...s.cellBlock,
                          ...(status === 'available'   ? s.cellAvail   : {}),
                          ...(status === 'unavailable' ? s.cellUnavail : {}),
                          ...(status === 'booked'      ? s.cellBooked  : {}),
                          ...(checked                  ? s.cellSelected : {}),
                        }}>
                          {/* Checkbox (top-right, select mode only, non-booked) */}
                          {selectMode && !isBooked && (
                            <div style={{ ...s.checkCircle, ...(checked ? s.checkCircleOn : {}) }}>
                              {checked && <span style={{ fontSize: 9, lineHeight: 1 }}>✓</span>}
                            </div>
                          )}

                          {/* Status badge centered in cell */}
                          <div style={{
                            ...s.cellBadge,
                            ...(status === 'available'   ? s.cellBadgeAvail   : {}),
                            ...(status === 'unavailable' ? s.cellBadgeUnavail : {}),
                            ...(status === 'booked'      ? s.cellBadgeBooked  : {}),
                          }}>
                            {status === 'available'   && 'DISPO'}
                            {status === 'unavailable' && 'PAS DISPO'}
                            {status === 'booked'      && 'BOOKÉ'}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </React.Fragment>
              ))}

            </div>
          </div>

          <div style={{ padding: '10px 16px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button style={s.vacationBtn}
              onClick={() => { setRangeStart(''); setRangeEnd(''); setShowRangeModal(true) }}>
              🏖️ Marquer indispo sur une période
            </button>
            {!selectMode && (
              <button style={s.selectInlineBtn} onClick={() => setSelectMode(true)}>
                ☑ Sélectionner des créneaux
              </button>
            )}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          DAY VIEW
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
                    ...(isToday    ? s.dayStripNumToday    : {}),
                    ...(isSelected ? s.dayStripNumSelected : {}),
                  }}>
                    {dayNum}
                  </span>
                  {bookedCnt > 0 && <span style={s.dayStripDot}>{bookedCnt}</span>}
                </button>
              )
            })}
          </div>

          {/* Day prev/next */}
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
              if (fullDayUnavail.length > 0) return (
                <div style={s.fullDayBanner}>
                  <span>🚫 Journée entière indisponible</span>
                  <button style={s.btnCancelFull}
                    onClick={() => fullDayUnavail.forEach(u => removeUnavail(u.id))}>
                    Annuler
                  </button>
                </div>
              )
              return ALL_SLOTS.map(slotTime => {
                const status   = slotStatus(assignments, unavailability, dateStr, slotTime)
                const unavails = getUnavailForSlot(unavailability, dateStr, slotTime)
                  .filter(u => u.slot_time !== null)
                const isAvail   = status === 'available'
                const isUnavail = status === 'unavailable'
                const isBooked  = status === 'booked'
                return (
                  <div key={slotTime} style={s.slotRow}>
                    <div style={s.slotRowHour}>{slotTime.slice(0, 5)}</div>
                    <div style={{
                      ...s.slotRowBlock,
                      ...(isAvail   ? s.slotAvail   : {}),
                      ...(isUnavail ? s.slotUnavail : {}),
                      ...(isBooked  ? s.slotBooked  : {}),
                    }}>
                      <div style={s.slotRowInfo}>
                        <div style={s.slotRowRange}>{slotTime} – {SLOT_END[slotTime]}</div>
                        <div style={s.slotRowStatusLabel}>
                          {isAvail   && 'Libre'}
                          {isUnavail && 'Pas dispo'}
                          {isBooked  && 'Booké'}
                        </div>
                      </div>
                      {isAvail && (
                        <button style={s.badgeDispo} disabled={saving}
                          onClick={() => addUnavail({ start_date: dateStr, end_date: dateStr, slot_time: slotTime })}>
                          DISPO
                        </button>
                      )}
                      {isUnavail && (
                        <button style={s.badgePasDispo} disabled={saving}
                          onClick={() => unavails.forEach(u => removeUnavail(u.id))}>
                          PAS DISPO
                        </button>
                      )}
                      {isBooked && <span style={s.badgeLocked}>🔒</span>}
                    </div>
                  </div>
                )
              })
            })()}
          </div>

          {!getFullDayUnavail(unavailability, selectedDay).length && (
            <div style={{ padding: '4px 16px 4px' }}>
              <button style={s.btnFullDay}
                onClick={() => addUnavail({ start_date: selectedDay, end_date: selectedDay })}>
                🚫 Indispo toute la journée
              </button>
            </div>
          )}

          <div style={{ padding: '4px 16px 12px' }}>
            <button style={s.vacationBtn}
              onClick={() => { setRangeStart(''); setRangeEnd(''); setShowRangeModal(true) }}>
              🏖️ Marquer indispo sur une période
            </button>
          </div>
        </>
      )}

      {/* ── Multi-day ranges list ────────────────────────────────────────── */}
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

      {/* FAB removed — select button is now inline below the vacation button */}

      {/* ════════════════════════════════════════════════════════════════════
          BULK ACTION BAR — pinned bottom when select mode is active
          ════════════════════════════════════════════════════════════════════ */}
      {selectMode && (
        <div style={s.bulkBar}>
          <span style={s.bulkCount}>
            {selectionCount === 0
              ? '0 créneaux sélectionnés'
              : `${selectionCount} créneau${selectionCount > 1 ? 'x' : ''} sélectionné${selectionCount > 1 ? 's' : ''}`}
          </span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              style={{ ...s.bulkDispoBtn, opacity: selectionCount === 0 || saving ? .4 : 1 }}
              disabled={selectionCount === 0 || saving}
              onClick={markSelectedDispo}
            >
              {saving ? '…' : '✓ DISPO'}
            </button>
            <button
              style={{ ...s.bulkConfirmBtn, opacity: selectionCount === 0 || saving ? .4 : 1 }}
              disabled={selectionCount === 0 || saving}
              onClick={markSelectedUnavail}
            >
              {saving ? '…' : '✕ PAS DISPO'}
            </button>
            <button style={s.bulkCancelBtn} onClick={cancelSelectMode}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: période ──────────────────────────────────────────────── */}
      {showRangeModal && (
        <div style={s.overlay} onClick={() => setShowRangeModal(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>🏖️ Période d'indisponibilité</div>
            <label style={s.label}>Du</label>
            <input type="date" value={rangeStart}
              onChange={e => setRangeStart(e.target.value)} style={s.dateInput} />
            <label style={s.label}>Au</label>
            <input type="date" value={rangeEnd} min={rangeStart}
              onChange={e => setRangeEnd(e.target.value)} style={s.dateInput} />
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
  page: {
    minHeight: '100dvh',
    background: '#080e1a',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    paddingBottom: 80,
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

  // ── Top bar (grid: left | center | right for true centering)
  topBar: {
    display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8,
    padding: '10px 16px',
    background: '#0d1525', borderBottom: '1px solid #1e3a5f44',
  },
  // Left group: logo + pilot name side by side
  topLeft: {
    display: 'flex', alignItems: 'center', gap: 10,
    overflow: 'hidden',
  },
  viewToggle: { display: 'flex', gap: 4 },
  topRight: { flex: 1 }, // spacer mirrors topLeft
  toggleBtn: {
    padding: '7px 11px', background: 'transparent',
    border: '1px solid #1e3a5f', borderRadius: 8,
    color: '#64748b', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  toggleBtnActive: { background: '#1e3a5f', border: '1px solid #3b82f6', color: '#ffffff' },
  pilotName: {
    fontSize: 13, fontWeight: 800, color: '#ffffff',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },

  // ── Nav bar
  navBar: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 16px',
    background: '#0a1220', borderBottom: '1px solid #1e3a5f22',
  },
  navBtn: {
    padding: '6px 12px', background: '#0f1f3d', border: '1px solid #1e3a5f', borderRadius: 8,
    color: '#ffffff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  navLabel: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: 700, color: '#ffffff' },

  // ── Week grid
  gridScroll: { overflowX: 'auto' },
  grid: {
    display: 'grid',
    gridTemplateColumns: '44px repeat(7, 1fr)',
    minWidth: 480,
    borderTop: '1px solid #1e3a5f22',
  },
  gridCorner: {
    background: '#0a1220',
    borderRight: '1px solid #1e3a5f22', borderBottom: '1px solid #1e3a5f22',
  },
  gridDayHeader: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 2, padding: '8px 4px',
    background: '#0d1525',
    borderRight: '1px solid #1e3a5f22', borderBottom: '1px solid #1e3a5f22',
    cursor: 'pointer', userSelect: 'none',
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
  gridDayNumToday: { background: '#1d4ed8', color: '#ffffff' },
  gridHourLabel: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
    padding: '8px 6px 0 0',
    fontSize: 11, fontWeight: 600, color: '#475569',
    background: '#0a1220',
    borderRight: '1px solid #1e3a5f22', borderBottom: '1px solid #1e3a5f22',
    minHeight: 60,
  },
  gridCell: {
    padding: 5, background: '#080e1a',
    borderRight: '1px solid #1e3a5f22', borderBottom: '1px solid #1e3a5f22',
    cursor: 'pointer', minHeight: 64,
  },
  cellBlock: {
    height: '100%', minHeight: 54, borderRadius: 8,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    padding: '4px 2px', position: 'relative', gap: 3,
  },
  cellAvail:    { background: '#2563eb' },
  cellUnavail:  { background: '#1e2a3a', border: '1px solid #334155' },
  cellBooked:   { background: '#166534' },
  // Yellow outline highlight when a slot is selected in select mode
  cellSelected: { outline: '2px solid #facc15', outlineOffset: '-2px' },

  // Checkbox square (top-right inside cell, visible in select mode only) — matches admin dashboard
  checkCircle: {
    position: 'absolute', top: 4, right: 4,
    width: 14, height: 14, borderRadius: 3,
    border: '1.5px solid rgba(255,255,255,.5)',
    background: 'rgba(0,0,0,.25)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', flexShrink: 0,
  },
  checkCircleOn: { background: '#facc15', border: '1.5px solid #facc15', color: '#000' },

  // Small status label centered inside each cell — no background box, just text
  cellBadge: {
    fontSize: 8, fontWeight: 800, letterSpacing: '.07em',
    textTransform: 'uppercase', lineHeight: 1,
  },
  cellBadgeAvail:   { color: 'rgba(255,255,255,.75)' },
  cellBadgeUnavail: { color: '#64748b' },
  cellBadgeBooked:  { color: '#86efac' },

  // ── Day view
  dayStrip: {
    display: 'flex', gap: 4, overflowX: 'auto',
    padding: '10px 12px',
    background: '#0d1525', borderBottom: '1px solid #1e3a5f22',
    scrollbarWidth: 'none',
  },
  dayStripBtn: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    padding: '6px 8px', minWidth: 44,
    background: 'transparent', border: '1px solid transparent', borderRadius: 10,
    cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
  },
  dayStripBtnSelected: { background: '#0f1f3d', border: '1px solid #3b82f6' },
  dayStripShort: { fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' },
  dayStripNum: {
    fontSize: 16, fontWeight: 800, color: '#94a3b8',
    width: 28, height: 28, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  dayStripNumToday:    { background: '#1d4ed8', color: '#fff' },
  dayStripNumSelected: { color: '#ffffff' },
  dayStripDot: {
    width: 16, height: 16, borderRadius: '50%', background: '#16a34a',
    fontSize: 10, fontWeight: 800, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },

  dayNav: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 16px',
    background: '#0a1220', borderBottom: '1px solid #1e3a5f22',
  },
  dayNavBtn: {
    width: 32, height: 32, borderRadius: 8,
    background: '#0f1f3d', border: '1px solid #1e3a5f',
    color: '#fff', fontSize: 18, fontWeight: 700, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  dayNavLabel: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: 700, color: '#ffffff' },

  slotRows: { display: 'flex', flexDirection: 'column', padding: '8px 0' },
  slotRow: {
    display: 'flex', alignItems: 'stretch', gap: 0,
    padding: '3px 12px', minHeight: 72,
  },
  slotRowHour: {
    width: 50, flexShrink: 0, display: 'flex', alignItems: 'flex-start', paddingTop: 12,
    fontSize: 13, fontWeight: 600, color: '#475569',
  },
  slotRowBlock: {
    flex: 1, borderRadius: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 14px', gap: 10,
  },
  slotAvail:   { background: '#2563eb' },
  slotUnavail: { background: '#1e2a3a', border: '1px solid #334155' },
  slotBooked:  { background: '#166534' },
  slotRowInfo: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1 },
  slotRowRange: { fontSize: 14, fontWeight: 700, color: '#ffffff' },
  slotRowStatusLabel: { fontSize: 12, color: 'rgba(255,255,255,.7)' },

  badgeDispo: {
    padding: '6px 14px', borderRadius: 8, background: '#16a34a', border: 'none',
    color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
    letterSpacing: '.04em', flexShrink: 0,
  },
  badgePasDispo: {
    padding: '6px 10px', borderRadius: 8, background: '#374151', border: '1px solid #4b5563',
    color: '#9ca3af', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
    letterSpacing: '.04em', flexShrink: 0,
  },
  badgeLocked: { fontSize: 18, flexShrink: 0 },

  fullDayBanner: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    margin: '8px 12px', padding: '14px 16px',
    background: '#160808', border: '1px solid #7f1d1d55', borderRadius: 10,
    color: '#f87171', fontSize: 13, fontWeight: 600, gap: 10,
  },
  btnCancelFull: {
    padding: '6px 12px', background: 'transparent',
    border: '1px solid #f87171', borderRadius: 6,
    color: '#f87171', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  },
  btnFullDay: {
    width: '100%', padding: '10px',
    background: 'transparent', border: '1px dashed #475569', borderRadius: 8,
    color: '#64748b', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  },
  vacationBtn: {
    width: '100%', padding: '11px',
    background: '#1a1220', border: '1px solid #4c1d9544', borderRadius: 10,
    color: '#c4b5fd', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  },

  // ── Multi-day ranges list
  rangesSection: {
    margin: '8px 16px 0',
    background: '#0d1525', border: '1px solid #1e3a5f33', borderRadius: 12, padding: 14,
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

  // ── Inline select button (below vacation btn)
  selectInlineBtn: {
    width: '100%', padding: '11px',
    background: '#0f1f3d', border: '1px solid #1e3a5f', borderRadius: 10,
    color: '#93c5fd', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  },

  // ── Bulk action bar (fixed bottom, full-width, select mode)
  bulkBar: {
    position: 'fixed', bottom: 0, left: 0, right: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    padding: '12px 16px',
    background: '#0d1525', borderTop: '1px solid #1e3a5f',
    zIndex: 200,
  },
  bulkCancelBtn: {
    padding: '9px 14px', background: 'transparent',
    border: '1px solid #334155', borderRadius: 8,
    color: '#94a3b8', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  bulkCount: {
    fontSize: 13, color: '#e2e8f0', fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  bulkDispoBtn: {
    padding: '10px 16px',
    background: '#14532d', border: '1px solid #16a34a', borderRadius: 8,
    color: '#86efac', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  bulkConfirmBtn: {
    padding: '10px 16px',
    background: '#7f1d1d', border: '1px solid #991b1b', borderRadius: 8,
    color: '#fca5a5', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },

  // ── Modal
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 20,
  },
  modal: {
    background: '#0d1525', border: '1px solid #1e3a5f', borderRadius: 16,
    padding: 24, width: '100%', maxWidth: 360,
  },
  modalTitle: { fontSize: 16, fontWeight: 800, color: '#ffffff', marginBottom: 20 },
  label: {
    display: 'block', fontSize: 12, color: '#ffffff', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6,
  },
  dateInput: {
    width: '100%', padding: '10px 12px',
    background: '#0f1f3d', border: '1px solid #1e3a5f', borderRadius: 8,
    color: '#e2e8f0', fontSize: 14, marginBottom: 14,
    boxSizing: 'border-box', fontFamily: 'inherit',
  },
  btnCancel: {
    flex: 1, padding: '11px',
    background: '#0f1f3d', border: '1px solid #1e3a5f', borderRadius: 8,
    color: '#ffffff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  },
  btnConfirm: {
    flex: 1, padding: '11px',
    background: '#1d4ed8', border: 'none', borderRadius: 8,
    color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
  },
}
