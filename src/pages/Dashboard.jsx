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
  const [editMode, setEditMode]               = useState(false)
  const [editData, setEditData]               = useState(null)
  const [editSlots, setEditSlots]             = useState([])   // available slots for chosen edit date

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
  // silent=true: refresh in background without showing the loading spinner
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
    // Keep modal open, update status locally so WhatsApp button appears
    setSelectedBooking(prev => prev ? { ...prev, status: action } : null)

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

    loadDay(selectedDate, true)   // silent refresh — modal stays visible
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

    // Emojis as Unicode escapes — literal emoji chars corrupt on Windows file save
    const e = {
      wave:    '👋',
      check:   '✅',
      shoe:    '👟',
      card:    '💳',
      camera:  '📸',
      video:   '🎥',
      weather: '🌤',
      para:    '🪂',
    }

    let msg = ''
    if (action === 'confirmed') {
      msg =
        `Bonjour ${booking.contact_name} ${e.wave}\n\n` +
        `*Votre reservation parapente est confirmee* ${e.check}\n\n` +
        `Je vous confirme votre vol pour ${dateLabel} a ${slotTime} pour ${paxLabel}.\n\n` +
        `Les pilotes vous attendront a l'*atterrissage des parapentes* (plage a cote de Kelonia).\n\n` +
        `Vous les trouverez a cote de la navette *Planete Parapente* stationnee sur le parking. Demandez *Manu*.\n` +
        `Il est preferable de vous garer sur le grand parking a cote du rond-point.\n\n` +
        `${e.shoe} *Equipement :* baskets\n\n` +
        `${e.card} *Paiement :* especes ou cheque (pas de carte bleue)\n\n` +
        `${e.camera} Photos : 10€\n` +
        `${e.video} Photos + Videos : 20€\n` +
        `Transfert direct sur smartphone apres le vol.\n\n` +
        `${e.weather} Un message de confirmation meteo vous sera envoye la veille du vol.\n\n` +
        `A bientot ! ${e.para}\n\n` +
        `Manu\n` +
        `www.planete-parapente-reunion.com\n` +
        `06.92.719.749`
    } else {
      msg =
        `Bonjour ${booking.contact_name},\n\n` +
        `Je suis desole, je ne suis pas disponible le ${dateLabel}.\n` +
        `N'hesitez pas a me recontacter pour une autre date ${e.para}\n\n` +
        `Manu - Planete Parapente Reunion\n` +
        `06.92.719.749`
    }

    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
  }

  // ── handleCancel ──────────────────────────────────────────────────────────
  async function handleCancel(bookingId) {
    if (!window.confirm('Annuler cette réservation ?')) return
    await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)
    setSelectedBooking(null)
    setEditMode(false)
    // Refresh pending list
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
  }

  // ── loadEditSlots: fetch available slots for a given date (edit mode) ───────
  async function loadEditSlots(date) {
    await ensureSlots(date)
    const { data } = await supabase
      .from('pilot_slots').select('*')
      .eq('pilot_id', pilot.id).eq('slot_date', date).order('slot_time')
    setEditSlots(data || [])
  }

  // ── enterEditMode ──────────────────────────────────────────────────────────
  function enterEditMode() {
    const slotDate = selectedBooking.pilot_slots?.slot_date || selectedDate
    setEditData({
      contact_name:   selectedBooking.contact_name  || '',
      contact_phone:  selectedBooking.contact_phone || '',
      slot_date:      slotDate,
      pilot_slot_id:  selectedBooking.pilot_slot_id || '',
      passengers: (selectedBooking.passengers || []).map(p => ({ ...p })),
    })
    loadEditSlots(slotDate)
    setEditMode(true)
  }

  // ── handleSaveEdit ─────────────────────────────────────────────────────────
  async function handleSaveEdit() {
    // Update booking contact fields + slot if changed
    await supabase.from('bookings').update({
      contact_name:  editData.contact_name,
      contact_phone: editData.contact_phone,
      pilot_slot_id: editData.pilot_slot_id,
    }).eq('id', selectedBooking.id)

    // Determine which original passengers were removed
    const originalIds = (selectedBooking.passengers || []).map(p => p.id)
    const keptIds     = editData.passengers.filter(p => p.id).map(p => p.id)
    const removedIds  = originalIds.filter(id => !keptIds.includes(id))
    if (removedIds.length > 0) {
      await supabase.from('passengers').delete().in('id', removedIds)
    }

    // Update existing passengers, insert new ones
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

    // Reload booking detail — also fetch new slot explicitly to guarantee correct date/time
    const [{ data: updated }, { data: newSlot }] = await Promise.all([
      supabase.from('bookings').select('*, passengers(*)')
        .eq('id', selectedBooking.id).single(),
      supabase.from('pilot_slots').select('slot_date, slot_time')
        .eq('id', editData.pilot_slot_id).single(),
    ])
    setSelectedBooking({ ...updated, pilot_slots: newSlot })
    setEditMode(false)
    // If the slot date changed, navigate to the new date
    const newDate = editData.slot_date
    if (newDate && newDate !== selectedDate) {
      setSelectedDate(newDate)
    } else {
      loadDay(selectedDate, true)
      loadPlanning(selectedDate)
    }
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
        <div className="modal-overlay" onClick={() => { setSelectedBooking(null); setEditMode(false) }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editMode ? 'Modifier la réservation' : 'Fiche de réservation'}</h2>
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
                    <div className="modal-notes-label">📝 Demande spéciale</div>
                    <div className="modal-notes-text">{selectedBooking.notes}</div>
                  </div>
                )}
                <div className="modal-ref">Réf. {selectedBooking.booking_ref || selectedBooking.id?.slice(0, 8).toUpperCase()}</div>

                {/* Confirm / refuse for pending */}
                {selectedBooking.status === 'pending' && (
                  <div className="booking-actions">
                    <button className="btn-confirm"
                      onClick={() => handleBooking(selectedBooking.id, 'confirmed')}>✓ Confirmer</button>
                    <button className="btn-refuse"
                      onClick={() => handleBooking(selectedBooking.id, 'refused')}>✗ Refuser</button>
                  </div>
                )}

                {/* WhatsApp buttons after confirm or refuse */}
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

                {/* Edit / Cancel actions — visible for pending and confirmed */}
                {(selectedBooking.status === 'pending' || selectedBooking.status === 'confirmed') && (
                  <div className="booking-manage-actions">
                    <button className="btn-edit" onClick={enterEditMode}>✏️ Modifier la réservation</button>
                    <button className="btn-cancel-booking" onClick={() => handleCancel(selectedBooking.id)}>
                      🗑 Annuler cette réservation
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── EDIT MODE ── */}
            {editMode && editData && (
              <>
                <div className="edit-section">
                  <div className="edit-section-title">Date et créneau</div>
                  <label className="edit-label">Date</label>
                  <input className="edit-input" type="date" value={editData.slot_date} min={TODAY}
                    onChange={e => {
                      const d = e.target.value
                      setEditData(prev => ({ ...prev, slot_date: d, pilot_slot_id: '' }))
                      loadEditSlots(d)
                    }} />
                  <label className="edit-label">Créneau</label>
                  {editSlots.length === 0
                    ? <p style={{ fontSize: '0.85rem', color: '#888', margin: '4px 0' }}>Aucun créneau pour cette date.</p>
                    : <select className="edit-input" value={editData.pilot_slot_id}
                        onChange={e => setEditData(d => ({ ...d, pilot_slot_id: e.target.value }))}>
                        <option value="">— Choisir un créneau —</option>
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
                  <label className="edit-label">Téléphone</label>
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
                          <label className="edit-label">Prénom</label>
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
                          <label className="edit-label">Âge</label>
                          <input className="edit-input" type="number" min="6" max="99" value={p.age}
                            onChange={e => setEditData(d => ({ ...d, passengers: d.passengers.map((px, idx) => idx === i ? { ...px, age: e.target.value } : px) }))} />
                        </div>
                      </div>
                      <div>
                        <label className="edit-label">Type de vol</label>
                        <select className="edit-input" value={p.flight_type}
                          onChange={e => setEditData(d => ({ ...d, passengers: d.passengers.map((px, idx) => idx === i ? { ...px, flight_type: e.target.value } : px) }))}>
                          <option value="discovery">Découverte (90 €)</option>
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
