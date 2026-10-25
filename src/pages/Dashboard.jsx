import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSlotsForDate } from '../utils/rules'
import ColleaguePanel from './ColleaguePanel'

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

// ── Calendar grid constants (Google Calendar style)
const HOUR_HEIGHT  = 80   // px per hour
const GRID_START_H = 8    // axis starts at 08:00
const GRID_END_H   = 15   // axis ends at 15:00
const SLOT_DURATION_MIN = 75  // default slot duration in minutes

// Grid hours array: [8, 9, 10, 11, 12, 13, 14, 15]
const GRID_HOURS = Array.from(
  { length: GRID_END_H - GRID_START_H + 1 },
  (_, i) => GRID_START_H + i
)

// Convert "HH:MM:SS" → minutes from midnight
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

// CSS top offset (px) for a given time string
function slotTop(timeStr) {
  const minutes = timeToMinutes(timeStr)
  return ((minutes - GRID_START_H * 60) / 60) * HOUR_HEIGHT
}

// CSS height (px) for a duration in minutes
function slotHeightPx(durationMin = SLOT_DURATION_MIN) {
  return (durationMin / 60) * HOUR_HEIGHT
}

// Format end time string given start time + duration
function slotEndTime(timeStr, durationMin = SLOT_DURATION_MIN) {
  const total = timeToMinutes(timeStr) + durationMin
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

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

  // New booking modal state
  const [newBookingSlot, setNewBookingSlot]   = useState(null)   // { slot, date } | null
  const [nbForm, setNbForm]                   = useState(null)   // form data
  const [nbSaving, setNbSaving]               = useState(false)

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

  // ── openNewBooking ────────────────────────────────────────────────────────
  function openNewBooking(slot, date) {
    if (!slot.is_available) return   // can't book an unavailable slot
    setNewBookingSlot({ slot, date })
    setNbForm({
      contactName:  '',
      contactPhone: '',
      notes:        '',
      passengers:   [{ firstName: '', lastName: '', weight: '', age: '', flightType: 'discovery' }],
    })
  }

  // ── submitNewBooking ──────────────────────────────────────────────────────
  async function submitNewBooking() {
    if (!nbForm || !newBookingSlot) return
    if (!nbForm.contactName.trim()) { alert('Nom du contact requis'); return }
    if (!nbForm.contactPhone.trim()) { alert('Téléphone requis'); return }
    setNbSaving(true)

    const ref = 'MAN-' + Date.now().toString(36).toUpperCase().slice(-6)

    const { data: bk, error: bkErr } = await supabase.from('bookings').insert({
      pilot_slot_id: newBookingSlot.slot.id,
      contact_name:  nbForm.contactName.trim(),
      contact_phone: nbForm.contactPhone.trim(),
      notes:         nbForm.notes.trim() || null,
      status:        'confirmed',
      source:        'manual',
      booking_ref:   ref,
    }).select().single()

    if (bkErr || !bk) { alert('Erreur lors de la création'); setNbSaving(false); return }

    // Insert passengers (skip empty entries)
    for (const p of nbForm.passengers) {
      if (!p.firstName.trim()) continue
      await supabase.from('passengers').insert({
        booking_id:  bk.id,
        first_name:  p.firstName.trim(),
        last_name:   p.lastName.trim(),
        weight_kg:   parseInt(p.weight)  || 0,
        age:         parseInt(p.age)     || 0,
        flight_type: p.flightType,
        price_eur:   p.flightType === 'performance' ? 110 : 90,
      })
    }

    const savedDate = newBookingSlot.date
    setNbSaving(false)
    setNewBookingSlot(null)
    setNbForm(null)
    loadDay(savedDate, true)
    loadWeek(weekStart)
    loadPlanning(savedDate)
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
      <header className="dash-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid #e2e8f0' }}>
        <div className="dash-title">
          <span className="logo">🪂</span>
          <span>{pilot.name}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ColleaguePanel pilot={pilot} />
          <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>Deconnexion</button>
        </div>
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
            /* Outer wrapper scrolls horizontally on mobile */
            <div style={{ overflowX:'auto', WebkitOverflowScrolling:'touch' }}>
            <div className="cal-container" style={{ minWidth: 7*68 + 40 }}>

              {/* ── Day header row ── */}
              <div className="cal-header-row" style={{ display:'flex', borderBottom:'2px solid #cbd5e0', background:'#edf2f7' }}>
                <div className="cal-gutter" style={{ width:40, flexShrink:0, borderRight:'1px solid #cbd5e0' }} />
                {weekDays.map((date, colIdx) => {
                  const d   = new Date(date + 'T00:00:00')
                  const num = d.getDate()
                  const isToday = date === TODAY
                  return (
                    <div key={date}
                      className={`cal-day-header ${isToday ? 'cal-day-header--today' : ''}`}
                      style={{ width:68, flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', padding:'6px 2px', borderRight:'1px solid #cbd5e0', cursor:'pointer', background: isToday ? '#bee3f8' : undefined }}
                      onClick={() => { setSelectedDate(date); setViewMode('day'); loadDay(date) }}>
                      <span className="cal-day-name" style={{ fontSize:'0.6rem', fontWeight:800, textTransform:'uppercase', color:'#4a5568' }}>{DAY_LABELS[colIdx]}</span>
                      <span className={`cal-day-num ${isToday ? 'cal-day-num--today' : ''}`} style={{ fontSize:'1rem', fontWeight:800, width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:'50%', background: isToday ? '#2b6cb0' : undefined, color: isToday ? 'white' : '#1a202c' }}>{num}</span>
                    </div>
                  )
                })}
              </div>

              {/* ── Grid body (scrollable vertically) ── */}
              <div className="cal-body" style={{ display:'flex', overflowY:'auto', maxHeight:'58vh' }}>

                {/* Time axis */}
                <div className="cal-time-axis" style={{ width:40, flexShrink:0, borderRight:'1px solid #cbd5e0' }}>
                  {GRID_HOURS.map(h => (
                    <div key={h} className="cal-hour-label"
                      style={{ height: HOUR_HEIGHT, lineHeight: `${HOUR_HEIGHT}px`, fontSize:'0.62rem', color:'#718096', fontWeight:700, textAlign:'right', paddingRight:4, boxSizing:'border-box' }}>
                      {`${String(h).padStart(2, '0')}h`}
                    </div>
                  ))}
                </div>

                {/* Day columns */}
                {weekDays.map((date) => {
                  const { slots: daySlots = [], bookings: dayBookings = [] } = weekData[date] || {}
                  const bkBySlot = dayBookings.reduce((acc, b) => {
                    acc[b.pilot_slot_id] = acc[b.pilot_slot_id] || []
                    acc[b.pilot_slot_id].push(b)
                    return acc
                  }, {})
                  const isToday = date === TODAY

                  return (
                    <div key={date}
                      className={`cal-day-col ${isToday ? 'cal-day-col--today' : ''}`}
                      style={{ width:68, flexShrink:0, position:'relative', borderRight:'1px solid #cbd5e0', minHeight: HOUR_HEIGHT * (GRID_END_H - GRID_START_H), background: isToday ? '#eff6ff' : '#ffffff' }}>

                      {/* Subtle hour lines only (no half-hour noise) */}
                      {GRID_HOURS.map((h, i) => (
                        <div key={h} style={{ position:'absolute', left:0, right:0, top: i * HOUR_HEIGHT, height:1, background:'#e2e8f0', pointerEvents:'none' }} />
                      ))}

                      {/* Slot blocks */}
                      {daySlots.map(slot => {
                        // Skip slots outside the visible grid range
                        const slotMin = timeToMinutes(slot.slot_time)
                        if (slotMin < GRID_START_H * 60 || slotMin >= GRID_END_H * 60) return null

                        const bks           = bkBySlot[slot.id] || []
                        const status        = slotWeekStatus(slot, bks)
                        const { name, pax } = slotWeekLabel(slot, bks)
                        const firstActive   = bks.find(b => b.status === 'pending' || b.status === 'confirmed')
                        const activeBks     = bks.filter(b => b.status === 'pending' || b.status === 'confirmed')
                        const totalPaxW     = activeBks.reduce((n, b) => n + (b.passengers?.length || 0), 0)
                        const remainingW    = (slot.capacity || 4) - totalPaxW
                        const top           = slotTop(slot.slot_time)
                        const height        = slotHeightPx() - 8
                        const endTime       = slotEndTime(slot.slot_time)

                        // Vivid block colours for week view — all slots clearly visible
                        let wBg, wColor, wBorder
                        if (activeBks.some(b => b.status === 'confirmed')) {
                          wBg = '#16a34a'; wColor = 'white'; wBorder = '#166534'
                        } else if (activeBks.some(b => b.status === 'pending')) {
                          wBg = '#f59e0b'; wColor = 'white'; wBorder = '#b45309'
                        } else if (!slot.is_available) {
                          wBg = '#94a3b8'; wColor = 'white'; wBorder = '#475569'
                        } else {
                          wBg = '#3b82f6'; wColor = 'white'; wBorder = '#1d4ed8'
                        }

                        return (
                          <div key={slot.id}
                            className={status}
                            style={{ position:'absolute', left:4, right:4, top, height, borderRadius:8, background:wBg, borderLeft:`4px solid ${wBorder}`, color:wColor, display:'flex', flexDirection:'column', overflow:'hidden', cursor:'pointer', boxShadow:'0 2px 8px rgba(0,0,0,0.28)' }}
                            onClick={() => {
                              if (firstActive) {
                                setSelectedBooking(firstActive)
                              } else {
                                openNewBooking(slot, date)
                              }
                            }}>
                            <span style={{ fontSize:'0.55rem', fontWeight:700, padding:'2px 4px 0', opacity:0.85 }}>
                              {slot.slot_time.slice(0, 5)}
                            </span>
                            <span style={{ fontSize:'0.65rem', fontWeight:800, padding:'0 4px', lineHeight:1.2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
                            {pax !== null && (
                              <span style={{ fontSize:'0.6rem', fontWeight:700, padding:'0 4px', opacity:0.85 }}>{pax} pax</span>
                            )}
                            {/* "+" button when there's capacity remaining — hidden on colleague/external slots */}
                            {firstActive && remainingW > 0 && slot.is_available && firstActive.source !== 'colleague' && (
                              <button
                                style={{ marginTop:'auto', alignSelf:'flex-end', background:'rgba(255,255,255,0.3)', color:'white', border:'none', borderRadius:4, fontSize:'0.7rem', fontWeight:800, padding:'1px 5px', cursor:'pointer', lineHeight:1.4, margin:'2px' }}
                                onClick={e => { e.stopPropagation(); openNewBooking(slot, date) }}
                                title={`${remainingW} place${remainingW > 1 ? 's' : ''} restante${remainingW > 1 ? 's' : ''}`}>
                                +{remainingW}
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
            </div>
          )}

          {/* Calendar legend */}
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

          {/* ── Day calendar grid (Google Agenda style) ── */}
          {loading ? <p className="loading">Chargement...</p> : (
            <div style={{ margin:'8px', border:'1px solid #cbd5e0', borderRadius:12, overflow:'hidden', background:'#f8fafc' }}>
              <div style={{ display:'flex', overflowY:'auto', maxHeight:'62vh' }}>

                {/* Time axis */}
                <div style={{ width:44, flexShrink:0, borderRight:'1px solid #e2e8f0' }}>
                  {GRID_HOURS.map(h => (
                    <div key={h} style={{ height:HOUR_HEIGHT, display:'flex', alignItems:'flex-start', justifyContent:'flex-end', paddingRight:6, paddingTop:3, fontSize:'0.65rem', color:'#a0aec0', fontWeight:600, boxSizing:'border-box' }}>
                      {`${String(h).padStart(2,'0')}:00`}
                    </div>
                  ))}
                </div>

                {/* Single day column */}
                <div style={{ flex:1, position:'relative', minHeight: HOUR_HEIGHT * (GRID_END_H - GRID_START_H) }}>

                  {/* Hour lines */}
                  {GRID_HOURS.map((h, i) => (
                    <div key={h} style={{ position:'absolute', left:0, right:0, top: i * HOUR_HEIGHT, height:1, background:'#e2e8f0', pointerEvents:'none' }} />
                  ))}
                  {/* Half-hour lines */}
                  {GRID_HOURS.slice(0,-1).map((h, i) => (
                    <div key={`h-${h}`} style={{ position:'absolute', left:0, right:0, top: i * HOUR_HEIGHT + HOUR_HEIGHT/2, height:1, background:'#f0f4f8', pointerEvents:'none' }} />
                  ))}

                  {/* Slot blocks */}
                  {slots.map(slot => {
                    const slotMin = timeToMinutes(slot.slot_time)
                    if (slotMin < GRID_START_H * 60 || slotMin >= GRID_END_H * 60) return null

                    const slotBookings = bookingsBySlot[slot.id] || []
                    const pendingBks   = slotBookings.filter(b => b.status === 'pending')
                    const confirmedBks = slotBookings.filter(b => b.status === 'confirmed')
                    const firstActive  = [...pendingBks, ...confirmedBks][0]

                    // Remaining capacity: slot.capacity minus all active passengers
                    const activeBks    = [...pendingBks, ...confirmedBks]
                    const totalPax     = activeBks.reduce((n, b) => n + (b.passengers?.length || 0), 0)
                    const remaining    = (slot.capacity || 4) - totalPax

                    const top    = slotTop(slot.slot_time)
                    const height = slotHeightPx() - 3
                    const endT   = slotEndTime(slot.slot_time)

                    // Vivid colours — every slot is a clearly visible rectangle
                    let bg, border, color, label
                    if (confirmedBks.length > 0) {
                      bg = '#16a34a'; border = '#15803d'; color = 'white'; label = 'Confirmé'
                    } else if (pendingBks.length > 0) {
                      bg = '#f59e0b'; border = '#d97706'; color = 'white'; label = 'En attente'
                    } else if (!slot.is_available) {
                      bg = '#94a3b8'; border = '#64748b'; color = 'white'; label = 'Pas dispo'
                    } else {
                      bg = '#3b82f6'; border = '#2563eb'; color = 'white'; label = 'Libre'
                    }

                    const activeBooking = firstActive
                    const timeLabel     = `${slot.slot_time.slice(0,5)} – ${endT}`

                    return (
                      <div key={slot.id}
                        style={{ position:'absolute', left:6, right:6, top, height, borderRadius:8, background:bg, borderLeft:`4px solid ${border}`, color, display:'flex', alignItems:'stretch', overflow:'hidden', cursor:'pointer', boxShadow:'0 1px 3px rgba(0,0,0,0.06)' }}
                        onClick={() => activeBooking ? setSelectedBooking(activeBooking) : openNewBooking(slot, selectedDate)}>

                        {/* Main info */}
                        <div style={{ flex:1, padding:'6px 10px', display:'flex', flexDirection:'column', justifyContent:'center', gap:2 }}>
                          <span style={{ fontSize:'0.7rem', fontWeight:700, opacity:0.75 }}>{timeLabel}</span>
                          {activeBooking ? (
                            <>
                              <span style={{ fontSize:'0.85rem', fontWeight:800, lineHeight:1.2 }}>
                                {activeBooking.source === 'colleague'
                                  ? `Pour ${activeBooking.contact_name}`
                                  : activeBooking.contact_name}
                              </span>
                              <span style={{ fontSize:'0.72rem', fontWeight:600, opacity:0.8 }}>
                                {activeBooking.source === 'colleague'
                                  ? 'Demande collègue'
                                  : `${totalPax} pax · ${remaining} place${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}`}
                              </span>
                            </>
                          ) : (
                            <span style={{ fontSize:'0.78rem', fontWeight:600 }}>{label}</span>
                          )}
                        </div>

                        {/* Add booking button when slot has bookings but capacity remains */}
                        {activeBooking && remaining > 0 && slot.is_available && (
                          <button
                            style={{ alignSelf:'stretch', padding:'0 10px', background:'#3182ce', color:'white', border:'none', fontSize:'1rem', fontWeight:800, cursor:'pointer', borderLeft:'1px solid rgba(255,255,255,0.3)' }}
                            onClick={e => { e.stopPropagation(); openNewBooking(slot, selectedDate) }}
                            title={`Ajouter une réservation (${remaining} place${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''})`}>
                            +
                          </button>
                        )}

                        {/* DISPO toggle on the right (only for non-booked slots) */}
                        {!activeBooking && (
                          <button
                            style={{ alignSelf:'stretch', padding:'0 12px', background: slot.is_available ? '#22c55e' : '#94a3b8', color:'white', border:'none', fontSize:'0.65rem', fontWeight:800, letterSpacing:'0.05em', cursor:'pointer', borderLeft:'1px solid rgba(255,255,255,0.3)', whiteSpace:'nowrap' }}
                            onClick={e => { e.stopPropagation(); toggleAvailability(slot) }}>
                            {slot.is_available ? 'DISPO' : 'PAS\nDISPO'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── New booking modal ── */}
      {newBookingSlot && nbForm && (
        <div className="modal-overlay" onClick={() => { setNewBookingSlot(null); setNbForm(null) }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Nouvelle réservation</h2>
              <button className="btn-ghost" onClick={() => { setNewBookingSlot(null); setNbForm(null) }}>✕</button>
            </div>

            {/* Slot info */}
            <div style={{ background:'#ebf8ff', borderRadius:8, padding:'8px 12px', marginBottom:12, fontSize:'0.82rem', color:'#2b6cb0', fontWeight:600 }}>
              📅 {new Date(newBookingSlot.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' })}
              &nbsp;· {newBookingSlot.slot.slot_time.slice(0,5)} – {slotEndTime(newBookingSlot.slot.slot_time)}
            </div>

            {/* Contact */}
            <div className="edit-section">
              <label className="edit-label">Nom du contact *</label>
              <input className="edit-input" placeholder="Ex: Martin Dupont" value={nbForm.contactName}
                onChange={e => setNbForm(f => ({ ...f, contactName: e.target.value }))} />
              <label className="edit-label">Téléphone *</label>
              <input className="edit-input" type="tel" placeholder="Ex: 0692 12 34 56" value={nbForm.contactPhone}
                onChange={e => setNbForm(f => ({ ...f, contactPhone: e.target.value }))} />
            </div>

            {/* Passengers */}
            <div className="edit-section">
              <div className="edit-section-title">Passagers</div>
              {nbForm.passengers.map((p, i) => (
                <div key={i} className="modal-pax-card" style={{ position:'relative' }}>
                  <div className="modal-pax-name" style={{ marginBottom:8 }}>Passager {i + 1}</div>
                  {nbForm.passengers.length > 1 && (
                    <button className="btn-ghost-small" style={{ position:'absolute', top:8, right:8 }}
                      onClick={() => setNbForm(f => ({ ...f, passengers: f.passengers.filter((_, idx) => idx !== i) }))}>✕</button>
                  )}
                  <div className="field-row" style={{ display:'flex', gap:8 }}>
                    <div style={{ flex:1 }}>
                      <label className="edit-label">Prénom</label>
                      <input className="edit-input" placeholder="Prénom" value={p.firstName}
                        onChange={e => setNbForm(f => ({ ...f, passengers: f.passengers.map((px,idx) => idx===i ? {...px, firstName:e.target.value} : px) }))} />
                    </div>
                    <div style={{ flex:1 }}>
                      <label className="edit-label">Nom</label>
                      <input className="edit-input" placeholder="Nom" value={p.lastName}
                        onChange={e => setNbForm(f => ({ ...f, passengers: f.passengers.map((px,idx) => idx===i ? {...px, lastName:e.target.value} : px) }))} />
                    </div>
                  </div>
                  <div className="field-row" style={{ display:'flex', gap:8 }}>
                    <div style={{ flex:1 }}>
                      <label className="edit-label">Poids (kg)</label>
                      <input className="edit-input" type="number" min="10" max="120" placeholder="Ex: 70" value={p.weight}
                        onChange={e => setNbForm(f => ({ ...f, passengers: f.passengers.map((px,idx) => idx===i ? {...px, weight:e.target.value} : px) }))} />
                    </div>
                    <div style={{ flex:1 }}>
                      <label className="edit-label">Âge</label>
                      <input className="edit-input" type="number" min="6" max="99" placeholder="Ex: 35" value={p.age}
                        onChange={e => setNbForm(f => ({ ...f, passengers: f.passengers.map((px,idx) => idx===i ? {...px, age:e.target.value} : px) }))} />
                    </div>
                  </div>
                  <div>
                    <label className="edit-label">Type de vol</label>
                    <select className="edit-input" value={p.flightType}
                      onChange={e => setNbForm(f => ({ ...f, passengers: f.passengers.map((px,idx) => idx===i ? {...px, flightType:e.target.value} : px) }))}>
                      <option value="discovery">Découverte (90 €)</option>
                      <option value="performance">Performance (110–120 €)</option>
                    </select>
                  </div>
                </div>
              ))}
              {nbForm.passengers.length < 4 && (
                <button className="btn-secondary" style={{ width:'100%', marginTop:8 }}
                  onClick={() => setNbForm(f => ({ ...f, passengers: [...f.passengers, { firstName:'', lastName:'', weight:'', age:'', flightType:'discovery' }] }))}>
                  + Ajouter un passager
                </button>
              )}
            </div>

            {/* Notes */}
            <div className="edit-section">
              <label className="edit-label">Notes (optionnel)</label>
              <textarea className="edit-input" rows={2} placeholder="Demande spéciale, remarque..." value={nbForm.notes}
                onChange={e => setNbForm(f => ({ ...f, notes: e.target.value }))}
                style={{ resize:'vertical', fontFamily:'inherit', fontSize:'0.85rem' }} />
            </div>

            <div className="booking-actions">
              <button className="btn-confirm" disabled={nbSaving} onClick={submitNewBooking}>
                {nbSaving ? 'Enregistrement...' : '✓ Confirmer la résa'}
              </button>
              <button className="btn-refuse" onClick={() => { setNewBookingSlot(null); setNbForm(null) }}>Annuler</button>
            </div>
          </div>
        </div>
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
