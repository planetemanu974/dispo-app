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
  const [slotInfo, setSlotInfo]         = useState(null)
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
    setSlotInfo(null)
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
        else if (wResult.warning) { newErrors[`${i}_weight_warn`] = wResult.warning }

        const aResult = validateAge(age, weight, p.flight_type)
        if (!aResult.ok) { newErrors[`${i}_age`] = aResult.error; valid = false }

        if (age < 18 && !p.parental_auth) {
          newErrors[`${i}_parental`] = 'Autorisation parentale requise'; valid = false
        }
      }
    })

    setErrors(newErrors)
    if (!valid) return
console.log('slots:', slots.map(s => s.slot_time))
console.log('hasLightChild:', passengers.some(p => parseInt(p.weight_kg) < WEIGHT_LIMITS.LIGHT_KG))
console.log('poids:', passengers.map(p => p.weight_kg))
    const hasPerformance = passengers.some(p => p.flight_type === 'performance')
    const hasHeavy       = passengers.some(p => parseInt(p.weight_kg) >= WEIGHT_LIMITS.HEAVY_KG)
    const hasLightChild  = passengers.some(p => parseInt(p.weight_kg) < WEIGHT_LIMITS.LIGHT_KG)

    // Conflit impossible : enfant < 20 kg impose 8h00, performance interdit à 8h00
    if (hasLightChild && hasPerformance) {
      setSuggestedSlot(null); setSelectedSlot(null); setSlotInfo(null)
      setErrors({ general: 'Un passager fait moins de 20 kg (créneau 8h00 uniquement, vol découverte). Un vol performance est incompatible. Réservez deux vols séparés.' })
      setStep(3); return
    }

    // Enfant < 20 kg → 8h00 impératif
    // Performance (sans enfant léger) → exclut 8h00
    // Sinon → tous les créneaux disponibles
    let eligibleSlots
    if (hasLightChild) {
      eligibleSlots = slots.filter(s => isFirstSlot(s.slot_time))
    } else if (hasPerformance) {
      eligibleSlots = slots.filter(s => !isFirstSlot(s.slot_time))
    } else {
      eligibleSlots = slots
    }

    if (eligibleSlots.length === 0) {
      setSuggestedSlot(null); setSelectedSlot(null); setSlotInfo(null)
      setErrors({
        general: hasPerformance
          ? 'Aucun créneau disponible pour un vol performance ce jour-là. Essayez une autre date.'
          : 'Aucun créneau disponible pour vos passagers ce jour-là. Essayez une autre date.',
      })
      setStep(3); return
    }

    const { optionB } = suggestSlots(eligibleSlots)
    setSuggestedSlot(optionB)
    setSelectedSlot(optionB)

    // Avertissement : adulte lourd + enfant léger → 8h00 découverte, vol plus court
    setSlotInfo(
      hasLightChild && hasHeavy
        ? '⚠️ Créneau 8h00 imposé (passager < 20 kg). Le passager de plus de 75 kg volera en vol découverte (20 min) — le vol sera plus court. Vous pouvez aussi réserver deux vols séparés.'
        : null
    )

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

      {/* ── Step 2 :