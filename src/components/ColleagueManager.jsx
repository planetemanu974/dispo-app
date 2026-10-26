// ColleagueManager.jsx — Manage the pilot's personal list of colleague pilots.
// Embedded inside the Settings page. Add / remove colleagues (name + phone).
// No app account required for colleagues — they respond via SMS link.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function ColleagueManager({ pilot }) {
  const [colleagues, setColleagues] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [adding,     setAdding]     = useState(false)
  const [form,       setForm]       = useState({ name: '', phone: '', notes: '' })
  const [saving,     setSaving]     = useState(false)

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('colleagues')
      .select('*')
      .eq('pilot_id', pilot.id)
      .order('name')
    setColleagues(data || [])
    setLoading(false)
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.phone.trim()) return
    setSaving(true)
    const { error } = await supabase.from('colleagues').insert({
      pilot_id: pilot.id,
      name:     form.name.trim(),
      phone:    form.phone.trim(),
      notes:    form.notes.trim(),
    })
    if (!error) {
      setForm({ name: '', phone: '', notes: '' })
      setAdding(false)
      load()
    }
    setSaving(false)
  }

  async function handleDelete(id, name) {
    if (!window.confirm(`Supprimer ${name} de votre liste ?`)) return
    await supabase.from('colleagues').delete().eq('id', id)
    setColleagues(prev => prev.filter(c => c.id !== id))
  }

  const inputStyle = {
    width: '100%', padding: '9px 12px', background: '#0f172a', border: '1px solid #334155',
    borderRadius: 8, color: '#e2e8f0', fontSize: '0.88rem', boxSizing: 'border-box',
  }
  const labelStyle = { display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: 4 }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#e2e8f0', fontWeight: 700 }}>
          👥 Mes collègues
        </h3>
        {!adding && (
          <button onClick={() => setAdding(true)}
            style={{ padding: '6px 14px', background: '#1d4ed8', border: 'none', borderRadius: 8, color: 'white', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 600 }}>
            + Ajouter
          </button>
        )}
      </div>

      {/* Add form */}
      {adding && (
        <form onSubmit={handleAdd}
          style={{ background: '#0f172a', borderRadius: 10, padding: '14px', marginBottom: 14, border: '1px solid #334155' }}>
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Prénom / Nom</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Pierre Martin" required style={inputStyle} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Téléphone</label>
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="0692 XX XX XX" type="tel" required style={inputStyle} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Note (optionnel)</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="ex : biplace lourd OK, disponible matin" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={saving}
              style={{ flex: 1, padding: '9px', background: '#16a34a', border: 'none', borderRadius: 8, color: 'white', fontSize: '0.88rem', fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Enregistrement…' : '✓ Enregistrer'}
            </button>
            <button type="button" onClick={() => { setAdding(false); setForm({ name: '', phone: '', notes: '' }) }}
              style={{ padding: '9px 14px', background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: '0.88rem', cursor: 'pointer' }}>
              Annuler
            </button>
          </div>
        </form>
      )}

      {/* List */}
      {loading && <div style={{ color: '#64748b', fontSize: '0.85rem', padding: '8px 0' }}>Chargement…</div>}
      {!loading && colleagues.length === 0 && !adding && (
        <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '8px 0' }}>
          Aucun collègue enregistré. Ajoutez-en pour pouvoir les appeler en renfort.
        </p>
      )}
      {colleagues.map(c => (
        <div key={c.id} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px', borderRadius: 8, background: '#0f172a',
          marginBottom: 8, border: '1px solid #1e293b',
        }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#1e3a5f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>
            🧑‍✈️
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#e2e8f0' }}>{c.name}</div>
            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{c.phone}</div>
            {c.notes && <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: 1 }}>{c.notes}</div>}
          </div>
          <button onClick={() => handleDelete(c.id, c.name)}
            style={{ background: 'none', border: 'none', color: '#475569', fontSize: '18px', cursor: 'pointer', padding: 4, flexShrink: 0 }}
            title="Supprimer">🗑️</button>
        </div>
      ))}
    </div>
  )
}
