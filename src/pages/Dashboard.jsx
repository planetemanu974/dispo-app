import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSlotsForDate } from '../utils/rules'

const TODAY = new Date().toISOString().split('T')[0]

// ── Helper: generate array of YYYY-MM-DD for the next N days from a start date
function getDayRange(startDate, count) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(startDate + 'T00:00:00')
    d.setDate(d.getDate() + i)
    return d.toISOString().split('T')[0]
  })
}

export default function Dashboard({ pilot }) {
  // selectedDate starts null — init() sets it after finding pending bookings
  const [selectedDate, setSelectedDate]     = useState(null)
  const [slots, setSlots]                   = useState([])
  const [bookings, setBookings]             = useState([])
  const [pendingAll, setPendingAll]         = useState([])
  const [loading, setLoading]               = useState(true)
  const [selectedBooking, setSelectedBooking] = useState(null)

  // 14-day planning: map of { [date]: { pending: n, confirmed: n } }
  const [planning, setPlanning]             = useState({})
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

      await loadDay(startDate)
      setSelectedDate(startDate)
    }

    init()
  }, [pilot.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reload day when user navigates ────────────────────────────────────────
  useEffect(() => {
    if (selectedDate === null) return
    loadDay(selectedDate)
    loadPlanning(selectedDate)
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
        .in('pilot_slot_id', slotIds)
        .in('status', ['pending', 'confirmed'])
        .order('created_at')
      bookingsData = data || []
    }

    setSlots(slotsData || [])
    setBookings(bookingsData)
    setLoading(false)
  }

  // ── loadPlanning: fetch 14-day booking summary ─────────────────────────────
  async function loadPlanning(fromDate) {
    setPlanningLoading(true)
    const days = getDayRange(fromDate, 14)
    const [dayStart, dayEnd] = [days[0], days[days.length - 1]]

    // Ensure slots exist for all 14 days (upsert in parallel)
    await Promise.all(days.map(d => ensureSlots(d)))

    const { data: slotData } = await supabase
      .from('pilot_slots')
      .select('id, slot_date')
      .eq('pilot_id', pilot.id)
      .gte('slot_date', dayStart)
      .lte('slot_date', dayEnd)

    if (!slotData || slotData.length === 0) {
      setPlanningLoading(false)
      return
    }

    const slotIds  = slotData.map(s => s.id)
    const slotMap  = Object.fromEntries(slotData.map(s => [s.id, s.slot_date]))

    const { data: bkData } = await supabase
      .from('bookings')
      .select('id, pilot_slot_id, status')
      .in('pilot_slot_id', slotIds)
      .in('status', ['pending', 'confirmed'])

    // Build summary map
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
    loadPlanning(selectedDate)
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

  // ── buildWhatsAppUrl ───────────────────────────────────────────────────────
  // Builds a wa.me link with a pre-filled confirmation message.
  function buildWhatsAppUrl(booking, action) {
    const phone = (booking.contact_phone || '').replace(/\s+/g, '').replace(/^0/, '262')
    const slotDate = booking.pilot_slots?.slot_date || selectedDate
    const slotTime = booking.pilot_slots?.slot_time?.slice(0, 5) || ''
    const dateLabel = new Date(slotDate + 'T00:00:00').toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long'
    })
    const paxCount = booking.passengers?.length || 1
    const paxLabel = paxCount > 1 ? `${paxCount} passagers` : '1 passager'

    let msg = ''
    if (action === 'confirmed') {
      msg =
        `Bonjour ${booking.contact_name} 👋\n\n` +
        `*Votre réservation parapente est confirmée* ✅\n\n` +
        `Je vous confirme votre vol pour ${dateLabel} à ${slotTime} pour ${paxLabel}.\n\n` +
        `Les pilotes vous attendront à l'*atterrissage des parapentes* (plage à côté de Kélonia).\n\n` +
        `Vous les trouverez à côté de la navette *Planète Parapente* stationnée sur le parking. Demandez *Manu*.\n` +
        `Il est préférable de vous garer sur le grand parking à côté du rond-point.\n\n` +
        `👟 *Équipement :* baskets\n\n` +
        `💳 *Paiement :* espèces ou chèque (pas de carte bleue)\n\n` +
        `📸 Photos : 10€\n` +
        `🎥 Photos + Vidéos : 20€\n` +
        `Transfert direct sur smartphone après le vol.\n\n` +
        `🌤️ Un message de confirmation météo vous sera envoyé la veille du vol.\n\n` +
        `À bientôt ! 🪂\n\n` +
        `Manu\n` +
        `www.planete-parapente-reunion.com\n` +
        `06.92.719.749`
    } else {
      msg =
        `Bonjour ${booking.contact_name},\n\n` +
        `Je suis désolé, je ne suis pas disponible le ${dateLabel}.\n` +
        `N'hésitez pas à me recontacter pour une autre date 🪂\n\n` +
        `Manu — Planète Parapente Réunion\n` +
        `06.92.719.749`
    }

    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
  }

  function changeDate(delta) {
    const d = new Date((selectedDate || TODAY) + 'T00:00:00')
    d.setDate(d.getDate() + delta)
    setSelectedDate(d.toISOString().split('T')[0])
  }

  // 14-day strip: always anchored to TODAY
  const planningDays = getDayRange(TODAY, 14)

  // Format a date as "lun. 24"
  function formatDayLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00')
    return {
      day: d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''),
      num: d.getDate(),
    }
  }

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

      {/* ── 14-day planning strip ── */}
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
              <button
                key={date}
                className={[
                  'planning-day',
                  isSelected  ? 'planning-day--selected'  : '',
                  isToday     ? 'planning-day--today'     : '',
                  hasPending  ? 'planning-day--pending'   : '',
                ].join(' ')}
                onClick={() => setSelectedDate(date)}
              >
                <span className="planning-day__name">{day}</span>
                <span className="planning-day__num">{num}</span>
                <span className="planning-day__dots">
                  {hasPending  && <span className="dot dot--pending"  title="En attente" />}
                  {hasConfirmed && <span className="dot dot--confirmed" title="Confirmé" />}
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
                {/* Pending bookings */}
                {pendingBks.map(b => (
                  <div key={b.id} className="booking-card booking-card--pending"
                    onClick={() => setSelectedBooking(b)}
                    style={{ cursor: 'pointer' }}>
                    <span className="booking-badge booking-badge--pending">En attente</span>
                    <div className="booking-contact">{b.contact_name} — {b.contact_phone}</div>
                    <div className="booking-pax">
                      {b.passengers?.length || 0} passager{(b.passengers?.length || 0) > 1 ? 's' : ''} — voir fiche →
                    </div>
                  </div>
                ))}
                {/* Confirmed bookings */}
                {confirmedBks.map(b => (
                  <div key={b.id} className="booking-card booking-card--confirmed"
                    onClick={() => setSelectedBooking(b)}
                    style={{ cursor: 'pointer' }}>
                    <span className="booking-badge booking-badge--confirmed">✓ Confirmé</span>
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
            {/* Notes / demande spéciale du client */}
            {selectedBooking.notes && (
              <div className="modal-notes">
                <div className="modal-notes-label">📝 Demande spéciale</div>
                <div className="modal-notes-text">{selectedBooking.notes}</div>
              </div>
            )}
            <div className="modal-ref">Réf. {selectedBooking.booking_ref || selectedBooking.id?.slice(0, 8).toUpperCase()}</div>
            {/* Show confirm/refuse only for pending bookings */}
            {selectedBooking.status === 'pending' && (
              <div className="booking-actions">
                <button className="btn-confirm"
                  onClick={() => handleBooking(selectedBooking.id, 'confirmed')}>✓ Confirmer</button>
                <button className="btn-refuse"
                  onClick={() => handleBooking(selectedBooking.id, 'refused')}>✗ Refuser</button>
              </div>
            )}
            {/* WhatsApp buttons — shown after confirm or refuse */}
            {(selectedBooking.status === 'confirmed' || selectedBooking.status === 'refused') && (
              <div className="booking-whatsapp-actions">
                {selectedBooking.status === 'confirmed' && (
                  <div className="booking-confirmed-label">✓ Vol confirmé</div>
                )}
                <a
                  href={buildWhatsAppUrl(selectedBooking, selectedBooking.status === 'confirmed' ? 'confirmed' : 'refused')}
                  target="_blank" rel="noreferrer"
                  className="btn-whatsapp-send">
                  📲 Envoyer la confirmation WhatsApp
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
