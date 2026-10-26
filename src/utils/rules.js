// ============================================================
// Business rules — single source of truth
// ============================================================

export const WEIGHT_LIMITS = {
  MAX_KG:   100,
  HEAVY_KG:  76,
  LIGHT_KG:  20,   // < 20 kg → créneau 8h00 uniquement
}

export const AGE_LIMITS = {
  MIN_AGE:       6,
  MIN_WEIGHT_KG: 18,
  CHILD_MAX_AGE: 14,   // ≤ 14 ans → vol marmaille (80 €), discovery only
}

export const PRICES = {
  DISCOVERY_ADULT:  9000,
  MARMAILLE:        8000,  // discovery for children 6–14 ans, 80 €
  PERFORMANCE_BASE: 11000,
  PERFORMANCE_LONG: 12000,
}

// 8h00 = discovery only, ≤ 75 kg; 9h15 and after = all passengers
export function getSlotsForDate(/* date */) {
  return ['08:00', '09:15', '10:30', '11:45', '13:00', '14:15']
}

// Weight validation
export function validateWeight(weightKg) {
  if (weightKg > WEIGHT_LIMITS.MAX_KG) {
    return {
      ok: false,
      blocked: true,
      warning: `Poids maximum : 100 kg (assurance). Votre réservation ne peut pas être prise en compte.`,
    }
  }
  if (weightKg >= WEIGHT_LIMITS.HEAVY_KG) {
    return {
      ok: true,
      blocked: false,
      warning: `Les passagers de plus de 75 kg descendent plus vite et profitent moins du vol — le créneau suivant leur convient mieux.`,
    }
  }
  return { ok: true, blocked: false, warning: null }
}

// Age & weight validation
export function validateAge(age, weightKg, flightType) {
  if (age < AGE_LIMITS.MIN_AGE) {
    return { ok: false, error: `Âge minimum : ${AGE_LIMITS.MIN_AGE} ans`, requiresParentalAuth: false }
  }
  if (weightKg < AGE_LIMITS.MIN_WEIGHT_KG) {
    return { ok: false, error: `Poids minimum : ${AGE_LIMITS.MIN_WEIGHT_KG} kg`, requiresParentalAuth: false }
  }
  // Children ≤ 14 ans: marmaille or discovery only (no performance)
  if (age <= AGE_LIMITS.CHILD_MAX_AGE && flightType === 'performance') {
    return { ok: false, error: `Les moins de 15 ans : vol découverte / marmaille uniquement`, requiresParentalAuth: true }
  }
  return { ok: true, error: null, requiresParentalAuth: age < 18 }
}

// Price in euros
export function calculatePrice(age, flightType, durationMin = 20) {
  // Children ≤ 14 ans → tarif marmaille (80 €) regardless of flight_type label
  if (age <= AGE_LIMITS.CHILD_MAX_AGE) return PRICES.MARMAILLE / 100
  if (flightType === 'performance') {
    return durationMin >= 40 ? PRICES.PERFORMANCE_LONG / 100 : PRICES.PERFORMANCE_BASE / 100
  }
  return PRICES.DISCOVERY_ADULT / 100
}

// Slot suggestion
export function suggestSlots(slots) {
  return { optionA: null, optionB: slots[0] || null }
}