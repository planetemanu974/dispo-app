// ============================================================
// SettingsContext — global app settings loaded from Supabase
// Provides: slots, flight types, theme colors, school identity
// Applies theme colors as CSS custom properties on :root
// ============================================================

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// --------------- Default values (mirrors SQL defaults) ---------------

export const DEFAULT_SETTINGS = {
  school_name:     'Planete Parapente',
  school_location: 'Saint-Leu',

  slots: ['08:00', '09:15', '10:30', '11:45', '13:00', '14:15'],

  flight_types: [
    { id: 'discovery',   label: 'Découverte',    duration_min: 20, price_eur: 90,  min_age: 6,  max_age: null, max_weight_kg: 100 },
    { id: 'marmaille',   label: 'Vol marmaille', duration_min: 20, price_eur: 80,  min_age: 6,  max_age: 14,   max_weight_kg: 100 },
    { id: 'performance', label: 'Performance',   duration_min: 35, price_eur: 115, min_age: 15, max_age: null, max_weight_kg: 100 },
  ],

  color_bg:             '#000000',
  color_card:           '#0f172a',
  color_input:          '#1e293b',
  color_border:         '#334155',
  color_text:           '#e2e8f0',
  color_text_secondary: '#94a3b8',
  color_accent:         '#3b82f6',
  color_btn_bg:         '#ffffff',
  color_btn_text:       '#000000',
}

// --------------- Apply colors as CSS variables ---------------

function applyTheme(s) {
  const root = document.documentElement
  root.style.setProperty('--color-bg',             s.color_bg)
  root.style.setProperty('--color-card',           s.color_card)
  root.style.setProperty('--color-input',          s.color_input)
  root.style.setProperty('--color-border',         s.color_border)
  root.style.setProperty('--color-text',           s.color_text)
  root.style.setProperty('--color-text-secondary', s.color_text_secondary)
  root.style.setProperty('--color-accent',         s.color_accent)
  root.style.setProperty('--color-btn-bg',         s.color_btn_bg)
  root.style.setProperty('--color-btn-text',       s.color_btn_text)
}

// --------------- Context ---------------

const SettingsContext = createContext(null)

export function SettingsProvider({ children, userId }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loading,  setLoading]  = useState(true)

  // Load settings from Supabase on mount / userId change
  useEffect(() => {
    async function load() {
      let data = null

      if (userId) {
        // Authenticated user: load their own settings
        const { data: ownData, error } = await supabase
          .from('settings')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle()

        if (error && error.code !== 'PGRST116') {
          console.error('[settings] load error:', error)
        }

        if (ownData) {
          data = ownData
        } else {
          // First login: insert default row
          await supabase.from('settings').insert({ user_id: userId })
        }
      } else {
        // Anonymous visitor (public booking page): load first available row
        // Requires "settings_select_anon" policy in Supabase
        const { data: publicData } = await supabase
          .from('settings')
          .select('*')
          .limit(1)
          .maybeSingle()
        data = publicData
      }

      if (data) {
        const merged = { ...DEFAULT_SETTINGS, ...data }
        setSettings(merged)
        applyTheme(merged)
      } else {
        applyTheme(DEFAULT_SETTINGS)
      }

      setLoading(false)
    }

    load()
  }, [userId])

  // Save partial settings update to Supabase
  const saveSettings = useCallback(async (patch) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    applyTheme(next)

    const { error } = await supabase
      .from('settings')
      .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })

    if (error) console.error('[settings] save error:', error)
    return !error
  }, [settings, userId])

  // Helpers used throughout the app
  const getFlightType   = (id)  => settings.flight_types.find(f => f.id === id) ?? null
  const getPriceEur     = (id)  => getFlightType(id)?.price_eur ?? 90
  const getChildType    = (age) => settings.flight_types.find(
    f => f.max_age !== null && age <= f.max_age
  ) ?? null

  return (
    <SettingsContext.Provider value={{ settings, loading, saveSettings, getFlightType, getPriceEur, getChildType }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}
