import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSlotsForDate } from '../utils/rules'

const TODAY = new Date().toISOString().split('T')[0]

export default function Dashboard({ pilot }) {
  const [selectedDate, setSelectedDate] = useState(TODAY)
  const [slots, setSlots]               = useState([])
  const [bookings, setBookings]         = useState([])
  const [loading, setLoading]           = useState(true)

  // On mount: jump to the next date with a pending booking, or stay on today
  useEffect(() => {
    async function findNextPendingDate() {
      const { data } = await supabase
        .from('bookings')
        .select('pilot_slot_id, pilot_slots!inner(slot_date, pilot_id)')
        .eq('status', 'pending')
        .eq('pilot_slots.pilot_id', pilot.id)
        .gte('pilot_slots.slot_date', TODAY)
        .order('pilot_slots.slot_date', { ascending: true })
        .limit(1)
      if (data && data.length > 0) {
        setSelectedDate(data[0].pilot_slots.slot_date)
      }
    }
    findNextPendingDate()
  }, [pilot.id])

  useEffect(() => { loadDay(selectedDate) }, [selectedDate, pilot.id])

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

  async function ensureSlots(date) {
    const times = getSlotsForDate(new Date(date))
    const inserts = times.map(t => ({
      pilot_id: pilot.id, slot_date: date, slot_time: t,
      is_available: true, booked_count: 0, capacity: 4,
    }))
    await supabase.from('pilot_slots')
      .upsert(inserts, { onConflict: 'pilot_id,slot_date,slot_time', ignoreDuplicates: true })
  }

  async function toggleAvailability(slot) {
    await supabase.from('pilot_slots')
      .update({ is_available: !slot.is_available }).eq('id', slot.id)
    loadDay(selectedDate)
  }

  async function handleBooking(bookingId, action) {
    await supabase.from('bookings').update({ status: action }).eq('id', bookingId)
    loadDay(selectedDate)
  }

  const bookingsBySlot = bookings.reduce((acc, b) => {
    acc[b.pilot_slot_id] = acc[b.pilot_slot_id] || []
    acc[b.pilot_slot_id].push(b)
    return acc
  }, {})

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="dash-title">
          <span className="logo">🪂</span>
          <span>{pilot.name}</span>
        </div>
        <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>Déconnexion</button>
      </header>

      <div className="date-bar">
        <button className="btn-ghost" onClick={() => {
          const d = new Date(selectedDate); d.setDate(d.getDate() - 1)
          setSelectedDate(d.toISOString().split('T')[0])
        }}>‹</button>
        <input type="date" value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)} className="date-input" />
        <button className="btn-ghost" onClick={() => {
          const d = new Date(selectedDate); d.setDate(d.getDate() + 1)
          setSelectedDate(d.toISOString().split('T')[0])
        }}>›</button>
      </div>

      {bookings.length > 0 && (
        <div className="pending-banner">
          {bookings.length} demande{bookings.length > 1 ? 's' : ''} en attente
        </div>
      )}

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
                  <div key={b.id} className="booking-card">
                    <div className="booking-contact">{b.contact_name} — {b.contact_phone}</div>
                    <div className="booking-pax">
                      {b.passengers?.length || 0} passager{(b.passengers?.length || 0) > 1 ? 's' : ''}
                    </div>
                    <div className="booking-actions">
                      <button className="btn-confirm"
                        onClick={() => handleBooking(b.id, 'confirmed')}>✓ Confirmer</button>
                      <button className="btn-refuse"
                        onClick={() => handleBooking(b.id, 'refused')}>✗ Refuser</button>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}