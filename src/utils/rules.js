// ============================================================
// Business rules — single source of truth
// ============================================================

export const WEIGHT_LIMITS = {
  MAX_KG: 100,
  HEAVY_KG: 76,   // 76-100 kg → first slot only
}

export const AGE_LIMITS = {
  MIN_AGE: 6,
  MIN_WEIGHT_KG: 18,
  CHILD_MAX_AGE: 12,
}

export const PRICES = {
  DISCOVERY_ADULT:  9000,  // cents
  DISCOVERY_CHILD:  9000,
  PERFORMANCE_BASE: 11000,
  PERFORMANCE_LONG: 12000,
}

// Returns slot times for a given date (4 until end Oct 2026, 8 from Nov 2026)
export function getSlotsForDate(date) {
  const d = new Date(date)
  const isExtended = d >= new Date('2026-11-01')
  if (isExtended) {
    return ['08:00','09:00','10:00','11:00','13:00','14:00','15:00','16:00']
  }
  return ['08:00','10:00','13:00','15:00']
}

// Weight validation — returns { ok, blocked, warning }
export function validateWeight(weightKg, slotTime) {
  if (weightKg > WEIGHT_LIMITS.MAX_KG) {
    return { ok: false, blocked: true, warning: `Poids maximum 100 kg (${weightKg} kg refusé)` }
  }
  if (weightKg >= WEIGHT_LIMITS.HEAVY_KG) {
    const hour = parseInt(slotTime?.split(':')[0] || '8', 10)
    if (hour > 8) {
      return { ok: false, blocked: false, warning: `Entre 76 et 100 kg : créneau 08h00 uniquement (thermiques)` }
    }
  }
  return { ok: true, blocked: false, warning: null }
}

// Age validation — returns { ok, error, requiresParentalAuth }
export function validateAge(age, weightKg, flightType) {
  if (age < AGE_LIMITS.MIN_AGE) {
    return { ok: false, error: `Âge minimum : ${AGE_LIMITS.MIN_AGE} ans`, requiresParentalAuth: false }
  }
  if (weightKg < AGE_LIMITS.MIN_WEIGHT_KG) {
    return { ok: false, error: `Poids minimum : ${AGE_LIMITS.MIN_WEIGHT_KG} kg`, requiresParentalAuth: false }
  }
  if (age <= AGE_LIMITS.CHILD_MAX_AGE && flightType !== 'discovery') {
    return { ok: false, error: `Enfants (6-12 ans) : vol découverte uniquement`, requiresParentalAuth: true }
  }
  return { ok: true, error: null, requiresParentalAuth: age < 18 }
}

// Price in euros
export function calculatePrice(age, flightType, durationMin = 20) {
  if (flightType === 'performance') {
    return durationMin >= 40 ? PRICES.PERFORMANCE_LONG / 100 : PRICES.PERFORMANCE_BASE / 100
  }
  return PRICES.DISCOVERY_ADULT / 100
}

// ============================================================
// Business rules — single source of truth
// ============================================================

export const WEIGHT_LIMITS = {
  MAX_KG:   100,   // hard block (insurance)
  HEAVY_KG:  76,   // 76-100 kg → not allowed on first slot (8h00)
}

export const AGE_LIMITS = {
  MIN_AGE:       6,
  MIN_WEIGHT_KG: 18,
  CHILD_MAX_AGE: 12,
}

export const PRICES = {
  DISCOVERY_ADULT:  9000,   // cents
  DISCOVERY_CHILD:  8000,
  PERFORMANCE_BASE: 11000,
  PERFORMANCE_LONG: 12000,
}

// Slot times — 5 slots per day (new schedule, effective now)
// 8h00 = discovery only, ≤ 75 kg; 9h15 and after = all passengers
export function getSlotsForDate(/* date */) {
  return ['08:00', '09:15', '10:30', '11:45', '13:00']
}

// Weight validation — only hard-blocks passengers > 100 kg (insurance).
// The 8h00 exclusion for heavy passengers is handled upstream in Booking.jsx.
export function validateWeight(weightKg) {
  if (weightKg > WEIGHT_LIMITS.MAX_KG) {
    return {
      ok: false,
      blocked: true,
      warning: `Poids maximum : 100 kg (assurance). Votre réservation ne peut pas être prise en compte.`,
    }
  }
  return { ok: true, blocked: false, warning: null }
}

// Age & weight validation — returns { ok, error, requiresParentalAuth }
export function validateAge(age, weightKg, flightType) {
  if (age < AGE_LIMITS.MIN_AGE) {
    return { ok: false, error: `Âge minimum : ${AGE_LIMITS.MIN_AGE} ans`, requiresParentalAuth: false }
  }
  if (weightKg < AGE_LIMITS.MIN_WEIGHT_KG) {
    return { ok: false, error: `Poids minimum : ${AGE_LIMITS.MIN_WEIGHT_KG} kg`, requiresParentalAuth: false }
  }
  if (age <= AGE_LIMITS.CHILD_MAX_AGE && flightType !== 'discovery') {
    return { ok: false, error: `Enfants (6-12 ans) : vol découverte uniquement`, requiresParentalAuth: true }
  }
  return { ok: true, error: null, requiresParentalAuth: age < 18 }
}

// Price in euros
export function calculatePrice(age, flightType, durationMin = 20) {
  if (age < 13) return PRICES.DISCOVERY_CHILD / 100
  if (flightType === 'performance') {
    return durationMin >= 40 ? PRICES.PERFORMANCE_LONG / 100 : PRICES.PERFORMANCE_BASE / 100
  }
  return PRICES.DISCOVERY_ADULT / 100
}

// Slot suggestion — always returns the first slot in the list.
// The caller filters out ineligible slots (8h00 for heavy/performance) beforehand.
export function suggestSlots(slots) {
  return { optionA: null, optionB: slots[0] || null }
}

// Returns true if passenger must book first slot only
export function requiresFirstSlotOnly(weightKg) {
  return weightKg >= WEIGHT_LIMITS.HEAVY_KG && weightKg <= WEIGHT_LIMITS.MAX_KG
}