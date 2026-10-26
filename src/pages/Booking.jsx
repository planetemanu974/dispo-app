import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { validateWeight, validateAge, calculatePrice, suggestSlots, AGE_LIMITS, WEIGHT_LIMITS } from '../utils/rules'
import { useSettings, DEFAULT_SETTINGS } from '../contexts/SettingsContext'

const TODAY = new Date().toISOString().split('T')[0]
const emptyPassenger = () => ({
  first_name: '', last_name: '', weight_kg: '', age: '',
  flight_type: 'discovery', parental_auth: false,
})

function isFirstSlot(slot_time) {
  return slot_time?.startsWith('08:')
}

// Format a date string (YYYY-MM-DD) to French readable format
function formatDateFR(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`
}

// Send an SMS via the Supabase Edge Function
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

export default function Booking() {
  // Settings context — provides dynamic flight types (falls back to defaults if outside provider)
  let settingsCtx
  try { settingsCtx = useSettings() } catch { settingsCtx = null }
  const flightTypes = settingsCtx?.settings?.flight_types ?? DEFAULT_SETTINGS.flight_types

  // Child flight type = first type that has a max_age defined
  const childFlightType = flightTypes.find(f => f.max_age !== null) ?? flightTypes[0]
  // Adult flight types = those without max_age restriction (or above child threshold)
  const adultFlightTypes = flightTypes.filter(f => f.max_age === null)

  const [step, setStep]                   = useState(2)
  const [selectedDate, setSelectedDate]   = useState(TODAY)
  const [slots, setSlots]                 = useState([])
  const [passengers, setPassengers]       = useState([emptyPassenger()])
  const [suggestedSlot, setSuggestedSlot] = useState(null)
  const [selectedSlot, setSelectedSlot]   = useState(null)
  const [contact, setContact]             = useState({ name: '', phone: '' })
  const [notes, setNotes]                 = useState('')
  const [errors, setErrors]               = useState({})
  const [slotInfo, setSlotInfo]           = useState(null)
  const [conflictMode, setConflictMode]   = useState(null)   // 'child_perf' | 'heavy' | 'split_message' | null
  const [slotTogether, setSlotTogether]   = useState(null)   // 8h00 slot
  const [slotAdultOnly, setSlotAdultOnly] = useState(null)   // first non-8h00 slot
  const [selectedSlots, setSelectedSlots] = useState([])    // consecutive slots for multi-slot flights
  const [submitting, setSubmitting]       = useState(false)
  const [bookingRef, setBookingRef]       = useState(null)

  // OTP verification state
  const [otpStep, setOtpStep]   = useState(null)   // null | 'sending' | 'waiting' | 'verifying' | 'error'
  const [otpCode, setOtpCode]   = useState('')
  const [otpError, setOtpError] = useState('')

  useEffect(() => { if (selectedDate) loadSlots(selectedDate) }, [selectedDate])

async function loadSlots(date) {
    const { data } = await supabase.from('public_slot_availability')
      .select('*').eq('slot_date', date).eq('is_available', true)
      .eq('has_capacity', true)
    const sorted = (data || []).sort((a, b) => a.slot_time.localeCompare(b.slot_time))
    setSlots(sorted)
    setSuggestedSlot(null); setSelectedSlot(null); setSelectedSlots([])
    setSlotInfo(null); setConflictMode(null)
    setSlotTogether(null); setSlotAdultOnly(null)
  }

  function updatePassenger(i, field, value) {
    setPassengers(prev => prev.map((p, idx) => {
      if (idx !== i) return p
      const updated = { ...p, [field]: value }
      if (field === 'age') {
        const age = parseInt(value, 10)
        // Auto-assign child flight type when age ≤ max_age of child type, reset to first adult type
        if (!isNaN(age)) {
          const childFT = flightTypes.find(f => f.max_age !== null)
          const adultFT = flightTypes.find(f => f.max_age === null)
          if (childFT && age <= childFT.max_age) updated.flight_type = childFT.id
          else if (childFT && updated.flight_type === childFT.id && adultFT) updated.flight_type = adultFT.id
        }
      }
      return updated
    }))
  }

  function validateAndSuggest() {
    const newErrors = {}; let valid = true

    // Contact is always required
    if (!contact.name.trim())  { newErrors.contact_name  = 'Nom requis';      valid = false }
    if (!contact.phone.trim()) { newErrors.contact_phone = 'Téléphone requis'; valid = false }

    passengers.forEach((p, i) => {
      const age    = parseInt(p.age, 10)
      const weight = parseInt(p.weight_kg, 10)

      // First name and last name are optional (contact info is enough)
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

    const hasPerformance = passengers.some(p => p.flight_type === 'performance')
    const hasHeavy       = passengers.some(p => parseInt(p.weight_kg) >= WEIGHT_LIMITS.HEAVY_KG)
    const hasLightChild  = passengers.some(p => parseInt(p.weight_kg) < WEIGHT_LIMITS.LIGHT_KG)
    const hasChild       = passengers.some(p => parseInt(p.age) <= AGE_LIMITS.CHILD_MAX_AGE)

    // Conflict: child + performance → two options
if (hasChild && hasPerformance) {
  const sortedSlots = [...slots].sort((a, b) => a.slot_time.localeCompare(b.slot_time))
  const s8h    = sortedSlots.find(s => isFirstSlot(s.slot_time)) || null
  const sLater = sortedSlots.find(s => !isFirstSlot(s.slot_time)) || null
  setSlotTogether(s8h)
  setSlotAdultOnly(sLater)
  setConflictMode('child_perf')
  setSuggestedSlot(null); setSelectedSlot(null); setSlotInfo(null)
  setStep(3); return
}

    // ── Passager lourd (>75 kg) en découverte → proposer 8h ET 9h15 ─────────
    if (hasHeavy && !hasPerformance && !hasLightChild) {
      const sortedSlots = [...slots].sort((a, b) => a.slot_time.localeCompare(b.slot_time))
      const s8h    = sortedSlots.find(s =>  isFirstSlot(s.slot_time)) || null
      const sLater = sortedSlots.find(s => !isFirstSlot(s.slot_time)) || null
      if (s8h && sLater) {
        setSlotTogether(s8h)
        setSlotAdultOnly(sLater)
        setConflictMode('heavy')
        setSuggestedSlot(null); setSelectedSlot(null); setSlotInfo(null)
        setStep(3); return
      }
      // Si un seul créneau dispo, on continue normalement avec un slotInfo
    }

    // ── Conflit enfant léger + performance → impossible ──────────────────────
    if (hasLightChild && hasPerformance) {
      setSuggestedSlot(null); setSelectedSlot(null); setSlotInfo(null); setConflictMode(null)
      setErrors({ general: 'Un passager fait moins de 20 kg (créneau 8h00 uniquement, vol découverte). Un vol performance est incompatible. Réservez deux vols séparés.' })
      setStep(3); return
    }

    // ── Sélection du créneau éligible ────────────────────────────────────────
    let eligibleSlots
if (hasLightChild) {
  eligibleSlots = [...slots].sort((a, b) => a.slot_time.localeCompare(b.slot_time)).filter(s => isFirstSlot(s.slot_time))
} else if (hasPerformance || hasHeavy) {
  // Performance → créneau tardif ; lourd seul → créneau tardif si dispo, sinon tous
  const laterSlots = [...slots].sort((a, b) => a.slot_time.localeCompare(b.slot_time)).filter(s => !isFirstSlot(s.slot_time))
  eligibleSlots = (hasPerformance || laterSlots.length > 0)
    ? laterSlots
    : [...slots].sort((a, b) => a.slot_time.localeCompare(b.slot_time))
} else {
  eligibleSlots = [...slots].sort((a, b) => a.slot_time.localeCompare(b.slot_time))
}

    if (eligibleSlots.length === 0) {
      setSuggestedSlot(null); setSelectedSlot(null); setSlotInfo(null); setConflictMode(null)
      setErrors({
        general: hasPerformance
          ? 'Aucun créneau disponible pour un vol performance ce jour-là. Essayez une autre date.'
          : 'Aucun créneau disponible pour vos passagers ce jour-là. Essayez une autre date.',
      })
      setStep(3); return
    }

    // ── Multi-slot flight type detection ────────────────────────────────────
    // If any passenger has a flight type requiring N consecutive slots, find them
    const maxBlocks = passengers.reduce((max, p) => {
      const ft = flightTypes.find(f => f.id === p.flight_type)
      return Math.max(max, ft?.blocks_slots ?? 1)
    }, 1)

    if (maxBlocks > 1) {
      // Ordered slot times from settings (e.g. ['08:00','09:15','10:30',...])
      const slotsConfig = settingsCtx?.settings?.slots ?? DEFAULT_SETTINGS.slots
      // Map available eligible slots by normalized HH:MM
      const availableByTime = {}
      for (const s of eligibleSlots) availableByTime[s.slot_time.slice(0, 5)] = s

      // Find first run of maxBlocks consecutive config slots all available
      let foundSlots = null
      for (let i = 0; i <= slotsConfig.length - maxBlocks; i++) {
        const run = []
        for (let j = 0; j < maxBlocks; j++) {
          const t = slotsConfig[i + j]
          if (availableByTime[t]) run.push(availableByTime[t])
          else break
        }
        if (run.length === maxBlocks) { foundSlots = run; break }
      }

      if (!foundSlots) {
        setSuggestedSlot(null); setSelectedSlot(null); setSelectedSlots([])
        setConflictMode(null); setSlotInfo(null)
        setErrors({ general: `Aucune série de ${maxBlocks} créneaux consécutifs disponible ce jour-là. Essayez une autre date.` })
        setStep(3); return
      }

      const timesStr = foundSlots.map(s => s.slot_time.slice(0, 5)).join(' + ')
      setSuggestedSlot(foundSlots[0])
      setSelectedSlot(foundSlots[0])
      setSelectedSlots(foundSlots)
      setConflictMode(null)
      setSlotInfo(`Ce vol occupe ${maxBlocks} créneaux consécutifs : ${timesStr}.`)
      setStep(3); return
    }

    // ── Single slot ─────────────────────────────────────────────────────────
    setSelectedSlots([])
    const { optionB } = suggestSlots(eligibleSlots)
    setSuggestedSlot(optionB); setSelectedSlot(optionB); setConflictMode(null)
    let slotInfoMsg = null
    if (hasLightChild && hasHeavy) {
      slotInfoMsg = '⚠️ Créneau 8h00 imposé (passager < 20 kg). Le passager de plus de 75 kg volera en vol découverte (20 min) — le vol sera plus court. Vous pouvez aussi réserver deux vols séparés.'
    }
    setSlotInfo(slotInfoMsg)
    setStep(3)
  }

  // Passager lourd : choisir 8h (avec avertissement)
  function chooseHeavy8h() {
    setSelectedSlot(slotTogether)
    setSlotInfo('⚠️ À 8h00, vous descendrez plus vite — les thermiques sont moins actifs tôt le matin.')
    setConflictMode(null)
  }

  // Passager lourd : choisir créneau tardif (recommandé)
  function chooseHeavyLater() {
    setSelectedSlot(slotAdultOnly)
    setSlotInfo(null)
    setConflictMode(null)
  }

  // Choisir option 1 : ensemble à 8h00, tout le monde en découverte
  function chooseTogetherAt8() {
    setPassengers(prev => prev.map(p => ({ ...p, flight_type: 'discovery' })))
    setSelectedSlot(slotTogether)
    setSlotInfo('⚠️ Vol découverte uniquement à 8h00. Le passager lourd descendra plus vite que sur un créneau tardif.')
    setConflictMode(null)
  }

  // Choisir option 2 : deux réservations séparées
  function chooseSplit() {
    setConflictMode('split_message')
    setSelectedSlot(null)
  }

  // ── OTP: send code to client phone ─────────────────────────────────────────
  async function requestOtp() {
    if (!contact.phone) {
      setErrors(prev => ({ ...prev, submit: 'Numéro de téléphone requis pour vérifier votre identité.' }))
      return
    }
    setOtpStep('sending')
    setOtpError('')
    setOtpCode('')

    try {
      const { error } = await supabase.functions.invoke('send-otp', {
        body: { phone: contact.phone },
      })
      if (error) {
        setOtpStep('error')
        setOtpError('Impossible d\'envoyer le SMS. Vérifiez votre numéro.')
        return
      }
      setOtpStep('waiting')
    } catch (err) {
      setOtpStep('error')
      setOtpError('Erreur réseau. Réessayez.')
    }
  }

  // ── OTP: verify code then submit ────────────────────────────────────────────
  async function verifyOtpAndSubmit() {
    if (otpCode.length !== 4) { setOtpError('Entrez les 4 chiffres reçus par SMS.'); return }
    setOtpStep('verifying')
    setOtpError('')

    try {
      const { data, error } = await supabase.functions.invoke('verify-otp', {
        body: { phone: contact.phone, code: otpCode },
      })
      if (error || !data?.valid) {
        setOtpStep('waiting')
        setOtpError('Code incorrect ou expiré. Réessayez ou demandez un nouveau code.')
        return
      }
      // Code is valid → proceed to actual booking
      await submitBooking()
    } catch (err) {
      setOtpStep('waiting')
      setOtpError('Erreur réseau. Réessayez.')
    }
  }

  async function submitBooking() {
    // Use multi-slot array when available, otherwise single slot
    const slotsToBook = selectedSlots.length > 1 ? selectedSlots : (selectedSlot ? [selectedSlot] : [])
    if (slotsToBook.length === 0) return
    setSubmitting(true)

    // ── Create primary booking on first slot ─────────────────────────────────
    const { data: bookingData, error: bookingError } = await supabase.from('bookings')
      .insert({
        pilot_slot_id: slotsToBook[0].id, status: 'pending', source: 'public',
        contact_name:  contact.name,       contact_phone: contact.phone,
        notes:         notes || null,
      })
      .select().single()

    if (bookingError) {
      setErrors({ submit: 'Erreur lors de la réservation. Réessayez.' })
      setSubmitting(false); return
    }

    const ref = bookingData.id.slice(0, 8).toUpperCase()

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

    // ── Create linked bookings for additional slots (multi-slot flights) ──────
    for (let i = 1; i < slotsToBook.length; i++) {
      const { data: extraBooking, error: extraErr } = await supabase.from('bookings')
        .insert({
          pilot_slot_id: slotsToBook[i].id, status: 'pending', source: 'public',
          contact_name:  contact.name,       contact_phone: contact.phone,
          notes:         `Lié à ${ref} — créneau ${i + 1}/${slotsToBook.length}`,
        })
        .select().single()

      if (!extraErr && extraBooking) {
        // Mirror passengers on the linked booking
        const linkedPax = passengers.map(p => ({
          booking_id:    extraBooking.id,
          first_name:    p.first_name,
          last_name:     p.last_name,
          weight_kg:     parseInt(p.weight_kg),
          age:           parseInt(p.age),
          flight_type:   p.flight_type,
          parental_auth: p.parental_auth,
          price_eur:     calculatePrice(parseInt(p.age), p.flight_type) * 100,
        }))
        await supabase.from('passengers').insert(linkedPax)
      }
    }

    const dateStr = formatDateFR(selectedDate)
    // For SMS: show all booked times
    const time    = slotsToBook.map(s => s.slot_time?.slice(0, 5)).join(' + ')
    const paxList = passengers.map(p => `${p.first_name} ${p.last_name}`).join(', ')

    // ── SMS au client ────────────────────────────────────────────────────────
    if (contact.phone) {
      const clientMsg =
        `Bonjour ${contact.name}, votre demande de vol parapente est enregistrée !\n` +
        `📅 ${dateStr} à ${time}\n` +
        `Réf : ${ref}\n` +
        `Le moniteur vous confirmera votre vol par SMS.\n` +
        `CGV : planete-parapente-reunion.com/cgv\n` +
        `L'equipe Planete Parapente`
      await sendSMS(contact.phone, clientMsg)
    }

    // ── SMS au pilote (Manu) ─────────────────────────────────────────────────
    // PILOT_PHONE is set as a Supabase secret — the Edge Function reads it.
    // Here we pass a special recipient "PILOT" so the function uses the env var.
    const pilotMsg =
      `🪂 Nouvelle réservation\n` +
      `Client : ${contact.name} — ${contact.phone}\n` +
      `📅 ${dateStr} à ${time}\n` +
      `Passagers : ${paxList}\n` +
      `Réf : ${ref}` +
      (notes ? `\nNote : ${notes}` : '')
    await sendSMS('PILOT', pilotMsg)

    setBookingRef(ref)
    setStep(4); setSubmitting(false)
  }

  // ── Step 4 ────────────────────────────────────────────────────────────────
  if (step === 4) return (
    <div className="booking-page">
      <div className="booking-done">
        <div className="done-icon">✅</div>
        <h2>Demande envoyée !</h2>
        <p>Référence : <strong>{bookingRef}</strong></p>
        <p>Le moniteur va confirmer votre vol. Vous serez contacté au numéro indiqué.</p>
        <button className="btn-primary" onClick={() => {
          setStep(1); setPassengers([emptyPassenger()]); setContact({ name: '', phone: '' }); setNotes('')
          setSelectedSlots([]); setSuggestedSlot(null); setSelectedSlot(null)
        }}>Nouvelle réservation</button>
      </div>
    </div>
  )

  // ── Steps 1–3 ─────────────────────────────────────────────────────────────
  return (
    <div className="booking-page">
      <header className="booking-header">
        <img src="/logo-icon.png" alt="Dispo Pas Dispo" style={{ height: 48, marginBottom: 10 }} />
        <h1>Réserver un vol</h1>
        <p>Planete Parapente - Saint-Leu</p>
      </header>

      {/* Step 1 */}
      {step >= 1 && (
        <section className="booking-section">
          <h2>1. Choisir une date</h2>
          <input type="date" value={selectedDate} min={TODAY} className="date-input"
            onChange={e => { setSelectedDate(e.target.value); setStep(2) }} />
          {slots.length === 0 && <p className="info-msg">Aucun créneau disponible pour cette date.</p>}
        </section>
      )}

      {/* Step 2 */}
      {step >= 2 && (
        <section className="booking-section">
          <h2>2. Passagers</h2>

          {/* Contact block — shown first */}
          <div className="passenger-card">
            <div className="passenger-header">Contact</div>
            <div className="field-row">
              <div className="field"><label>Nom</label>
                <input value={contact.name} onChange={e => setContact(c => ({ ...c, name: e.target.value }))} />
                {errors.contact_name && <span className="error-msg">{errors.contact_name}</span>}
              </div>
              <div className="field"><label>Téléphone</label>
                <input type="tel" value={contact.phone} onChange={e => setContact(c => ({ ...c, phone: e.target.value }))} />
                {errors.contact_phone && <span className="error-msg">{errors.contact_phone}</span>}
              </div>
            </div>
          </div>

          {passengers.map((p, i) => {
            const age       = parseInt(p.age, 10)
            const isChild   = !isNaN(age) && age > 0 && age <= AGE_LIMITS.CHILD_MAX_AGE
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
                  <div className="field"><label>Prénom (optionnel)</label>
                    <input value={p.first_name} onChange={e => updatePassenger(i, 'first_name', e.target.value)} />
                  </div>
                  <div className="field"><label>Nom (optionnel)</label>
                    <input value={p.last_name} onChange={e => updatePassenger(i, 'last_name', e.target.value)} />
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
                    {isChild
                      ? <option value={childFlightType.id}>
                          {childFlightType.label} — {childFlightType.duration_min} min ({childFlightType.price_eur} €)
                        </option>
                      : adultFlightTypes.map(ft => (
                          <option key={ft.id} value={ft.id}>
                            {ft.label} — {ft.duration_min} min ({ft.price_eur} €)
                            {ft.blocks_slots > 1 ? ` · ${ft.blocks_slots} créneaux` : ''}
                          </option>
                        ))
                    }
                  </select>
                  {isChild && (
                    <span className="info-msg">
                      Tarif {childFlightType.label} ({childFlightType.min_age}–{childFlightType.max_age} ans) — {childFlightType.duration_min} min.
                    </span>
                  )}
                  {!isChild && onlyFirst && <span className="info-msg">Vol découverte uniquement sur le créneau 8h.</span>}
                  {!isChild && (() => { const ft = flightTypes.find(f => f.id === p.flight_type); return ft?.blocks_slots > 1 ? <span className="info-msg">⚠️ Ce vol occupe {ft.blocks_slots} créneaux consécutifs.</span> : null })()}
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

          <div className="passenger-card">
            <div className="passenger-header">Notes (optionnel)</div>
            <div className="field">
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Mobilité réduite, occasion spéciale, message pour le moniteur…"
                rows={3}
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>
          </div>

          <button className="btn-primary" onClick={validateAndSuggest}>Voir les créneaux →</button>
        </section>
      )}

      {/* Step 3 */}
      {step >= 3 && (
        <section className="booking-section">
          <h2>3. Créneau proposé</h2>

          {/* ── Conflit enfant + performance ── */}
          {conflictMode === 'child_perf' && (
            <div className="conflict-block">
              <p className="info-msg">⚠️ Votre groupe mélange un enfant (vol découverte) et un adulte (vol performance). Choisissez :</p>

              <div className="conflict-options">
                <div className={`conflict-card ${!slotTogether ? 'disabled' : ''}`}>
                  <h3>Option 1 — Ensemble à 8h00</h3>
                  <p>Tous en vol découverte (20 min). L'adulte ne pourra pas faire un vol performance et descendra plus vite qu'en créneau tardif.</p>
                  {slotTogether
                    ? <button className="btn-primary" onClick={chooseTogetherAt8}>Choisir 08:00 ensemble</button>
                    : <p className="error-msg">Créneau 8h00 non disponible ce jour-là.</p>}
                </div>

                <div className={`conflict-card ${!slotAdultOnly ? 'disabled' : ''}`}>
                  <h3>Option 2 — Deux vols séparés</h3>
                  <p>
                    Enfant à 8h00 (découverte).<br />
                    Adulte à {slotAdultOnly?.slot_time?.slice(0, 5) || '—'} (performance).
                  </p>
                  {slotAdultOnly
                    ? <button className="btn-secondary" onClick={chooseSplit}>Réserver en deux fois</button>
                    : <p className="error-msg">Aucun créneau disponible pour l'adulte ce jour-là.</p>}
                </div>
              </div>
            </div>
          )}

          {/* ── Passager lourd : choisir 8h ou 9h15 ── */}
          {conflictMode === 'heavy' && (
            <div className="conflict-block">
              <p className="info-msg">ℹ️ Passager de plus de 75 kg — deux créneaux disponibles :</p>
              <div className="conflict-options">
                <div className="conflict-card">
                  <h3>8h00</h3>
                  <p>⚠️ Vous descendrez plus vite à cette heure — les thermiques sont moins actifs tôt le matin.</p>
                  <button className="btn-secondary" onClick={chooseHeavy8h}>Choisir 08:00</button>
                </div>
                <div className="conflict-card">
                  <h3>{slotAdultOnly?.slot_time?.slice(0, 5)} — Recommandé</h3>
                  <p>Meilleures conditions pour les passagers de plus de 75 kg. Vol plus long et plus confortable.</p>
                  <button className="btn-primary" onClick={chooseHeavyLater}>
                    Choisir {slotAdultOnly?.slot_time?.slice(0, 5)}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Message après choix option 2 ── */}
          {conflictMode === 'split_message' && (
            <div className="info-msg">
              <p>Réservez d'abord le vol de l'enfant (8h00), puis revenez faire une nouvelle réservation pour l'adulte.</p>
              <button className="btn-primary" onClick={() => {
                setStep(1); setPassengers([emptyPassenger()]); setContact({ name: '', phone: '' })
                setConflictMode(null)
              }}>Nouvelle réservation →</button>
            </div>
          )}

          {/* ── Créneau normal ── */}
          {!conflictMode && (
            <>
              {slotInfo && <p className="info-msg">{slotInfo}</p>}
              {errors.general && <p className="error-msg">{errors.general}</p>}

              {suggestedSlot ? (
                selectedSlots.length > 1 ? (
                  // Multi-slot: show each consecutive slot as a card
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {selectedSlots.map((s, idx) => (
                      <div key={s.id} className="slot-option recommended selected" style={{ flex: '1', minWidth: '80px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.7rem', opacity: 0.7, marginBottom: '2px' }}>
                          {idx === 0 ? '1er vol' : `${idx + 1}e vol`}
                        </div>
                        <span className="slot-time-big">{s.slot_time?.slice(0, 5)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="slot-option recommended selected">
                    <span className="slot-time-big">{suggestedSlot.slot_time?.slice(0, 5)}</span>
                  </div>
                )
              ) : (
                !errors.general && <p className="info-msg">Aucun créneau disponible pour vos contraintes ce jour-là.</p>
              )}

              {errors.submit && <p className="error-msg">{errors.submit}</p>}

              {selectedSlot && !otpStep && (
                <button className="btn-primary" onClick={requestOtp}>
                  Valider ma réservation →
                </button>
              )}

              {/* ── OTP verification block ── */}
              {selectedSlot && otpStep && (
                <div className="otp-block">
                  {otpStep === 'sending' && (
                    <p className="info-msg">📲 Envoi du code par SMS…</p>
                  )}

                  {(otpStep === 'waiting' || otpStep === 'verifying') && (
                    <>
                      <p className="info-msg">
                        📲 Un code à 4 chiffres a été envoyé au <strong>{contact.phone}</strong>.
                      </p>
                      <div className="otp-input-row">
                        <input
                          type="tel"
                          inputMode="numeric"
                          maxLength={4}
                          placeholder="_ _ _ _"
                          value={otpCode}
                          onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                          className="otp-input"
                          autoFocus
                        />
                        <button
                          className="btn-primary"
                          onClick={verifyOtpAndSubmit}
                          disabled={otpStep === 'verifying' || otpCode.length !== 4}
                        >
                          {otpStep === 'verifying' ? 'Vérification…' : 'Confirmer'}
                        </button>
                      </div>
                      {otpError && <p className="error-msg">{otpError}</p>}
                      <button
                        className="btn-ghost-small"
                        onClick={requestOtp}
                        disabled={otpStep === 'sending' || otpStep === 'verifying'}
                      >
                        Renvoyer le code
                      </button>
                    </>
                  )}

                  {otpStep === 'error' && (
                    <>
                      <p className="error-msg">{otpError}</p>
                      <button className="btn-secondary" onClick={requestOtp}>Réessayer</button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}
