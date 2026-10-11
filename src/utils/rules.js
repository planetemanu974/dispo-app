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

// Suggests the best slot — light passengers get 08h00, heavy get 10h00 as alternative
export function suggestSlots(slots, passenger) {
  const { weight_kg } = passenger
  const isHeavy = weight_kg >= WEIGHT_LIMITS.HEAVY_KG && weight_kg <= WEIGHT_LIMITS.MAX_KG

  const available = slots.filter(s => s.has_capacity)
  const firstSlot = available[0] || null
  const secondSlot = available[1] || null

  if (isHeavy) {
    // Heavy: recommend 08h00, offer 10h00 as alternative
    return { optionA: secondSlot, optionB: firstSlot }
  }

  // Light: recommend 08h00 only
  return { optionA: null, optionB: firstSlot }
}

// Returns true if passenger must book first slot only
export function requiresFirstSlotOnly(weightKg) {
  return weightKg >= WEIGHT_LIMITS.HEAVY_KG && weightKg <= WEIGHT_LIMITS.MAX_KG
}