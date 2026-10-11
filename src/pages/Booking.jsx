import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { validateWeight, validateAge, calculatePrice, suggestSlots, AGE_LIMITS, WEIGHT_LIMITS } from '../utils/rules'

const TODAY = new Date().toISOString().split('T')[0]
const emptyPassenger = () => ({
  first_name: '', last_name: '', weight_kg: '', age: '',
  flight_type: 'discovery', parental_auth: false,
})

// First slot of the day = discovery only, ≤ 75 kg
function isFirstSlot(slot_time) {
  return slot_time?.startsWith('08:')
}

export default function Booking() {
  const [step, setStep]                 = useState(1)
  const [selectedDate, setSelectedDate] = useState(TODAY)
  const [slots, setSlots]               = useState([])
  const [passengers, setPassengers]     = useState([emptyPassenger()])
  const [suggestedSlot, setSuggestedSlot] = useState(null)
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [contact, setContact]           = useState({ name: '', phone: '' })
  const [errors, setErrors]             = useState({})
  const [submitting, setSubmitting]     = useState(false)
  const [bookingRef, setBookingRef]     = useState(null)

  useEffect(() => { if (selectedDate) loadSlots(selectedDate) }, [selectedDate])

  async function loadSlots(date) {
    const { data } = await supabase.from('public_slot_availability')
      .select('*').eq('slot_date', date).eq('is_available', true)
      .eq('has_capacity', true).order('slot_time')
    setSlots(data || [])
    setSuggestedSlot(null)
    setSelectedSlot(null)
  }

  function updatePassenger(i, field, value) {
    setPassengers(prev => prev.map((p, idx) => {
      if (idx !== i) return p
      const updated = { ...p, [field]: value }
      // Force discovery for children ≤ 12
      if (field === 'age') {
        const age = parseInt(value, 10)
        if (!isNaN(age) && age <= AGE_LIMITS.CHILD_MAX_AGE) updated.flight_type = 'discovery'
      }
      return updated
    }))
  }

  function validateAndSuggest() {
    const newErrors = {}; let valid = true

    passengers.forEach((p, i) => {
      const age    = parseInt(p.age, 10)
      const weight = parseInt(p.weight_kg, 10)

      if (!p.first_name.trim()) { newErrors[`${i}_first_name`] = 'Prénom requis'; valid = false }
      if (!p.last_name.trim())  { newErrors[`${i}_last_name`]  = 'Nom requis';    valid = false }
      if (!weight || weight <= 0) { newErrors[`${i}_weight`] = 'Poids requis';   valid = false }
      if (!age    || age    < 0)  { newErrors[`${i}_age`]    = 'Âge requis';     valid = false }

      if (weight && age) {
        const wResult = validateWeight(weight)
        if (wResult.blocked) { newErrors[`${i}_weight`] = wResult.warning; valid = false }

        const aResult = validateAge(age, weight, p.flight_type)
        if (!aResult.ok) { newErrors[`${i}_age`] = aResult.error; valid = false }

        if (age < 18 && !p.parental_auth) {
          newErrors[`${i}_parental`] = 'Autorisation parentale requise'; valid = false
        }
      }
    })

    setErrors(newErrors)
    if (!valid) return

    // ── Filter out the first slot (8h00) when:
    //    • any passenger wants a performance flight, OR
    //    • any passenger weighs ≥ 76 kg (descends too fast for early calm conditions)
    const hasPerformance = passengers.some(p => p.flight_type === 'performance')
    const hasHeavy       = passengers.some(p => parseInt(p.weight_kg) >= WEIGHT_LIMITS.HEAVY_KG)

    const eligibleSlots = (hasPerformance || hasHeavy)
      ? slots.filter(s => !isFirstSlot(s.slot_time))
      : slots

    if (eligibleSlots.length === 0) {
      setSuggestedSlot(null)
      setSelectedSlot(null)
      setErrors({
        general: hasPerformance
          ? 'Aucun créneau disponible pour un vol performance ce jour-là. Essayez une autre date.'
          : 'Aucun créneau disponible pour vos passagers ce jour-là. Essayez une autre date.',
      })
      setStep(3)
      return
    }

    // Always take the earliest eligible slot
    const { optionB } = suggestSlots(eligibleSlots)
    setSuggestedSlot(optionB)
    setSelectedSlot(optionB)
    setStep(3)
  }

  async function submitBooking() {
    if (!selectedSlot) return
    setSubmitting(true)

    const { data: bookingData, error: bookingError } = await supabase.from('bookings')
      .insert({
        pilot_slot_id: selectedSlot.id, status: 'pending', source: 'public',
        contact_name:  contact.name,    contact_phone: contact.phone,
      })
      .select().single()

    if (bookingError) {
      setErrors({ submit: 'Erreur lors de la réservation. Réessayez.' })
      setSubmitting(false); return
    }

    const paxInserts = passengers.map(p => ({
      booking_id:    bookingData.id,
      first_name:    p.first_name,
      last_name:     p.last_name,
      weight_kg:     parseInt(p.weight_kg),
      age:           parseInt(p.age),
      flight_type:   p.flight_type,
      parental_auth: p.parental_auth,
      price_eur:     calculatePrice(parseInt(p.age), p.flight_type) * 100,
    }))

    const { error: paxError } = await supabase.from('passengers').insert(paxInserts)
    if (paxError) {
      setErrors({ submit: 'Erreur passagers.' })
      setSubmitting(false); return
    }

    setBookingRef(bookingData.id.slice(0, 8).toUpperCase())
    setStep(4); setSubmitting(false)
  }

  // ── Step 4 — confirmation ─────────────────────────────────────────────────
  if (step === 4) return (
    <div className="booking-page">
      <div className="booking-done">
        <div className="done-icon">✅</div>
        <h2>Demande envoyée !</h2>
        <p>Référence : <strong>{bookingRef}</strong></p>
        <p>Le moniteur va confirmer votre vol. Vous serez contacté au numéro indiqué.</p>
        <button className="btn-primary" onClick={() => {
          setStep(1); setPassengers([emptyPassenger()]); setContact({ name: '', phone: '' })
        }}>
          Nouvelle réservation
        </button>
      </div>
    </div>
  )

  // ── Steps 1–3 ─────────────────────────────────────────────────────────────
  return (
    <div className="booking-page">
      <header className="booking-header">
        <span className="logo">🪂</span>
        <h1>Réserver un vol</h1>
        <p>Planète Parapente Réunion — Saint-Leu</p>
      </header>

      {/* ── Step 1 : date ── */}
      {step >= 1 && (
        <section className="booking-section">
          <h2>1. Choisir une date</h2>
          <input type="date" value={selectedDate} min={TODAY} className="date-input"
            onChange={e => { setSelectedDate(e.target.value); setStep(1) }} />
          {slots.length === 0 && <p className="info-msg">Aucun créneau disponible pour cette date.</p>}
          {slots.length > 0 && step === 1 && (
            <button className="btn-primary" onClick={() => setStep(2)}>Continuer →</button>
          )}
        </section>
      )}

      {/* ── Step 2 : passengers ── */}
      {step >= 2 && (
        <section className="booking-section">
          <h2>2. Passagers</h2>

          {passengers.map((p, i) => {
            const age      = parseInt(p.age, 10)
            const isChild  = !isNaN(age) && age <= AGE_LIMITS.CHILD_MAX_AGE
            // Only first slot available today → performance impossible
            const onlyFirst = slots.every(s => isFirstSlot(s.slot_time))

            return (
              <div key={i} className="passenger-card">
                <div className="passenger-header">
                  <span>Passager {i + 1}</span>
                  {i > 0 && (
                    <button className="btn-ghost-small"
                      onClick={() => setPassengers(prev => prev.filter((_, idx) => idx !== i))}>✕</button>
                  )}
                </div>

                <div className="field-row">
                  <div className="field"><label>Prénom</label>
                    <input value={p.first_name} onChange={e => updatePassenger(i, 'first_name', e.target.value)} />
                    {errors[`${i}_first_name`] && <span className="error-msg">{errors[`${i}_first_name`]}</span>}
                  </div>
                  <div className="field"><label>Nom</label>
                    <input value={p.last_name} onChange={e => updatePassenger(i, 'last_name', e.target.value)} />
                    {errors[`${i}_last_name`] && <span className="error-msg">{errors[`${i}_last_name`]}</span>}
                  </div>
                </div>

                <div className="field-row">
                  <div className="field"><label>Poids (kg)</label>
                    <input type="number" min="10" max="100" value={p.weight_kg}
                      onChange={e => updatePassenger(i, 'weight_kg', e.target.value)} />
                    {errors[`${i}_weight`] && <span className="error-msg">{errors[`${i}_weight`]}</span>}
                  </div>
                  <div className="field"><label>Âge</label>
                    <input type="number" min="6" max="99" value={p.age}
                      onChange={e => updatePassenger(i, 'age', e.target.value)} />
                    {errors[`${i}_age`] && <span className="error-msg">{errors[`${i}_age`]}</span>}
                  </div>
                </div>

                <div className="field">
                  <label>Type de vol</label>
                  <select value={p.flight_type}
                    onChange={e => updatePassenger(i, 'flight_type', e.target.value)}
                    disabled={isChild || onlyFirst}>
                    <option value="discovery">Découverte — 20 min (90 €)</option>
                    <option value="performance">Performance — 30/40 min (110–120 €)</option>
                  </select>
                  {isChild   && <span className="info-msg">Vol découverte uniquement pour les moins de 13 ans.</span>}
                  {!isChild && onlyFirst && <span className="info-msg">Vol découverte uniquement sur le créneau 8h.</span>}
                </div>

                {parseInt(p.age) < 18 && p.age !== '' && (
                  <div className="field checkbox-field">
                    <label>
                      <input type="checkbox" checked={p.parental_auth}
                        onChange={e => updatePassenger(i, 'parental_auth', e.target.checked)} />
                      {' '}Autorisation parentale confirmée
                    </label>
                    {errors[`${i}_parental`] && <span className="error-msg">{errors[`${i}_parental`]}</span>}
                  </div>
                )}
              </div>
            )
          })}

          {passengers.length < 4 && (
            <button className="btn-secondary"
              onClick={() => setPassengers(prev => [...prev, emptyPassenger()])}>
              + Ajouter un passager
            </button>
          )}

          {/* Contact */}
          <div className="passenger-card">
            <div className="passenger-header">Contact</div>
            <div className="field-row">
              <div className="field"><label>Nom</label>
                <input value={contact.name} onChange={e => setContact(c => ({ ...c, name: e.target.value }))} />
              </div>
              <div className="field"><label>Téléphone</label>
                <input type="tel" value={contact.phone} onChange={e => setContact(c => ({ ...c, phone: e.target.value }))} />
              </div>
            </div>
          </div>

          <button className="btn-primary" onClick={validateAndSuggest}>Voir les créneaux →</button>
        </section>
      )}

      {/* ── Step 3 : slot ── */}
      {step >= 3 && (
        <section className="booking-section">
          <h2>3. Créneau proposé</h2>

          {errors.general && <p className="error-msg">{errors.general}</p>}

          {suggestedSlot ? (
            <div className="slot-option recommended selected">
              <span className="slot-time-big">{suggestedSlot.slot_time?.slice(0, 5)}</span>
            </div>
          ) : (
            !errors.general && <p className="info-msg">Aucun créneau disponible pour vos contraintes ce jour-là.</p>
          )}

          {errors.submit && <p className="error-msg">{errors.submit}</p>}

          {selectedSlot && (
            <button className="btn-primary" onClick={submitBooking} disabled={submitting}>
              {submitting ? 'Envoi...' : 'Confirmer la demande'}
            </button>
          )}
        </section>
      )}
    </div>
  )
}
