import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { validateWeight, validateAge, calculatePrice, suggestSlots, AGE_LIMITS, WEIGHT_LIMITS } from '../utils/rules'
import { useSettings, DEFAULT_SETTINGS } from '../contexts/SettingsContext'
import MascotAssistant from '../components/MascotAssistant'

const TODAY = new Date().toISOString().split('T')[0]
const emptyPassenger = () => ({
  first_name: '', last_name: '', weight_kg: '', age: '',
  flight_type: 'discovery', parental_auth: false,
})

// Safe integer parse: returns fallback when value is empty / NaN.
// Use null as fallback for weight_kg (performance passengers have no weight — CHECK constraint allows NULL).
// Use a numeric fallback for age (adults have no age field but column may be NOT NULL).
const safeInt = (v, fallback = 0) => { const n = parseInt(v, 10); return isNaN(n) ? fallback : n }
// Weight: if field is empty (e.g. performance passengers), fall back to 70 kg.
// DB column is NOT NULL and has a check constraint that rejects 0.
const safeWeight = (v, fallback = 70) => { const n = parseInt(v, 10); return (isNaN(n) || n <= 0) ? fallback : n }

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
  // Quick-fill counts
  const [totalCount, setTotalCount]           = useState(1)
  const [childCount, setChildCount]           = useState(0)
  const [discoveryCount, setDiscoveryCount]   = useState(1)
  const [performanceCount, setPerformanceCount] = useState(0)
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
  const [splitMode, setSplitMode]         = useState(false)  // true when Option 2 chosen: two bookings at once
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

  // Build passenger rows from the 4 quick-fill counts, preserving existing data.
  // Marmaille rows always come first and carry is_marmaille:true to lock their flight type.
  function buildPassengersFromCounts(total, children, disco, perf, existing) {
    const childFTId = childFlightType?.id || 'discovery'
    const rows = []
    for (let i = 0; i < total; i++) {
      const prev = existing[i] || {}
      if (i < children) {
        // Marmaille — vol verrouillé, autorisation parentale obligatoire
        rows.push({ ...emptyPassenger(),
          first_name:    prev.first_name||'',  last_name: prev.last_name||'',
          weight_kg:     prev.weight_kg||'',   age:       prev.age||'',
          flight_type:   childFTId,
          parental_auth: prev.parental_auth||false,
          is_marmaille:  true,
        })
      } else if (i < children + disco) {
        rows.push({ ...emptyPassenger(),
          first_name: prev.first_name||'', last_name: prev.last_name||'',
          weight_kg:  prev.weight_kg||'',  age:       prev.age||'',
          flight_type: 'discovery', is_marmaille: false,
        })
      } else if (i < children + disco + perf) {
        rows.push({ ...emptyPassenger(),
          first_name: prev.first_name||'', last_name: prev.last_name||'',
          weight_kg:  prev.weight_kg||'',  age:       prev.age||'',
          flight_type: 'performance', is_marmaille: false,
        })
      } else {
        rows.push({ ...emptyPassenger(),
          first_name: prev.first_name||'', last_name: prev.last_name||'',
          weight_kg:  prev.weight_kg||'',  age:       prev.age||'',
          flight_type: adultFlightTypes[0]?.id || 'discovery', is_marmaille: false,
        })
      }
    }
    return rows
  }

  // The booking assistant ("mascotte") hands over what it gathered in the chat. We only pre-fill the
  // regular form (date, passengers, contact): all validations, the parental authorisation, the
  // slot proposals and the SMS verification still happen below, as for any booking.
  function applyAssistantDraft(draft) {
    if (!draft) return
    const list = Array.isArray(draft.passengers) ? draft.passengers.slice(0, 6) : []
    if (/^\d{4}-\d{2}-\d{2}$/.test(draft.date || '') && draft.date >= TODAY) setSelectedDate(draft.date)

    if (list.length) {
      const kids   = list.filter(p => p.kind === 'child')
      const adults = list.filter(p => p.kind !== 'child')
      const disco  = adults.filter(p => p.flight !== 'performance')
      const perf   = adults.filter(p => p.flight === 'performance')
      const ordered = [...kids, ...disco, ...perf]   // same order as buildPassengersFromCounts
      const rows = buildPassengersFromCounts(ordered.length, kids.length, disco.length, perf.length, [])
      ordered.forEach((p, i) => {
        rows[i] = {
          ...rows[i],
          first_name: String(p.first_name || '').slice(0, 40),
          age:        p.age ? String(parseInt(p.age, 10) || '') : '',
          weight_kg:  p.weight_kg ? String(parseInt(p.weight_kg, 10) || '') : '',
        }
      })
      setTotalCount(ordered.length); setChildCount(kids.length)
      setDiscoveryCount(disco.length); setPerformanceCount(perf.length)
      setPassengers(rows)
    }
    if (draft.contact_name || draft.phone) {
      setContact(c => ({
        name:  String(draft.contact_name || c.name || '').slice(0, 80),
        phone: String(draft.phone || c.phone || '').slice(0, 30),
      }))
    }
    // Start the slot proposal again from the pre-filled form
    setConflictMode(null); setSuggestedSlot(null); setSelectedSlot(null)
    setSlotInfo(null); setSelectedSlots([]); setErrors({}); setSplitMode(false)
    setStep(2)
    setTimeout(() => document.getElementById('booking-passengers')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350)
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

      // Weight required for marmaille and discovery adults; not needed for performance
      const needsWeight = p.is_marmaille || p.flight_type !== 'performance'
      if (needsWeight && (!p.weight_kg || p.weight_kg === '')) { newErrors[`${i}_weight`] = 'Veuillez indiquer le poids'; valid = false }

      // Age required only for marmaille
      if (p.is_marmaille && (!age || age < 0)) { newErrors[`${i}_age`] = 'Âge requis'; valid = false }

      // Marmaille weight check — insurance minimum 18 kg
      if (p.is_marmaille && weight) {
        const minW = AGE_LIMITS.MIN_WEIGHT_KG ?? 18
        if (weight < minW) {
          newErrors[`${i}_weight`] = `Pour des raisons d'assurance, nous ne faisons voler les enfants qu'à partir de ${minW} kg.`
          valid = false
        }
      }

      // Marmaille age range check (blocks submission if age out of range)
      if (p.is_marmaille && age) {
        const minAge = childFlightType?.min_age ?? 6
        const maxAge = childFlightType?.max_age ?? 14
        if (age < minAge) {
          newErrors[`${i}_age`] = `Le parapente est réservé aux enfants de ${minAge} ans minimum. Cette réservation ne peut pas aboutir.`
          valid = false
        } else if (age > maxAge) {
          newErrors[`${i}_age`] = `Le vol marmaille est réservé aux enfants jusqu'à ${maxAge} ans. Changez le type de vol.`
          valid = false
        }
      }

      // Adults: validate weight category and parental auth only (no age check)
      if (!p.is_marmaille && weight) {
        const wResult = validateWeight(weight)
        if (wResult.blocked) { newErrors[`${i}_weight`] = wResult.warning; valid = false }
      }

      // Marmaille parental auth check (age always < 18)
      if (p.is_marmaille && !p.parental_auth) {
        newErrors[`${i}_parental`] = 'Autorisation parentale requise'; valid = false
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

  // Choisir option 2 : confirmer les deux créneaux en une seule soumission
  function chooseSplitConfirm() {
    setSplitMode(true)
    setConflictMode(null)
    setSelectedSlot(slotTogether)   // unlocks the OTP / submit button
    setSlotInfo(null)
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

  // ── Split booking: create two separate bookings (8h + late slot) ──────────
  async function submitSplitBooking() {
    setSubmitting(true)
    const time8    = slotTogether?.slot_time?.slice(0, 5) || '08:00'
    const timeLate = slotAdultOnly?.slot_time?.slice(0, 5) || '—'

    // Compute slot assignments (same logic as the UI preview)
    const assign = passengers.map(p => {
      if (p.is_marmaille) return time8
      if (p.flight_type === 'performance') return timeLate
      return parseInt(p.weight_kg) < 70 ? time8 : timeLate
    })
    // Safety: ensure child has an adult companion at 08:00
    const hasChild    = passengers.some(p => p.is_marmaille)
    const hasAdultAt8 = assign.some((s, i) => s === time8 && !passengers[i].is_marmaille)
    if (hasChild && !hasAdultAt8) {
      const firstDiscoIdx = passengers.findIndex(p => !p.is_marmaille && p.flight_type !== 'performance')
      if (firstDiscoIdx >= 0) assign[firstDiscoIdx] = time8
    }
    const pax8h   = passengers.filter((_, i) => assign[i] === time8)
    const paxLate = passengers.filter((_, i) => assign[i] === timeLate)

    // ── Booking 1 : 8h00 ─────────────────────────────────────────────────────
    const { data: b1, error: e1 } = await supabase.from('bookings')
      .insert({ pilot_slot_id: slotTogether.id, status: 'pending', source: 'public',
                contact_name: contact.name, contact_phone: contact.phone, notes: notes || null })
      .select().single()
    if (e1) { setErrors({ submit: 'Erreur réservation 8h00. Réessayez.' }); setSubmitting(false); return }

    const ref = b1.id.slice(0, 8).toUpperCase()
    const { error: e1pax } = await supabase.from('passengers').insert(pax8h.map(p => ({
      booking_id: b1.id, first_name: p.first_name, last_name: p.last_name,
      // safeInt avoids NaN→null on NOT-NULL columns (adults have no age field, perf has no weight)
      weight_kg: safeWeight(p.weight_kg),
      age:       safeInt(p.age, p.is_marmaille ? 12 : 30),
      flight_type: p.flight_type, parental_auth: p.parental_auth || false,
      price_eur: calculatePrice(safeInt(p.age, 30), p.flight_type) * 100,
    })))
    if (e1pax) { setErrors({ submit: `Erreur passagers 8h : ${e1pax.message}` }); setSubmitting(false); return }

    // ── Booking 2 : créneau tardif ────────────────────────────────────────────
    const { data: b2, error: e2 } = await supabase.from('bookings')
      .insert({ pilot_slot_id: slotAdultOnly.id, status: 'pending', source: 'public',
                contact_name: contact.name, contact_phone: contact.phone,
                notes: `Lié à ${ref}` })
      .select().single()
    if (e2) { setErrors({ submit: 'Erreur réservation créneau tardif. Réessayez.' }); setSubmitting(false); return }

    const { error: e2pax } = await supabase.from('passengers').insert(paxLate.map(p => ({
      booking_id: b2.id, first_name: p.first_name, last_name: p.last_name,
      weight_kg: safeWeight(p.weight_kg),
      age:       safeInt(p.age, p.is_marmaille ? 12 : 30),
      flight_type: p.flight_type, parental_auth: p.parental_auth || false,
      price_eur: calculatePrice(safeInt(p.age, 30), p.flight_type) * 100,
    })))
    if (e2pax) { setErrors({ submit: `Erreur passagers créneau tardif : ${e2pax.message}` }); setSubmitting(false); return }

    const dateStr = formatDateFR(selectedDate)

    // ── SMS au client ─────────────────────────────────────────────────────────
    if (contact.phone) {
      const names8h   = pax8h.map(p => p.first_name || 'passager').join(', ')
      const namesLate = paxLate.map(p => p.first_name || 'passager').join(', ')
      const clientMsg =
        `Bonjour ${contact.name}, votre demande est enregistrée !\n` +
        `📅 ${dateStr}\n` +
        `🕗 ${time8} : ${names8h}\n` +
        `🕗 ${timeLate} : ${namesLate}\n` +
        `Réf : ${ref}\n` +
        `Le moniteur vous confirmera vos vols par SMS.\n` +
        `L'equipe Planete Parapente`
      await sendSMS(contact.phone, clientMsg)
    }

    // ── SMS au pilote ─────────────────────────────────────────────────────────
    const names8h   = pax8h.map(p => p.first_name || 'passager').join(', ')
    const namesLate = paxLate.map(p => p.first_name || 'passager').join(', ')
    const pilotMsg =
      `🪂 Réservation 2 créneaux\n` +
      `Client : ${contact.name} — ${contact.phone}\n` +
      `📅 ${dateStr}\n` +
      `🕗 ${time8} : ${names8h}\n` +
      `🕗 ${timeLate} : ${namesLate}\n` +
      `Réf : ${ref}` +
      (notes ? `\nNote : ${notes}` : '')
    await sendSMS('PILOT', pilotMsg)

    setBookingRef(ref)
    setStep(4)
    setSubmitting(false)
  }

  async function submitBooking() {
    // Delegate to split booking flow when Option 2 was chosen
    if (splitMode) { await submitSplitBooking(); return }

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
      weight_kg:     safeWeight(p.weight_kg),
      age:           safeInt(p.age, p.is_marmaille ? 12 : 30),
      flight_type:   p.flight_type,
      parental_auth: p.parental_auth || false,
      price_eur:     calculatePrice(safeInt(p.age, 30), p.flight_type) * 100,
    }))

    const { error: paxError } = await supabase.from('passengers').insert(paxInserts)
    if (paxError) {
      setErrors({ submit: `Erreur passagers : ${paxError.message}` })
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
          weight_kg:     safeWeight(p.weight_kg),
          age:           safeInt(p.age, p.is_marmaille ? 12 : 30),
          flight_type:   p.flight_type,
          parental_auth: p.parental_auth || false,
          price_eur:     calculatePrice(safeInt(p.age, 30), p.flight_type) * 100,
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
          setSplitMode(false); setConflictMode(null)
          setTotalCount(1); setChildCount(0); setDiscoveryCount(1); setPerformanceCount(0)
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

      <MascotAssistant onApply={applyAssistantDraft} />

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
        <section className="booking-section" id="booking-passengers">
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

          {/* ── Quick-fill: 4 compact dropdowns ─────────────────────────────── */}
          <div className="passenger-card">
            <div className="passenger-header" style={{ flexDirection:'column', alignItems:'flex-start', gap:4 }}>
              <span>Votre groupe</span>
              <span style={{ fontSize:12, fontWeight:400, opacity:.75 }}>
                Les vols sont réservés aux personnes de plus de 18 kg et moins de 100 kg <span style={{ opacity:.7 }}>(régis par nos assurances)</span>
              </span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>

              {/* Personnes */}
              <div className="field">
                <label>Personnes</label>
                <select value={totalCount} onChange={e => {
                  const total    = parseInt(e.target.value)
                  const children = Math.min(childCount, total)
                  const free     = total - children
                  const disco    = Math.min(discoveryCount, free)
                  const perf     = Math.min(performanceCount, free - disco)
                  setTotalCount(total); setChildCount(children)
                  setDiscoveryCount(disco); setPerformanceCount(perf)
                  setPassengers(buildPassengersFromCounts(total, children, disco, perf, passengers))
                }}>
                  {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>

              {/* Marmailles */}
              <div className="field">
                <label>Enfants (–14 ans)</label>
                <select value={childCount} onChange={e => {
                  const children = parseInt(e.target.value)
                  const free     = totalCount - children
                  const disco    = Math.min(discoveryCount, free)
                  const perf     = Math.min(performanceCount, free - disco)
                  setChildCount(children); setDiscoveryCount(disco); setPerformanceCount(perf)
                  setPassengers(buildPassengersFromCounts(totalCount, children, disco, perf, passengers))
                }}>
                  {Array.from({ length: totalCount + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>

              {/* Découverte */}
              <div className="field">
                <label>Vols Découverte</label>
                <select value={discoveryCount} onChange={e => {
                  const disco = parseInt(e.target.value)
                  const free  = totalCount - childCount
                  const perf  = Math.min(performanceCount, free - disco)
                  setDiscoveryCount(disco); setPerformanceCount(perf)
                  setPassengers(buildPassengersFromCounts(totalCount, childCount, disco, perf, passengers))
                }}>
                  {Array.from({ length: totalCount - childCount + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>

              {/* Performance */}
              <div className="field">
                <label>Vols Performance</label>
                <select value={performanceCount} onChange={e => {
                  const perf  = parseInt(e.target.value)
                  const free  = totalCount - childCount
                  const disco = Math.min(discoveryCount, free - perf)
                  setPerformanceCount(perf); setDiscoveryCount(disco)
                  setPassengers(buildPassengersFromCounts(totalCount, childCount, disco, perf, passengers))
                }}>
                  {Array.from({ length: totalCount - childCount + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          </div>

          {passengers.map((p, i) => {
            const age        = parseInt(p.age, 10)
            const isChild    = p.is_marmaille || (!isNaN(age) && age > 0 && age <= AGE_LIMITS.CHILD_MAX_AGE)
            const onlyFirst  = slots.every(s => isFirstSlot(s.slot_time))
            // Show parental auth as soon as is_marmaille is set OR age < 18 entered
            const needsAuth  = p.is_marmaille || (parseInt(p.age) < 18 && p.age !== '')

            return (
              <div key={i} className="passenger-card">
                <div className="passenger-header">
                  {/* Label de l'en-tête : "Marmaille N" si enfant, sinon "Passager N" */}
                  <span style={{ display:'flex', alignItems:'center', gap:6 }}>
                    {p.is_marmaille && (
                      <span style={{
                        background:'#f59e0b', color:'#000', fontSize:10, fontWeight:700,
                        borderRadius:4, padding:'1px 6px', textTransform:'uppercase', letterSpacing:'.5px'
                      }}>Marmaille</span>
                    )}
                    Passager {i + 1}
                  </span>
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

                {p.is_marmaille ? (
                  /* Marmaille — exact weight (18 kg min) + age (6–14) required */
                  <div className="field-row">
                    <div className="field"><label>Poids (kg)</label>
                      <input type="number" min="1" max="100" value={p.weight_kg}
                        onChange={e => updatePassenger(i, 'weight_kg', e.target.value)} />
                      {p.weight_kg !== '' && (() => {
                        const w = parseInt(p.weight_kg, 10)
                        const minW = AGE_LIMITS.MIN_WEIGHT_KG ?? 18
                        if (!isNaN(w) && w < minW) return (
                          <span className="error-msg" style={{ display:'block', marginTop:4 }}>
                            ⚠️ Pour des raisons d'assurance, nous ne faisons voler les enfants qu'à partir de {minW} kg.
                          </span>
                        )
                        return null
                      })()}
                      {errors[`${i}_weight`] && <span className="error-msg">{errors[`${i}_weight`]}</span>}
                    </div>
                    <div className="field"><label>Âge</label>
                      <input type="number" min="1" max="99" value={p.age}
                        onChange={e => updatePassenger(i, 'age', e.target.value)} />
                      {p.age !== '' && (() => {
                        const a = parseInt(p.age, 10)
                        const minA = childFlightType?.min_age ?? 6
                        const maxA = childFlightType?.max_age ?? 14
                        if (!isNaN(a) && a < minA) return (
                          <span className="error-msg" style={{ display:'block', marginTop:4 }}>
                            ⚠️ Le parapente est réservé aux enfants de {minA} ans minimum. Cette réservation ne peut pas aboutir.
                          </span>
                        )
                        if (!isNaN(a) && a > maxA) return (
                          <span className="error-msg" style={{ display:'block', marginTop:4 }}>
                            ⚠️ Le vol marmaille est pour les {minA}–{maxA} ans. Modifiez le type de vol ci-dessus.
                          </span>
                        )
                        return null
                      })()}
                      {errors[`${i}_age`] && <span className="error-msg">{errors[`${i}_age`]}</span>}
                    </div>
                  </div>
                ) : p.flight_type === 'performance' ? (
                  /* Performance — weight irrelevant (no 8h slot, no light-passenger rule) */
                  null
                ) : (
                  /* Discovery adult — weight category needed for slot suggestion */
                  <div className="field">
                    <label>Poids</label>
                    <select value={p.weight_kg}
                      onChange={e => updatePassenger(i, 'weight_kg', e.target.value)}>
                      <option value="">— Sélectionnez —</option>
                      <option value="60">Moins de 70 kg</option>
                      <option value="80">70 kg et plus</option>
                    </select>
                    {errors[`${i}_weight`] && <span className="error-msg">{errors[`${i}_weight`]}</span>}
                  </div>
                )}

                <div className="field">
                  <label>Type de vol</label>
                  {isChild ? (
                    // Marmaille — locked amber block
                    <div style={{
                      padding:'8px 12px', borderRadius:8,
                      background:'rgba(245,158,11,.12)', border:'1px solid rgba(245,158,11,.35)',
                      color:'#fbbf24', fontWeight:600, fontSize:14,
                      display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:4,
                    }}>
                      <span>🪂 {childFlightType.label} — {childFlightType.duration_min} min · {childFlightType.price_eur} €</span>
                      <span style={{ fontSize:11, fontWeight:500, opacity:.8 }}>🕗 Créneau 8h00 · {childFlightType.min_age}–{childFlightType.max_age} ans</span>
                    </div>
                  ) : (() => {
                    // Adult — flight type locked (chosen by top dropdowns), displayed as read-only block
                    const ft = flightTypes.find(f => f.id === p.flight_type)
                    if (!ft) return null
                    return (
                      <div style={{
                        padding:'8px 12px', borderRadius:8,
                        background:'rgba(99,102,241,.1)', border:'1px solid rgba(99,102,241,.3)',
                        color:'#a5b4fc', fontWeight:600, fontSize:14,
                        display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:4,
                      }}>
                        <span>🪂 {ft.label} — {ft.duration_min} min · {ft.price_eur} €</span>
                        {ft.blocks_slots > 1 && (
                          <span style={{ fontSize:11, fontWeight:500, opacity:.8 }}>⚠️ {ft.blocks_slots} créneaux consécutifs</span>
                        )}
                      </div>
                    )
                  })()}
                </div>

                {/* Autorisation parentale — une seule ligne compacte */}
                {needsAuth && (
                  <label style={{
                    display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                    padding:'6px 10px', borderRadius:6, fontSize:13,
                    background: p.parental_auth ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)',
                    border: `1px solid ${p.parental_auth ? 'rgba(34,197,94,.35)' : 'rgba(239,68,68,.35)'}`,
                  }}>
                    <input type="checkbox" checked={p.parental_auth}
                      onChange={e => updatePassenger(i, 'parental_auth', e.target.checked)}
                      style={{ flexShrink:0, margin:0 }} />
                    <span><strong>Autorisation parentale</strong><span style={{ opacity:.65, fontWeight:400 }}> — obligatoire &lt;18 ans</span></span>
                    {errors[`${i}_parental`] && <span className="error-msg" style={{ marginLeft:4 }}>{errors[`${i}_parental`]}</span>}
                  </label>
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
                  <h3>Option 2 — Deux créneaux</h3>
                  {(() => {
                    // Compute slot per passenger:
                    // - marmaille → 08:00
                    // - performance → later slot
                    // - discovery light (<70 kg, value=60) → 08:00
                    // - discovery heavy (≥70 kg, value=80) → later slot
                    // Edge case: if no discovery adult is at 08:00 but child is, put first heavy adult at 08:00
                    const time8    = slotTogether?.slot_time?.slice(0, 5) || '08:00'
                    const timeLate = slotAdultOnly?.slot_time?.slice(0, 5) || '—'
                    const slots = passengers.map(p => {
                      if (p.is_marmaille) return time8
                      if (p.flight_type === 'performance') return timeLate
                      return parseInt(p.weight_kg) < 70 ? time8 : timeLate
                    })
                    // Ensure child has an adult companion at 08:00
                    const hasChild       = passengers.some(p => p.is_marmaille)
                    const hasAdultAt8    = slots.some((s, i) => s === time8 && !passengers[i].is_marmaille)
                    if (hasChild && !hasAdultAt8) {
                      const firstDiscoIdx = passengers.findIndex(p => !p.is_marmaille && p.flight_type !== 'performance')
                      if (firstDiscoIdx >= 0) slots[firstDiscoIdx] = time8
                    }
                    return (
                      <div style={{ margin:'8px 0', fontSize:13, lineHeight:1.9 }}>
                        {passengers.map((p, idx) => (
                          <div key={idx} style={{ display:'flex', justifyContent:'space-between', gap:12 }}>
                            <span style={{ opacity:.8 }}>
                              {p.is_marmaille ? '🟡' : '🔵'} Passager {idx + 1}
                              {p.first_name ? ` — ${p.first_name}` : ''}
                            </span>
                            <span style={{ fontWeight:600, whiteSpace:'nowrap' }}>🕗 {slots[idx]}</span>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                  {slotAdultOnly
                    ? <button className="btn-secondary" onClick={chooseSplitConfirm}>Confirmer les deux créneaux →</button>
                    : <p className="error-msg">Aucun créneau disponible ce jour-là.</p>}
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


          {/* ── Créneau normal ── */}
          {!conflictMode && (
            <>
              {slotInfo && <p className="info-msg">{slotInfo}</p>}
              {errors.general && <p className="error-msg">{errors.general}</p>}

              {/* ── Split booking summary (Option 2 chosen) ── */}
              {splitMode && slotTogether && slotAdultOnly ? (() => {
                const time8    = slotTogether.slot_time?.slice(0, 5) || '08:00'
                const timeLate = slotAdultOnly.slot_time?.slice(0, 5) || '—'
                const assign   = passengers.map(p => {
                  if (p.is_marmaille) return time8
                  if (p.flight_type === 'performance') return timeLate
                  return parseInt(p.weight_kg) < 70 ? time8 : timeLate
                })
                // Safety: ensure child has an adult at 08:00
                const hasChild    = passengers.some(p => p.is_marmaille)
                const hasAdultAt8 = assign.some((s, i) => s === time8 && !passengers[i].is_marmaille)
                if (hasChild && !hasAdultAt8) {
                  const firstDiscoIdx = passengers.findIndex(p => !p.is_marmaille && p.flight_type !== 'performance')
                  if (firstDiscoIdx >= 0) assign[firstDiscoIdx] = time8
                }
                const pax8h   = passengers.filter((_, i) => assign[i] === time8)
                const paxLate = passengers.filter((_, i) => assign[i] === timeLate)
                return (
                  <div style={{ background:'rgba(99,102,241,.08)', border:'1px solid rgba(99,102,241,.25)', borderRadius:10, padding:'12px 14px', marginBottom:8 }}>
                    <p style={{ margin:'0 0 10px', fontSize:13, color:'#a5b4fc', fontWeight:600 }}>✅ Deux créneaux réservés simultanément</p>
                    <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                      <div style={{ flex:1, minWidth:110, background:'rgba(99,102,241,.12)', borderRadius:8, padding:'8px 12px' }}>
                        <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>🕗 {time8}</div>
                        {pax8h.map((p, i) => <div key={i} style={{ fontSize:13, opacity:.85 }}>{p.is_marmaille ? '🟡' : '🔵'} {p.first_name || `Passager`}</div>)}
                      </div>
                      <div style={{ flex:1, minWidth:110, background:'rgba(99,102,241,.12)', borderRadius:8, padding:'8px 12px' }}>
                        <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>🕗 {timeLate}</div>
                        {paxLate.map((p, i) => <div key={i} style={{ fontSize:13, opacity:.85 }}>{p.is_marmaille ? '🟡' : '🔵'} {p.first_name || `Passager`}</div>)}
                      </div>
                    </div>
                  </div>
                )
              })() : suggestedSlot ? (
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

              {(selectedSlot || splitMode) && !otpStep && (
                <button className="btn-primary" onClick={requestOtp}>
                  {splitMode ? 'Valider les deux créneaux →' : 'Valider ma réservation →'}
                </button>
              )}

              {/* ── OTP verification block ── */}
              {(selectedSlot || splitMode) && otpStep && (
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
