import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSlotsForDate } from '../utils/rules'

const TODAY = new Date().toISOString().split('T')[0]

export default function Dashboard({ pilot }) {
  // selectedDate starts null — init() sets it after finding pending bookings
  const [selectedDate, setSelectedDate] = useState(null)
  const [slots, setSlots]               = useState([])
  const [bookings, setBookings]         = useState([])
  const [pendingAll, setPendingAll]     = useState([])
  const [loading, setLoading]           = useState(true)
  const [selectedBooking, setSelectedBooking] = useState(null)

  // ── INIT: runs once on mount ───────────────────────────────────────────────
  // Finds the earliest pending booking date, sets selectedDate,
  // THEN calls loadDay — avoids the race condition where loadDay(TODAY)
  // ran before findNextPendingDate() came back.
  useEffect(() => {
    async function init() {
      // Step 1: all future slots for this pilot
      const { data: slotData } = await supabase
        .from('pilot_slots')
        .select('id, slot_date, slot_time')
        .eq('pilot_id', pilot.id)
        .gte('slot_date', TODAY)

      let startDate = TODAY

      if (slotData && slotData.length > 0) {
        const slotIds = slotData.map(s => s.id)
        const slotMap = Object.fromEntries(slotData.map(s => [s.id, s]))

        // Step 2: all pending bookings for those slots
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

          // Find earliest pending date
          const earliest = enriched
            .map(b => b.pilot_slots?.slot_date)
            .filter(Boolean)
            .sort()[0]
          if (earliest) startDate = earliest
        }
      }

      // Load the chosen day, then unlock the UI
      await loadDay(startDate)
      setSelectedDate(startDate)
    }

    init()
  }, [pilot.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reload when user navigates to another date ─────────────────────────────
  // Skips the first render (selectedDate is null until init finishes)
  useEffect(() => {
    if (selectedDate === null) return
    loadDay(selectedDate)
  }, [selectedDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── loadDay ────────────────────────────────────────────────────────────────
  async function loadDay(date) {
    setLoading(true)
    await ensureSlots(date)

    const { data: slotsData } = await supabase
      .from('pilot_slots').select('*')
      .eq('pilot_id', pilot.id).eq('slot_date', date).order('slot_time')

    const slotIds = (slotsData || []).map(s => s.id)
    let bookingsData = []
    if (slotIds.length > 0) {
      const { data } = await supabase
        .from('bookings').select('*, passengers(*)')
        .in('pilot_slot_id', slotIds).eq('status', 'pending').order('created_at')
      bookingsData = data || []
    }

    setSlots(slotsData || [])
    setBookings(bookingsData)
    setLoading(false)
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

  // ── toggleAvailability ─────────────────────────────────────────────────────
  async function toggleAvailability(slot) {
    await supabase.from('pilot_slots')
      .update({ is_available: !slot.is_available }).eq('id', slot.id)
    loadDay(selectedDate)
  }

  // ── handleBooking ──────────────────────────────────────────────────────────
  async function handleBooking(bookingId, action) {
    await supabase.from('bookings').update({ status: action }).eq('id', bookingId)
    setSelectedBooking(null)

    // Refresh the global pending list
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

    loadDay(selectedDate)
  }

  // ── derived ────────────────────────────────────────────────────────────────
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

  const flightTypeLabel = t => t === 'performance' ? 'Performance' : 'Découverte'

  function changeDate(delta) {
    const d = new Date((selectedDate || TODAY) + 'T00:00:00')
    d.setDate(d.getDate() + delta)
    setSelectedDate(d.toISOString().split('T')[0])
  }

  // Show nothing until init has set a date
  if (selectedDate === null) return <p className="loading">Chargement...</p>

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="dash-title">
          <span className="logo">🪂</span>
          <span>{pilot.name}</span>
        </div>
        <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>Déconnexion</button>
      </header>

      {/* ── Pending alert ── */}
      {pendingAll.length > 0 && (
        <div className="pending-alert">
          <div className="pending-alert-title">
            🔔 {pendingAll.length} demande{pendingAll.length > 1 ? 's' : ''} en attente
          </div>
          {Object.entries(pendingByDate).map(([date, bks]) => (
            <div key={date} className="pending-alert-date"
              onClick={() => setSelectedDate(date)}>
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

      {/* ── Date navigator ── */}
      <div className="date-bar">
        <button className="btn-ghost" onClick={() => changeDate(-1)}>‹</button>
        <input type="date" value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)} className="date-input" />
        <button className="btn-ghost" onClick={() => changeDate(1)}>›</button>
      </div>

      {/* ── Slot grid ── */}
      {loading ? <p className="loading">Chargement...</p> : (
        <div className="slot-grid">
          {slots.map(slot => {
            const pending = bookingsBySlot[slot.id] || []
            return (
              <div key={slot.id}
                className={`slot-card ${slot.is_available ? 'available' : 'unavailable'}`}>
                <div className="slot-time">{slot.slot_time.slice(0, 5)}</div>
                <div className="slot-count">{slot.booked_count}/{slot.capacity} pax</div>
                <button className={`btn-toggle ${slot.is_available ? 'on' : 'off'}`}
                  onClick={() => toggleAvailability(slot)}>
                  {slot.is_available ? 'DISPO' : 'PAS DISPO'}
                </button>
                {pending.map(b => (
                  <div key={b.id} className="booking-card"
                    onClick={() => setSelectedBooking(b)}
                    style={{ cursor: 'pointer' }}>
                    <div className="booking-contact">{b.contact_name} — {b.contact_phone}</div>
                    <div className="booking-pax">
                      {b.passengers?.length || 0} passager{(b.passengers?.length || 0) > 1 ? 's' : ''} — voir fiche →
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Booking detail modal ── */}
      {selectedBooking && (
        <div className="modal-overlay" onClick={() => setSelectedBooking(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Fiche de réservation</h2>
              <button className="btn-ghost" onClick={() => setSelectedBooking(null)}>✕</button>
            </div>
            <div className="modal-contact">
              <strong>{selectedBooking.contact_name}</strong><br />
              📞 {selectedBooking.contact_phone}
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
            <div className="modal-ref">Réf. {selectedBooking.booking_ref}</div>
            <div className="booking-actions">
              <button className="btn-confirm"
                onClick={() => handleBooking(selectedBooking.id, 'confirmed')}>✓ Confirmer</button>
              <button className="btn-refuse"
                onClick={() => handleBooking(selectedBooking.id, 'refused')}>✗ Refuser</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
