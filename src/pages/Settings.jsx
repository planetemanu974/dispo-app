// ============================================================
// Settings page — Paramètres de l'application
// Tabs: Créneaux | Vols & tarifs | Apparence
// ============================================================

import { useState } from 'react'
import { useSettings } from '../contexts/SettingsContext'

// --------------- Inline styles ---------------
const s = {
  page:        { minHeight: '100vh', background: '#000', color: '#e2e8f0', fontFamily: 'system-ui,sans-serif' },
  header:      { display: 'flex', alignItems: 'center', gap: 12, padding: '20px 16px 0', borderBottom: '1px solid #1e293b' },
  title:       { fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: 0 },
  subtitle:    { fontSize: 13, color: '#64748b', margin: '2px 0 0' },
  tabs:        { display: 'flex', gap: 0, borderBottom: '1px solid #1e293b', padding: '0 16px' },
  tab:         { padding: '12px 16px', fontSize: 14, fontWeight: 500, color: '#64748b', cursor: 'pointer', border: 'none', background: 'none', borderBottom: '2px solid transparent', transition: 'all .15s' },
  tabActive:   { color: '#f1f5f9', borderBottomColor: '#3b82f6' },
  body:        { padding: '20px 16px', maxWidth: 600 },
  section:     { marginBottom: 28 },
  label:       { display: 'block', fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.5px' },
  input:       { width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 14, padding: '9px 12px', boxSizing: 'border-box', outline: 'none' },
  row:         { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 },
  btn:         { padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', transition: 'opacity .15s' },
  btnPrimary:  { background: '#3b82f6', color: '#fff' },
  btnDanger:   { background: '#1f0a0a', color: '#f87171', border: '1px solid #7f1d1d' },
  btnSuccess:  { background: '#052e16', color: '#4ade80', border: '1px solid #166534' },
  btnGhost:    { background: '#1e293b', color: '#e2e8f0' },
  card:        { background: '#0f172a', borderRadius: 12, padding: '16px', marginBottom: 12, border: '1px solid #1e293b' },
  cardTitle:   { fontSize: 15, fontWeight: 600, color: '#f1f5f9', marginBottom: 12 },
  grid2:       { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  colorRow:    { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  colorLabel:  { flex: 1, fontSize: 14, color: '#cbd5e1' },
  colorInput:  { width: 44, height: 36, padding: 2, borderRadius: 6, border: '1px solid #334155', background: '#1e293b', cursor: 'pointer' },
  saved:       { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#4ade80', marginLeft: 12 },
  swatch:      { width: 20, height: 20, borderRadius: 4, border: '1px solid #334155', flexShrink: 0 },
  warn:        { fontSize: 12, color: '#f59e0b', marginTop: 4 },
  fieldGroup:  { display: 'flex', gap: 10, alignItems: 'flex-start' },
  flightGrid:  { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 },
}

// --------------- Tab: Créneaux ---------------

function TabSlots({ settings, saveSettings }) {
  const [slots,   setSlots]   = useState([...settings.slots])
  const [newSlot, setNewSlot] = useState('')
  const [saved,   setSaved]   = useState(false)

  async function handleSave() {
    const sorted = [...slots].sort()
    const ok = await saveSettings({ slots: sorted })
    if (ok) { setSlots(sorted); setSaved(true); setTimeout(() => setSaved(false), 2000) }
  }

  function addSlot() {
    const v = newSlot.trim()
    if (!v || slots.includes(v)) return
    setSlots(prev => [...prev, v].sort())
    setNewSlot('')
  }

  function removeSlot(s) { setSlots(prev => prev.filter(x => x !== s)) }

  return (
    <div>
      <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 0 }}>
        Définissez les créneaux de décollage proposés à la réservation. Ils s'appliquent à tous les jours.
      </p>

      <div style={s.card}>
        {slots.map(slot => (
          <div key={slot} style={s.row}>
            <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: '#f1f5f9' }}>{slot}</span>
            <button style={{ ...s.btn, ...s.btnDanger, padding: '4px 10px' }} onClick={() => removeSlot(slot)}>✕</button>
          </div>
        ))}
        {slots.length === 0 && <p style={{ color: '#64748b', fontSize: 13 }}>Aucun créneau — ajoutez-en ci-dessous.</p>}
      </div>

      <div style={s.row}>
        <input
          type="time"
          value={newSlot}
          onChange={e => setNewSlot(e.target.value)}
          style={{ ...s.input, width: 140 }}
          onKeyDown={e => e.key === 'Enter' && addSlot()}
        />
        <button style={{ ...s.btn, ...s.btnGhost }} onClick={addSlot}>+ Ajouter</button>
      </div>

      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center' }}>
        <button style={{ ...s.btn, ...s.btnPrimary }} onClick={handleSave}>💾 Enregistrer les créneaux</button>
        {saved && <span style={s.saved}>✓ Enregistré</span>}
      </div>
    </div>
  )
}

// --------------- Tab: Vols & tarifs ---------------

function TabFlights({ settings, saveSettings }) {
  const [types, setTypes] = useState(settings.flight_types.map(f => ({ ...f })))
  const [saved, setSaved] = useState(false)
  const [newFlight, setNewFlight] = useState({
    id: '', label: '', duration_min: 20, price_eur: 90, min_age: 6, max_age: '', max_weight_kg: 100,
  })
  const [showAdd, setShowAdd] = useState(false)

  function updateType(id, field, value) {
    setTypes(prev => prev.map(f => f.id === id ? { ...f, [field]: value } : f))
  }

  function removeType(id) {
    setTypes(prev => prev.filter(f => f.id !== id))
  }

  async function handleSave() {
    // Parse numeric fields
    const cleaned = types.map(f => ({
      ...f,
      duration_min:  parseInt(f.duration_min) || 20,
      price_eur:     parseFloat(f.price_eur)  || 0,
      min_age:       parseInt(f.min_age)      || 0,
      max_age:       f.max_age === '' || f.max_age === null ? null : parseInt(f.max_age),
      max_weight_kg: parseInt(f.max_weight_kg) || 100,
    }))
    const ok = await saveSettings({ flight_types: cleaned })
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
  }

  function addFlight() {
    const id = newFlight.id.trim().toLowerCase().replace(/\s+/g, '_')
    if (!id || !newFlight.label.trim()) return
    if (types.find(f => f.id === id)) return // duplicate id
    setTypes(prev => [...prev, {
      ...newFlight,
      id,
      duration_min:  parseInt(newFlight.duration_min) || 20,
      price_eur:     parseFloat(newFlight.price_eur)  || 90,
      min_age:       parseInt(newFlight.min_age)      || 0,
      max_age:       newFlight.max_age === '' ? null : parseInt(newFlight.max_age),
      max_weight_kg: parseInt(newFlight.max_weight_kg) || 100,
    }])
    setNewFlight({ id: '', label: '', duration_min: 20, price_eur: 90, min_age: 6, max_age: '', max_weight_kg: 100 })
    setShowAdd(false)
  }

  return (
    <div>
      <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 0 }}>
        Modifiez les types de vols, leurs prix et leurs limites d'âge. Le <strong style={{ color: '#f1f5f9' }}>max. âge</strong> définit le tarif enfant (laisser vide = aucune limite).
      </p>

      {types.map(f => (
        <div key={f.id} style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: '#475569', fontFamily: 'monospace' }}>id: {f.id}</span>
            <button style={{ ...s.btn, ...s.btnDanger, padding: '3px 10px', fontSize: 12 }} onClick={() => removeType(f.id)}>Supprimer</button>
          </div>

          <div style={s.flightGrid}>
            <div>
              <label style={{ ...s.label, marginBottom: 4 }}>Intitulé</label>
              <input style={s.input} value={f.label}
                onChange={e => updateType(f.id, 'label', e.target.value)} />
            </div>
            <div>
              <label style={{ ...s.label, marginBottom: 4 }}>Durée (min)</label>
              <input style={s.input} type="number" min="5" value={f.duration_min}
                onChange={e => updateType(f.id, 'duration_min', e.target.value)} />
            </div>
            <div>
              <label style={{ ...s.label, marginBottom: 4 }}>Prix (€)</label>
              <input style={s.input} type="number" min="0" step="5" value={f.price_eur}
                onChange={e => updateType(f.id, 'price_eur', e.target.value)} />
            </div>
            <div>
              <label style={{ ...s.label, marginBottom: 4 }}>Âge min.</label>
              <input style={s.input} type="number" min="0" value={f.min_age}
                onChange={e => updateType(f.id, 'min_age', e.target.value)} />
            </div>
            <div>
              <label style={{ ...s.label, marginBottom: 4 }}>Âge max. (optionnel)</label>
              <input style={s.input} type="number" min="0" placeholder="aucune limite"
                value={f.max_age === null ? '' : f.max_age}
                onChange={e => updateType(f.id, 'max_age', e.target.value)} />
            </div>
            <div>
              <label style={{ ...s.label, marginBottom: 4 }}>Poids max. (kg)</label>
              <input style={s.input} type="number" min="0" value={f.max_weight_kg}
                onChange={e => updateType(f.id, 'max_weight_kg', e.target.value)} />
            </div>
          </div>
        </div>
      ))}

      {/* Add new flight type */}
      {!showAdd
        ? <button style={{ ...s.btn, ...s.btnGhost, marginBottom: 20 }} onClick={() => setShowAdd(true)}>+ Ajouter un type de vol</button>
        : (
          <div style={{ ...s.card, borderColor: '#1d4ed8' }}>
            <p style={{ ...s.cardTitle, color: '#93c5fd' }}>Nouveau type de vol</p>
            <div style={s.flightGrid}>
              <div>
                <label style={{ ...s.label, marginBottom: 4 }}>ID (clé interne)</label>
                <input style={s.input} placeholder="ex: grand_vol" value={newFlight.id}
                  onChange={e => setNewFlight(p => ({ ...p, id: e.target.value }))} />
                <p style={s.warn}>Minuscules, sans espaces. Non modifiable après.</p>
              </div>
              <div>
                <label style={{ ...s.label, marginBottom: 4 }}>Intitulé affiché</label>
                <input style={s.input} placeholder="ex: Grand vol" value={newFlight.label}
                  onChange={e => setNewFlight(p => ({ ...p, label: e.target.value }))} />
              </div>
              <div>
                <label style={{ ...s.label, marginBottom: 4 }}>Durée (min)</label>
                <input style={s.input} type="number" value={newFlight.duration_min}
                  onChange={e => setNewFlight(p => ({ ...p, duration_min: e.target.value }))} />
              </div>
              <div>
                <label style={{ ...s.label, marginBottom: 4 }}>Prix (€)</label>
                <input style={s.input} type="number" value={newFlight.price_eur}
                  onChange={e => setNewFlight(p => ({ ...p, price_eur: e.target.value }))} />
              </div>
              <div>
                <label style={{ ...s.label, marginBottom: 4 }}>Âge min.</label>
                <input style={s.input} type="number" value={newFlight.min_age}
                  onChange={e => setNewFlight(p => ({ ...p, min_age: e.target.value }))} />
              </div>
              <div>
                <label style={{ ...s.label, marginBottom: 4 }}>Âge max. (optionnel)</label>
                <input style={s.input} type="number" placeholder="aucune limite" value={newFlight.max_age}
                  onChange={e => setNewFlight(p => ({ ...p, max_age: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...s.btn, ...s.btnSuccess }} onClick={addFlight}>✓ Ajouter</button>
              <button style={{ ...s.btn, ...s.btnGhost }} onClick={() => setShowAdd(false)}>Annuler</button>
            </div>
          </div>
        )
      }

      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center' }}>
        <button style={{ ...s.btn, ...s.btnPrimary }} onClick={handleSave}>💾 Enregistrer les vols</button>
        {saved && <span style={s.saved}>✓ Enregistré</span>}
      </div>
    </div>
  )
}

// --------------- Tab: Apparence ---------------

const COLOR_FIELDS = [
  { key: 'color_bg',             label: 'Fond de page' },
  { key: 'color_card',           label: 'Fond des cartes' },
  { key: 'color_input',          label: 'Fond des champs' },
  { key: 'color_border',         label: 'Bordures' },
  { key: 'color_text',           label: 'Texte principal' },
  { key: 'color_text_secondary', label: 'Texte secondaire' },
  { key: 'color_accent',         label: 'Couleur d\'accent' },
  { key: 'color_btn_bg',         label: 'Boutons — fond' },
  { key: 'color_btn_text',       label: 'Boutons — texte' },
]

function TabAppearance({ settings, saveSettings }) {
  const [colors,      setColors]      = useState(Object.fromEntries(COLOR_FIELDS.map(f => [f.key, settings[f.key]])))
  const [schoolName,  setSchoolName]  = useState(settings.school_name)
  const [schoolLoc,   setSchoolLoc]   = useState(settings.school_location)
  const [saved,       setSaved]       = useState(false)

  function updateColor(key, val) {
    setColors(prev => ({ ...prev, [key]: val }))
    // Live preview
    const cssVar = '--' + key.replace(/_/g, '-')
    document.documentElement.style.setProperty(cssVar, val)
  }

  async function handleSave() {
    const ok = await saveSettings({ ...colors, school_name: schoolName, school_location: schoolLoc })
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
  }

  return (
    <div>
      {/* School identity */}
      <div style={s.card}>
        <p style={s.cardTitle}>Identité de l'école</p>
        <div style={{ marginBottom: 12 }}>
          <label style={s.label}>Nom de l'école</label>
          <input style={s.input} value={schoolName} onChange={e => setSchoolName(e.target.value)} placeholder="Planete Parapente" />
        </div>
        <div>
          <label style={s.label}>Lieu</label>
          <input style={s.input} value={schoolLoc} onChange={e => setSchoolLoc(e.target.value)} placeholder="Saint-Leu" />
        </div>
      </div>

      {/* Color palette */}
      <div style={s.card}>
        <p style={s.cardTitle}>Palette de couleurs</p>
        <p style={{ color: '#64748b', fontSize: 13, marginTop: -4, marginBottom: 16 }}>
          Les couleurs s'appliquent en temps réel — enregistrez pour les conserver.
        </p>
        {COLOR_FIELDS.map(({ key, label }) => (
          <div key={key} style={s.colorRow}>
            <div style={{ ...s.swatch, background: colors[key] }} />
            <span style={s.colorLabel}>{label}</span>
            <input
              type="color"
              value={colors[key]}
              onChange={e => updateColor(key, e.target.value)}
              style={s.colorInput}
              title={colors[key]}
            />
            <span style={{ fontSize: 12, color: '#475569', fontFamily: 'monospace', width: 72 }}>{colors[key]}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button style={{ ...s.btn, ...s.btnPrimary }} onClick={handleSave}>💾 Enregistrer l'apparence</button>
        {saved && <span style={s.saved}>✓ Enregistré</span>}
      </div>
    </div>
  )
}

// --------------- Main component ---------------

const TABS = [
  { id: 'slots',      label: '🕐 Créneaux' },
  { id: 'flights',    label: '🪂 Vols & tarifs' },
  { id: 'appearance', label: '🎨 Apparence' },
]

export default function Settings({ onBack }) {
  const { settings, saveSettings } = useSettings()
  const [activeTab, setActiveTab] = useState('slots')

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', padding: '0 4px 12px' }}
          aria-label="Retour"
        >←</button>
        <div style={{ paddingBottom: 12 }}>
          <h1 style={s.title}>⚙️ Paramètres</h1>
          <p style={s.subtitle}>Personnalisez votre application</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        {TABS.map(t => (
          <button
            key={t.id}
            style={{ ...s.tab, ...(activeTab === t.id ? s.tabActive : {}) }}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={s.body}>
        {activeTab === 'slots'      && <TabSlots      settings={settings} saveSettings={saveSettings} />}
        {activeTab === 'flights'    && <TabFlights    settings={settings} saveSettings={saveSettings} />}
        {activeTab === 'appearance' && <TabAppearance settings={settings} saveSettings={saveSettings} />}
      </div>
    </div>
  )
}
