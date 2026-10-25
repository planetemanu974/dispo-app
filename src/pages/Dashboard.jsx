import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSlotsForDate } from '../utils/rules'

const TODAY = new Date().toISOString().split('T')[0]

// ── Helper: generate array of YYYY-MM-DD for N days from a start date
function getDayRange(startDate, count) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(startDate + 'T00:00:00')
    d.setDate(d.getDate() + i)
    return d.toISOString().split('T')[0]
  })
}

// ── Helper: get Monday of the week containing dateStr
function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay() // 0=Sun
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

// ── sendSMS: calls the Supabase Edge Function ──────────────────────────────
async function sendSMS(to, message) {
  try {
    const { data, error } = await supabase.functions.invoke('send-sms', {
      body: { to, message },
    })
    if (error) console.error('SMS error:', error)
    return { data, error }
  } catch (err) {
    console.error('SMS exception:', err)
    return { error: err }
  }
}

// ── Day column labels
const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

export default function Dashboard({ pilot }) {
  const [viewMode, setViewMode]               = useState('week')   // 'week' | 'day'
  const [weekStart, setWeekStart]             = useState(() => getWeekStart(TODAY))
  const [weekData, setWeekData]               = useState({})       // { [date]: { slots, bookings } }
  const [weekLoading, setWeekLoading]         = useState(false)

  // Day view state
  const [selectedDate, setSelectedDate]       = useState(null)
  const [slots, setSlots]                     = useState([])
  const [bookings, setBookings]               = useState([])
  const [pendingAll, setPendingAll]           = useState([])
  const [loading, setLoading]                 = useState(true)
  const [selectedBooking, setSelectedBooking] = useState(null)
  const [editMode, setEditMode]               = useState(false)
  const [editData, setEditData]               = useState(null)
  const [editSlots, setEditSlots]             = useState([])

  // 14-day planning strip state
  const [planning, setPlanning]               = useState({})
  const [planningLoading, setPlanningLoading] = useState(false)

  // ── INIT: runs once on mount ───────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const { data: slotData } = await supabase
        .from('pilot_slots')
        .select('id, slot_date, slot_time')
        .eq('pilot_id', pilot.id)
        .gte('slot_date', TODAY)

      let startDate = TODAY

      if (slotData && slotData.length > 0) {
        const slotIds = slotData.map(s => s.id)
        const slotMap = Object.fromEntries(slotData.map(s => [s.id, s]))

        const { data: pending } = await supabase
          .from('bookings')
          .select('*, passengers(*)')
          .in('pilot_slot_id', slotIds)
          .eq('status', 'pending')
          .order('created_at', { ascending: true })

        if (pending && pending.length > 0) {
          const enriched = pending.map(b => ({
            ...b,
            pilot_slots: slotMap[b.pilot_slot_id],
          }))
          setPendingAll(enriched)

          const earliest = enriched
            .map(b => b.pilot_slots?.slot_date)
            .filter(Boolean)
            .sort()[0]
          if (earliest) startDate = earliest
        }
      }

      setSelectedDate(startDate)
      setWeekStart(getWeekStart(startDate))
      await loadWeek(getWeekStart(startDate))
      await loadDay(startDate)
      loadPlanning(startDate)
    }

    init()
  }, [pilot.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load week when weekStart changes ──────────────────────────────────────
  useEffect(() => {
    if (!weekStart) return
    loadWeek(weekStart)
  }, [weekStart]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reload day view when date changes ─────────────────────────────────────
  useEffect(() => {
    if (selectedDate === null) return
    if (viewMode === 'day') {
      loadDay(selectedDate)
      loadPlanning(selectedDate)
    }
  }, [selectedDate, viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── loadWeek ───────────────────────────────────────────────────────────────
  async function loadWeek(start) {
    setWeekLoading(true)
    const days = getDayRange(start, 7)

    await Promise.all(days.map(d => ensureSlots(d)))

    const { data: slotsData } = await supabase
      .from('pilot_slots').select('*')
      .eq('pilot_id', pilot.id)
      .gte('slot_date', days[0])
      .lte('slot_date', days[6])
      .order('slot_time')

    const slotIds = (slotsData || []).map(s => s.id)
    let bookingsData = []
    if (slotIds.length > 0) {
      const { data } = await supabase
        .from('bookings')
        .select('*, passengers(*), pilot_slots(slot_date, slot_time)')
        .in('pilot_slot_id', slotIds)
        .in('status', ['pending', 'confirmed'])
        .order('created_at')
      bookingsData = data || []
    }

    // Organise by date
    const byDate = {}
    days.forEach(d => { byDate[d] = { slots: [], bookings: [] } })
    ;(slotsData || []).forEach(s => {
      if (byDate[s.slot_date]) byDate[s.slot_date].slots.push(s)
    })
    bookingsData.forEach(b => {
      const d = b.pilot_slots?.slot_date
      if (d && byDate[d]) byDate[d].bookings.push(b)
    })

    setWeekData(byDate)
    setWeekLoading(false)
  }

  // ── loadDay ────────────────────────────────────────────────────────────────
  async function loadDay(date, silent = false) {
    if (!silent) setLoading(true)
    await ensureSlots(date)

    const { data: slotsData } = await supabase
      .from('pilot_slots').select('*')
      .eq('pilot_id', pilot.id).eq('slot_date', date).order('slot_time')

    const slotIds = (slotsData || []).map(s => s.id)
    let bookingsData = []
    if (slotIds.length > 0) {
      const { data } = await supabase
        .from('bookings').select('*, passengers(*), pilot_slots(slot_date, slot_time)')
        .in('pilot_slot_id', slotIds)
        .in('status', ['pending', 'confirmed'])
        .order('created_at')
      bookingsData = data || []
    }

    setSlots(slotsData || [])
    setBookings(bookingsData)
    setLoading(false)
  }

  // ── loadPlanning ──────────────────────────────────────────────────────────
  async function loadPlanning(fromDate) {
    setPlanningLoading(true)
    const days = getDayRange(fromDate, 14)
    const [dayStart, dayEnd] = [days[0], days[days.length - 1]]

    await Promise.all(days.map(d => ensureSlots(d)))

    const { data: slotData } = await supabase
      .from('pilot_slots').select('id, slot_date')
      .eq('pilot_id', pilot.id)
      .gte('slot_date', dayStart).lte('slot_date', dayEnd)

    if (!slotData || slotData.length === 0) { setPlanningLoading(false); return }

    const slotIds = slotData.map(s => s.id)
    const slotMap = Object.fromEntries(slotData.map(s => [s.id, s.slot_date]))

    const { data: bkData } = await supabase
      .from('bookings').select('id, pilot_slot_id, status')
      .in('pilot_slot_id', slotIds).in('status', ['pending', 'confirmed'])

    const summary = {}
    days.forEach(d => { summary[d] = { pending: 0, confirmed: 0 } })
    ;(bkData || []).forEach(b => {
      const d = slotMap[b.pilot_slot_id]
      if (!d || !summary[d]) return
      if (b.status === 'pending')   summary[d].pending   += 1
      if (b.status === 'confirmed') summary[d].confirmed += 1
    })

    setPlanning(summary)
    setPlanningLoading(false)
  }

  // ── ensureSlots ────────────────────────────────────────────────────────────
  async function ensureSlots(date) {
    const times = getSlotsForDate(new Date(date))
    const inserts = times.map(t => ({
      pilot_id: pilot.id, slot_date: date, slot_time: t,
      is_available: true, booked_count: 0, capacity: 4,
    }))
    await supabase.from('pilot_slots')
      .upsert(inserts, { onConflict: 'pilot_id,slot_date,slot_time', ignoreDuplicates: true })
  }

  // ── toggleAvailability ────────────────────────────────────────────────────
  async function toggleAvailability(slot) {
    await supabase.from('pilot_slots')
      .update({ is_available: !slot.is_available }).eq('id', slot.id)
    loadDay(selectedDate)
    loadWeek(weekStart)
  }

  // ── handleBooking ─────────────────────────────────────────────────────────
  async function handleBooking(bookingId, action) {
    await supabase.from('bookings').update({ status: action }).eq('id', bookingId)
    setSelectedBooking(prev => prev ? { ...prev, status: action } : null)

    if (action === 'confirmed' && selectedBooking?.contact_phone) {
      const slotDate = selectedBooking.pilot_slots?.slot_date || selectedDate
      const slotTime = selectedBooking.pilot_slots?.slot_time?.slice(0, 5) || ''
      const dateLabel = new Date(slotDate + 'T00:00:00').toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long'
      })
      const paxCount = selectedBooking.passengers?.length || 1
      const paxLabel = paxCount > 1 ? `${paxCount} personnes` : '1 personne'
      const confirmMsg =
        `Bonjour, votre vol parapente est confirme pour le ${dateLabel} a ${slotTime} pour ${paxLabel}. ` +
        `RDV plage a cote de Kelonia, navette Planete Parapente. ` +
        `Chaussures fermees obligatoires. Paiement especes/cheque. ` +
        `Manu 0692719749`
      await sendSMS(selectedBooking.contact_phone, confirmMsg)
    }

    const { data: slotData } = await supabase
      .from('pilot_slots').select('id, slot_date, slot_time')
      .eq('pilot_id', pilot.id).gte('slot_date', TODAY)

    if (slotData && slotData.length > 0) {
      const slotIds = slotData.map(s => s.id)
      const slotMap = Object.fromEntries(slotData.map(s => [s.id, s]))
      const { data: pending } = await supabase
        .from('bookings').select('*, passengers(*)')
        .in('pilot_slot_id', slotIds).eq('status', 'pending')
        .order('created_at', { ascending: true })
      const enriched = (pending || []).map(b => ({ ...b, pilot_slots: slotMap[b.pilot_slot_id] }))
      setPendingAll(enriched)
    } else {
      setPendingAll([])
    }

    loadDay(selectedDate, true)
    loadPlanning(selectedDate)
    loadWeek(weekStart)
  }

  // ── derived ───────────────────────────────────────────────────────────────
  const bookingsBySlot = bookings.reduce((acc, b) => {
    acc[b.pilot_slot_id] = acc[b.pilot_slot_id] || []
    acc[b.pilot_slot_id].push(b)
    return acc
  }, {})

  const pendingByDate = pendingAll.reduce((acc, b) => {
    const d = b.pilot_slots?.slot_date
    if (!d) return acc
    acc[d] = acc[d] || []
    acc[d].push(b)
    return acc
  }, {})

  const flightTypeLabel = t => t === 'performance' ? 'Performance' : 'Decouverte'

  // ── handleCancel ──────────────────────────────────────────────────────────
  async function handleCancel(bookingId) {
    if (!window.confirm('Annuler cette reservation ?')) return
    await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)
    setSelectedBooking(null); setEditMode(false)
    const { data: slotData } = await supabase
      .from('pilot_slots').select('id, slot_date, slot_time')
      .eq('pilot_id', pilot.id).gte('slot_date', TODAY)
    if (slotData && slotData.length > 0) {
      const slotIds = slotData.map(s => s.id)
      const slotMap = Object.fromEntries(slotData.map(s => [s.id, s]))
      const { data: pending } = await supabase
        .from('bookings').select('*, passengers(*)')
        .in('pilot_slot_id', slotIds).eq('status', 'pending')
        .order('created_at', { ascending: true })
      setPendingAll((pending || []).map(b => ({ ...b, pilot_slots: slotMap[b.pilot_slot_id] })))
    } else {
      setPendingAll([])
    }
    loadDay(selectedDate)
    loadPlanning(selectedDate)
    loadWeek(weekStart)
  }

  // ── loadEditSlots ─────────────────────────────────────────────────────────
  async function loadEditSlots(date) {
    await ensureSlots(date)
    const { data } = await supabase
      .from('pilot_slots').select('*')
      .eq('pilot_id', pilot.id).eq('slot_date', date).order('slot_time')
    setEditSlots(data || [])
  }

  // ── enterEditMode ─────────────────────────────────────────────────────────
  function enterEditMode() {
    const slotDate = selectedBooking.pilot_slots?.slot_date || selectedDate
    setEditData({
      contact_name:  selectedBooking.contact_name  || '',
      contact_phone: selectedBooking.contact_phone || '',
      slot_date:     slotDate,
      pilot_slot_id: selectedBooking.pilot_slot_id || '',
      passengers: (selectedBooking.passengers || []).map(p => ({ ...p })),
    })
    loadEditSlots(slotDate)
    setEditMode(true)
  }

  // ── handleSaveEdit ────────────────────────────────────────────────────────
  async function handleSaveEdit() {
    await supabase.from('bookings').update({
      contact_name:  editData.contact_name,
      contact_phone: editData.contact_phone,
      pilot_slot_id: editData.pilot_slot_id,
    }).eq('id', selectedBooking.id)

    const originalIds = (selectedBooking.passengers || []).map(p => p.id)
    const keptIds     = editData.passengers.filter(p => p.id).map(p => p.id)
    const removedIds  = originalIds.filter(id => !keptIds.includes(id))
    if (removedIds.length > 0) {
      await supabase.from('passengers').delete().in('id', removedIds)
    }

    for (const p of editData.passengers) {
      if (p.id) {
        await supabase.from('passengers').update({
          first_name: p.first_name, last_name: p.last_name,
          weight_kg:  parseInt(p.weight_kg), age: parseInt(p.age),
          flight_type: p.flight_type,
        }).eq('id', p.id)
      } else {
        await supabase.from('passengers').insert({
          booking_id:  selectedBooking.id,
          first_name:  p.first_name, last_name: p.last_name,
          weight_kg:   parseInt(p.weight_kg), age: parseInt(p.age),
          flight_type: p.flight_type, price_eur: 0,
        })
      }
    }

    const [{ data: updated }, { data: newSlot }] = await Promise.all([
      supabase.from('bookings').select('*, passengers(*)')
        .eq('id', selectedBooking.id).single(),
      supabase.from('pilot_slots').select('slot_date, slot_time')
        .eq('id', editData.pilot_slot_id).single(),
    ])
    setSelectedBooking({ ...updated, pilot_slots: newSlot })
    setEditMode(false)
    const newDate = editData.slot_date
    if (newDate && newDate !== selectedDate) {
      setSelectedDate(newDate)
      setWeekStart(getWeekStart(newDate))
    } else {
      loadDay(selectedDate, true)
      loadPlanning(selectedDate)
      loadWeek(weekStart)
    }
  }

  function changeDate(delta) {
    const d = new Date((selectedDate || TODAY) + 'T00:00:00')
    d.setDate(d.getDate() + delta)
    setSelectedDate(d.toISOString().split('T')[0])
  }

  function changeWeek(delta) {
    const d = new Date(weekStart + 'T00:00:00')
    d.setDate(d.getDate() + delta * 7)
    setWeekStart(d.toISOString().split('T')[0])
  }

  // 14-day strip: always anchored to TODAY
  const planningDays = getDayRange(TODAY, 14)

  function formatDayLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00')
    return {
      day: d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''),
      num: d.getDate(),
    }
  }

  // ── Week view helpers ─────────────────────────────────────────────────────

  // Get the status colour class for a slot in the week view
  function slotWeekStatus(slot, bookingsForSlot) {
    const active = bookingsForSlot.filter(b => b.status === 'pending' || b.status === 'confirmed')
    if (active.some(b => b.status === 'pending'))   return 'week-slot--pending'
    if (active.some(b => b.status === 'confirmed')) return 'week-slot--confirmed'
    if (!slot.is_available)                          return 'week-slot--unavailable'
    return 'week-slot--free'
  }

  // Label shown inside a week slot block
  function slotWeekLabel(slot, bookingsForSlot) {
    const active = bookingsForSlot.filter(b => b.status === 'pending' || b.status === 'confirmed')
    if (active.length === 0) return { name: 'Libre', pax: null }
    // Show first booking's client name + total pax
    const first    = active[0]
    const totalPax = active.reduce((n, b) => n + (b.passengers?.length || 0), 0)
    const name     = first.source === 'colleague'
      ? `Pour ${first.contact_name}`
      : first.contact_name
    return { name, pax: totalPax }
  }

  const weekDays = getDayRange(weekStart, 7)

  // Week range label: "20 – 26 oct. 2026"
  function weekRangeLabel() {
    const start = new Date(weekStart + 'T00:00:00')
    const end   = new Date(weekStart + 'T00:00:00')
    end.setDate(end.getDate() + 6)
    const opts = { day: 'numeric' }
    const optsEnd = { day: 'numeric', month: 'short', year: 'numeric' }
    return `${start.toLocaleDateString('fr-FR', opts)} – ${end.toLocaleDateString('fr-FR', optsEnd)}`
  }

  if (selectedDate === null) return <p className="loading">Chargement...</p>

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="dash-title">
          <span className="logo">🪂</span>
          <span>{pilot.name}</span>
        </div>
        <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>Deconnexion</button>
      </header>

      {/* ── Pending alert ── */}
      {pendingAll.length > 0 && (
        <div className="pending-alert">
          <div className="pending-alert-title">
            🔔 {pendingAll.length} demande{pendingAll.length > 1 ? 's' : ''} en attente
          </div>
          {Object.entries(pendingByDate).map(([date, bks]) => (
            <div key={date} className="pending-alert-date"
              onClick={() => { setSelectedDate(date); setWeekStart(getWeekStart(date)); setViewMode('week') }}>
              <span className="pending-date-label">
                {new Date(date + 'T00:00:00').toLocaleDateString('fr-FR', {
                  weekday: 'short', day: 'numeric', month: 'short'
                })}
              </span>
              <span className="pending-date-count">
                {bks.length} demande{bks.length > 1 ? 's' : ''} →
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── View toggle ── */}
      <div className="view-toggle">
        <button
          className={`view-toggle-btn ${viewMode === 'week' ? 'active' : ''}`}
          onClick={() => setViewMode('week')}>
          📅 Semaine
        </button>
        <button
          className={`view-toggle-btn ${viewMode === 'day' ? 'active' : ''}`}
          onClick={() => { setViewMode('day'); loadDay(selectedDate); loadPlanning(selectedDate) }}>
          📋 Jour
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          WEEK VIEW
         ══════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'week' && (
        <div className="week-view">
          {/* Week navigation */}
          <div className="week-nav">
            <button className="btn-ghost" onClick={() => changeWeek(-1)}>‹ Préc.</button>
            <span className="week-nav-label">{weekRangeLabel()}</span>
            <button className="btn-ghost" onClick={() => changeWeek(1)}>Suiv. ›</button>
          </div>

          {weekLoading ? <p className="loading">Chargement...</p> : (
            <div className="week-grid">
              {weekDays.map((date, colIdx) => {
                const { slots: daySlots, bookings: dayBookings } = weekData[date] || { slots: [], bookings: [] }
                const isToday     = date === TODAY
                const isSelected  = date === selectedDate

                // Group bookings by slot
                const bkBySlot = dayBookings.reduce((acc, b) => {
                  acc[b.pilot_slot_id] = acc[b.pilot_slot_id] || []
                  acc[b.pilot_slot_id].push(b)
                  return acc
                }, {})

                const d   = new Date(date + 'T00:00:00')
                const num = d.getDate()
                const mon = d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')

                return (
                  <div key={date} className={[
                    'week-col',
                    isToday    ? 'week-col--today'    : '',
                    isSelected ? 'week-col--selected' : '',
                  ].join(' ')}>

                    {/* Day header */}
                    <div className="week-col-header"
                      onClick={() => { setSelectedDate(date); setViewMode('day'); loadDay(date) }}>
                      <span className="week-col-day">{DAY_LABELS[colIdx]}</span>
                      <span className="week-col-num">{num}</span>
                      <span className="week-col-mon">{mon}</span>
                    </div>

                    {/* Slots */}
                    <div className="week-col-slots">
                      {daySlots.map(slot => {
                        const bks    = bkBySlot[slot.id] || []
                        const status = slotWeekStatus(slot, bks)
                        const { name, pax } = slotWeekLabel(slot, bks)
                        const firstActive = bks.find(b => b.status === 'pending' || b.status === 'confirmed')

                        return (
                          <div
                            key={slot.id}
                            className={`week-slot ${status}`}
                            onClick={() => {
                              if (firstActive) {
                                setSelectedBooking(firstActive)
                              } else {
                                // Click on free slot → open day view for that date
                                setSelectedDate(date)
                                setViewMode('day')
                                loadDay(date)
                              }
                            }}>
                            <span className="week-slot-time">{slot.slot_time.slice(0, 5)}</span>
                            <span className="week-slot-name">{name}</span>
                            {pax !== null && (
                              <span className="week-slot-pax">
                                {pax} pax
                              </span>
                            )}
                          </div>
                        )
                      })}
                      {daySlots.length === 0 && (
                        <div className="week-slot week-slot--empty">—</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Week legend */}
          <div className="week-legend">
            <span className="legend-item"><span className="legend-dot legend-dot--free" />Libre</span>
            <span className="legend-item"><span className="legend-dot legend-dot--pending" />En attente</span>
            <span className="legend-item"><span className="legend-dot legend-dot--confirmed" />Confirmé</span>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          DAY VIEW
         ══════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'day' && (
        <>
          {/* 14-day planning strip */}
          <div className="planning-strip-wrapper">
            <div className="planning-strip">
              {planningDays.map(date => {
                const { day, num } = formatDayLabel(date)
                const info         = planning[date] || { pending: 0, confirmed: 0 }
                const isSelected   = date === selectedDate
                const isToday      = date === TODAY
                const hasPending   = info.pending > 0
                const hasConfirmed = info.confirmed > 0

                return (
                  <button key={date}
                    className={[
                      'planning-day',
                      isSelected  ? 'planning-day--selected' : '',
                      isToday     ? 'planning-day--today'    : '',
                      hasPending  ? 'planning-day--pending'  : '',
                    ].join(' ')}
                    onClick={() => setSelectedDate(date)}>
                    <span className="planning-day__name">{day}</span>
                    <span className="planning-day__num">{num}</span>
                    <span className="planning-day__dots">
                      {hasPending   && <span className="dot dot--pending"   title="En attente" />}
                      {hasConfirmed && <span className="dot dot--confirmed" title="Confirme" />}
                    </span>
                    {(info.pending + info.confirmed) > 0 && (
                      <span className="planning-day__count">
                        {info.pending + info.confirmed}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Date navigator */}
          <div className="date-bar">
            <button className="btn-ghost" onClick={() => changeDate(-1)}>‹</button>
            <input type="date" value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)} className="date-input" />
            <button className="btn-ghost" onClick={() => changeDate(1)}>›</button>
          </div>

          {/* Slot grid */}
          {loading ? <p className="loading">Chargement...</p> : (
            <div className="slot-grid">
              {slots.map(slot => {
                const slotBookings = bookingsBySlot[slot.id] || []
                const pendingBks   = slotBookings.filter(b => b.status === 'pending')
                const confirmedBks = slotBookings.filter(b => b.status === 'confirmed')
                return (
                  <div key={slot.id}
                    className={`slot-card ${slot.is_available ? 'available' : 'unavailable'}`}>
                    <div className="slot-time">{slot.slot_time.slice(0, 5)}</div>
                    <div className="slot-count">{slot.booked_count}/{slot.capacity} pax</div>
                    <button className={`btn-toggle ${slot.is_available ? 'on' : 'off'}`}
                      onClick={() => toggleAvailability(slot)}>
                      {slot.is_available ? 'DISPO' : 'PAS DISPO'}
                    </button>
                    {pendingBks.map(b => (
                      <div key={b.id} className="booking-card booking-card--pending"
                        onClick={() => setSelectedBooking(b)} style={{ cursor: 'pointer' }}>
                        {b.source === 'colleague'
                          ? <span className="booking-badge booking-badge--colleague">Collegue</span>
                          : <span className="booking-badge booking-badge--pending">En attente</span>
                        }
                        <div className="booking-contact">{b.contact_name}{b.source !== 'colleague' && ` — ${b.contact_phone}`}</div>
                        <div className="booking-pax">
                          {b.source === 'colleague'
                            ? 'Demande collegue →'
                            : `${b.passengers?.length || 0} passager${(b.passengers?.length || 0) > 1 ? 's' : ''} — voir fiche →`
                          }
                        </div>
                      </div>
                    ))}
                    {confirmedBks.map(b => (
                      <div key={b.id} className="booking-card booking-card--confirmed"
                        onClick={() => setSelectedBooking(b)} style={{ cursor: 'pointer' }}>
                        <span className="booking-badge booking-badge--confirmed">✓ Confirme</span>
                        <div className="booking-contact">{b.contact_name}</div>
                        <div className="booking-pax">
                          {b.passengers?.length || 0} passager{(b.passengers?.length || 0) > 1 ? 's' : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── Booking detail modal (shared by both views) ── */}
      {selectedBooking && (
        <div className="modal-overlay" onClick={() => { setSelectedBooking(null); setEditMode(false) }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editMode ? 'Modifier la reservation' : 'Fiche de reservation'}</h2>
              <button className="btn-ghost" onClick={() => { setSelectedBooking(null); setEditMode(false) }}>✕</button>
            </div>

            {/* ── VIEW MODE ── */}
            {!editMode && (
              <>
                <div className="modal-contact">
                  <strong>{selectedBooking.contact_name}</strong><br />
                  📞 {selectedBooking.contact_phone}
                  {selectedBooking.contact_phone && (
                    <a
                      href={`https://wa.me/${(selectedBooking.contact_phone).replace(/\s+/g,'').replace(/^0/,'262')}`}
                      target="_blank" rel="noreferrer"
                      className="btn-whatsapp-contact">
                      💬 Contacter sur WhatsApp
                    </a>
                  )}
                </div>
                <div className="modal-passengers">
                  {selectedBooking.passengers?.map((p, i) => (
                    <div key={p.id} className="modal-pax-card">
                      <div className="modal-pax-name">Passager {i + 1} — {p.first_name} {p.last_name}</div>
                      <div className="modal-pax-details">
                        ⚖️ {p.weight_kg} kg &nbsp;|&nbsp; 🎂 {p.age} ans &nbsp;|&nbsp; ✈️ {flightTypeLabel(p.flight_type)}
                      </div>
                    </div>
                  ))}
                </div>
                {selectedBooking.notes && (
                  <div className="modal-notes">
                    <div className="modal-notes-label">📝 Demande speciale</div>
                    <div className="modal-notes-text">{selectedBooking.notes}</div>
                  </div>
                )}
                <div className="modal-ref">Ref. {selectedBooking.booking_ref || selectedBooking.id?.slice(0, 8).toUpperCase()}</div>

                {selectedBooking.status === 'pending' && (
                  <div className="booking-actions">
                    <button className="btn-confirm"
                      onClick={() => handleBooking(selectedBooking.id, 'confirmed')}>✓ Confirmer</button>
                    <button className="btn-refuse"
                      onClick={() => handleBooking(selectedBooking.id, 'refused')}>✗ Refuser</button>
                  </div>
                )}
                {selectedBooking.status === 'confirmed' && (
                  <div className="booking-whatsapp-actions">
                    <div className="booking-confirmed-label">✓ Vol confirme — SMS envoye au client</div>
                  </div>
                )}
                {selectedBooking.status === 'refused' && (
                  <div className="booking-whatsapp-actions">
                    <div className="booking-confirmed-label" style={{ color: '#e53e3e' }}>✗ Vol refuse</div>
                  </div>
                )}
                {(selectedBooking.status === 'pending' || selectedBooking.status === 'confirmed') && (
                  <div className="booking-manage-actions">
                    <button className="btn-edit" onClick={enterEditMode}>✏️ Modifier la reservation</button>
                    <button className="btn-cancel-booking" onClick={() => handleCancel(selectedBooking.id)}>
                      🗑 Annuler cette reservation
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── EDIT MODE ── */}
            {editMode && editData && (
              <>
                <div className="edit-section">
                  <div className="edit-section-title">Date et creneau</div>
                  <label className="edit-label">Date</label>
                  <input className="edit-input" type="date" value={editData.slot_date} min={TODAY}
                    onChange={e => {
                      const d = e.target.value
                      setEditData(prev => ({ ...prev, slot_date: d, pilot_slot_id: '' }))
                      loadEditSlots(d)
                    }} />
                  <label className="edit-label">Creneau</label>
                  {editSlots.length === 0
                    ? <p style={{ fontSize: '0.85rem', color: '#888', margin: '4px 0' }}>Aucun creneau pour cette date.</p>
                    : <select className="edit-input" value={editData.pilot_slot_id}
                        onChange={e => setEditData(d => ({ ...d, pilot_slot_id: e.target.value }))}>
                        <option value="">— Choisir un creneau —</option>
                        {editSlots.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.slot_time.slice(0, 5)}{!s.is_available ? ' (indispo)' : ''}
                          </option>
                        ))}
                      </select>
                  }
                </div>
                <div className="edit-section">
                  <label className="edit-label">Nom du contact</label>
                  <input className="edit-input" value={editData.contact_name}
                    onChange={e => setEditData(d => ({ ...d, contact_name: e.target.value }))} />
                  <label className="edit-label">Telephone</label>
                  <input className="edit-input" type="tel" value={editData.contact_phone}
                    onChange={e => setEditData(d => ({ ...d, contact_phone: e.target.value }))} />
                </div>
                <div className="edit-section">
                  <div className="edit-section-title">Passagers</div>
                  {editData.passengers.map((p, i) => (
                    <div key={p.id || `new-${i}`} className="modal-pax-card" style={{ position: 'relative' }}>
                      <div className="modal-pax-name" style={{ marginBottom: '8px' }}>Passager {i + 1}</div>
                      {editData.passengers.length > 1 && (
                        <button className="btn-ghost-small" style={{ position: 'absolute', top: 8, right: 8 }}
                          onClick={() => setEditData(d => ({ ...d, passengers: d.passengers.filter((_, idx) => idx !== i) }))}>✕</button>
                      )}
                      <div className="field-row" style={{ display: 'flex', gap: '8px' }}>
                        <div style={{ flex: 1 }}>
                          <label className="edit-label">Prenom</label>
                          <input className="edit-input" value={p.first_name}
                            onChange={e => setEditData(d => ({ ...d, passengers: d.passengers.map((px, idx) => idx === i ? { ...px, first_name: e.target.value } : px) }))} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="edit-label">Nom</label>
                          <input className="edit-input" value={p.last_name}
                            onChange={e => setEditData(d => ({ ...d, passengers: d.passengers.map((px, idx) => idx === i ? { ...px, last_name: e.target.value } : px) }))} />
                        </div>
                      </div>
                      <div className="field-row" style={{ display: 'flex', gap: '8px' }}>
                        <div style={{ flex: 1 }}>
                          <label className="edit-label">Poids (kg)</label>
                          <input className="edit-input" type="number" min="10" max="120" value={p.weight_kg}
                            onChange={e => setEditData(d => ({ ...d, passengers: d.passengers.map((px, idx) => idx === i ? { ...px, weight_kg: e.target.value } : px) }))} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="edit-label">Age</label>
                          <input className="edit-input" type="number" min="6" max="99" value={p.age}
                            onChange={e => setEditData(d => ({ ...d, passengers: d.passengers.map((px, idx) => idx === i ? { ...px, age: e.target.value } : px) }))} />
                        </div>
                      </div>
                      <div>
                        <label className="edit-label">Type de vol</label>
                        <select className="edit-input" value={p.flight_type}
                          onChange={e => setEditData(d => ({ ...d, passengers: d.passengers.map((px, idx) => idx === i ? { ...px, flight_type: e.target.value } : px) }))}>
                          <option value="discovery">Decouverte (90 €)</option>
                          <option value="performance">Performance (110–120 €)</option>
                        </select>
                      </div>
                    </div>
                  ))}
                  {editData.passengers.length < 4 && (
                    <button className="btn-secondary" style={{ width: '100%', marginTop: '8px' }}
                      onClick={() => setEditData(d => ({ ...d, passengers: [...d.passengers, { first_name: '', last_name: '', weight_kg: '', age: '', flight_type: 'discovery' }] }))}>
                      + Ajouter un passager
                    </button>
                  )}
                </div>
                <div className="booking-actions">
                  <button className="btn-confirm" onClick={handleSaveEdit}>✓ Enregistrer</button>
                  <button className="btn-refuse" onClick={() => setEditMode(false)}>Annuler</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
