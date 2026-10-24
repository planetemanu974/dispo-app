import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const TODAY = new Date().toISOString().split('T')[0]

export default function ManuDispo() {
  const [selectedDate, setSelectedDate] = useState(TODAY)
  const [slots, setSlots]               = useState([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [name, setName]                 = useState('')
  const [phone, setPhone]               = useState('')
  const [submitting, setSubmitting]     = useState(false)
  const [done, setDone]                 = useState(false)

  useEffect(() => { loadSlots(selectedDate) }, [selectedDate])

  async function loadSlots(date) {
    setLoadingSlots(true)
    setSelectedSlot(null)
    const { data } = await supabase
      .from('public_slot_availability')
      .select('*')
      .eq('slot_date', date)
      .order('slot_time')
    setSlots(data || [])
    setLoadingSlots(false)
  }

  async function submit() {
    if (!selectedSlot || !name.trim()) return
    setSubmitting(true)
    await supabase.from('bookings').insert({
      pilot_slot_id: selectedSlot.id,
      status:        'pending',
      source:        'colleague',
      contact_name:  name.trim(),
      contact_phone: phone.trim() || null,
      notes:         null,
    })
    setSubmitting(false)
    setDone(true)
  }

  // ── Done screen ────────────────────────────────────────────────────────────
  if (done) return (
    <div className="booking-page">
      <div className="booking-done">
        <div className="done-icon">✅</div>
        <h2>Demande envoyée !</h2>
        <p>Manu va confirmer le créneau. À bientôt !</p>
        <button className="btn-primary" onClick={() => {
          setDone(false); setName(''); setPhone(''); setSelectedSlot(null)
        }}>Nouvelle demande</button>
      </div>
    </div>
  )

  const hasAvailable = slots.some(s => s.is_available && s.has_capacity)

  return (
    <div className="booking-page">
      <header className="booking-header">
        <span className="logo">🪂</span>
        <h1>Manu Dispo ?</h1>
        <p>Planète Parapente Réunion — Saint-Leu</p>
      </header>

      {/* ── Date picker ── */}
      <section className="booking-section">
        <h2>Choisir une date</h2>
        <input type="date" value={selectedDate} min={TODAY} className="date-input"
          onChange={e => setSelectedDate(e.target.value)} />
      </section>

      {/* ── Slot list ── */}
      <section className="booking-section">
        <h2>Créneaux</h2>
        {loadingSlots && <p className="info-msg">Chargement...</p>}
        {!loadingSlots && slots.length === 0 && (
          <p className="info-msg">Aucun créneau ce jour-là.</p>
        )}
        {!loadingSlots && slots.length > 0 && (
          <div className="manu-dispo-slots">
            {slots.map(s => {
              const available = s.is_available && s.has_capacity
              const selected  = selectedSlot?.id === s.id
              return (
                <button
                  key={s.id}
                  className={[
                    'manu-dispo-slot',
                    available   ? 'manu-dispo-slot--ok'       : 'manu-dispo-slot--off',
                    selected    ? 'manu-dispo-slot--selected'  : '',
                  ].join(' ')}
                  disabled={!available}
                  onClick={() => setSelectedSlot(s)}
                >
                  <span className="manu-slot-time">{s.slot_time.slice(0, 5)}</span>
                  <span className="manu-slot-status">
                    {available ? '✓ Disponible' : '✗ Non disponible'}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {!loadingSlots && slots.length > 0 && !hasAvailable && (
          <p className="info-msg" style={{ marginTop: '12px' }}>
            Manu n’est pas disponible ce jour-là. Essayez une autre date.
          </p>
        )}
      </section>

      {/* ── Request form ── */}
      {selectedSlot && (
        <section className="booking-section">
          <h2>Votre demande</h2>
          <p className="info-msg" style={{ marginBottom: '12px' }}>
            Créneau sélectionné : <strong>{selectedSlot.slot_time.slice(0, 5)}</strong>
          </p>
          <div className="field">
            <label>Votre nom</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="Prénom Nom" className="date-input" />
          </div>
          <div className="field" style={{ marginTop: '12px' }}>
            <label>Téléphone (optionnel)</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="0692…" className="date-input" />
          </div>
          <button className="btn-primary" style={{ marginTop: '16px', width: '100%' }}
            onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? 'Envoi...' : 'Envoyer la demande →'}
          </button>
        </section>
      )}
    </div>
  )
}
