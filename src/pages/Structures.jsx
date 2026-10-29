// Monthly recap of the flights done for partner structures / colleagues.
// Data is read only for the logged-in pilot (filtered on pilot_id) — never public.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const MEDIA_LABELS = { pack_photo: '📷 Photo', pack_photo_video: '🎬 Photo+vidéo' }

const monthKey = d => d.slice(0, 7) // 'YYYY-MM'
function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}
const normName = n => (n || '').trim().toLowerCase()

// Per-device rate memory (what the structure pays per flight type)
function readRate(structure, typeId) {
  try { return localStorage.getItem(`rate:${normName(structure)}:${typeId}`) || '' } catch { return '' }
}
function writeRate(structure, typeId, v) {
  try { localStorage.setItem(`rate:${normName(structure)}:${typeId}`, v) } catch { /* ignore */ }
}

export default function Structures({ pilot, flightTypes }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [open, setOpen] = useState(null)
  const [, force] = useState(0) // re-render when a rate changes

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('bookings')
        .select('id, booking_ref, contact_name, flight_date, closure_data, pilot_slots ( slot_date )')
        .eq('pilot_id', pilot.id)
        .like('booking_ref', 'COL-%')
        .not('closure_data', 'is', null)
        .limit(500)
      if (!alive) return
      if (err) setError(err.message)
      else setRows(data || [])
      setLoading(false)
    })()
    return () => { alive = false }
  }, [pilot?.id])

  const typeLabel = id => flightTypes.find(t => t.id === id)?.label || id

  // Flights of the selected month, grouped by structure
  const groups = useMemo(() => {
    const map = new Map()
    for (const b of rows) {
      const date = b.pilot_slots?.slot_date || b.flight_date || ''
      if (!date || monthKey(date) !== month) continue
      const key = normName(b.contact_name)
      if (!map.has(key)) map.set(key, { name: b.contact_name || '—', flights: [] })
      for (const f of b.closure_data?.pilot_flights || []) {
        if (!f.flight_type_id) continue
        map.get(key).flights.push({ ...f, date })
      }
    }
    return [...map.values()]
      .filter(g => g.flights.length)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, month])

  return (
    <div style={{ padding: '16px 14px', color: '#e2e8f0' }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>🤝 Structures</h2>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <button onClick={() => setMonth(m => shiftMonth(m, -1))} style={navBtn}>‹</button>
        <strong style={{ textTransform: 'capitalize' }}>{monthLabel(month)}</strong>
        <button onClick={() => setMonth(m => shiftMonth(m, 1))} style={navBtn}>›</button>
      </div>

      {loading && <div style={{ color: '#64748b' }}>Chargement…</div>}
      {error && <div style={{ color: '#f87171' }}>Erreur : {error}</div>}
      {!loading && !error && groups.length === 0 && (
        <div style={{ color: '#64748b' }}>Aucun vol clôturé pour une structure ce mois-ci.</div>
      )}

      {groups.map(g => {
        // Count per flight type + media packs
        const byType = {}
        const byMedia = {}
        for (const f of g.flights) {
          byType[f.flight_type_id] = (byType[f.flight_type_id] || 0) + 1
          if (f.media_pack && f.media_pack !== 'none') byMedia[f.media_pack] = (byMedia[f.media_pack] || 0) + 1
        }
        const total = Object.entries(byType).reduce(
          (s, [id, n]) => s + n * (parseFloat(readRate(g.name, id).replace(',', '.')) || 0), 0)
        const isOpen = open === normName(g.name)
        return (
          <div key={g.name} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong style={{ fontSize: 16 }}>{g.name}</strong>
              <span style={{ color: '#7dd3fc', fontWeight: 700 }}>
                {g.flights.length} vol{g.flights.length > 1 ? 's' : ''}
              </span>
            </div>

            {/* Rate per flight type → amount earned */}
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.entries(byType).map(([id, n]) => (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ flex: 1 }}>{n} × {typeLabel(id)}</span>
                  <input type="text" inputMode="decimal" placeholder="€ / vol"
                    defaultValue={readRate(g.name, id)}
                    onChange={e => { writeRate(g.name, id, e.target.value); force(x => x + 1) }}
                    style={rateInput} />
                </div>
              ))}
              {Object.entries(byMedia).map(([id, n]) => (
                <div key={id} style={{ fontSize: 12, color: '#fbbf24' }}>{n} × {MEDIA_LABELS[id] || id}</div>
              ))}
            </div>

            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#64748b' }}>Tarifs mémorisés sur cet appareil</span>
              <strong style={{ fontSize: 16, color: '#4ade80' }}>{total ? `${total.toFixed(2).replace('.00', '')} €` : '—'}</strong>
            </div>

            <button onClick={() => setOpen(isOpen ? null : normName(g.name))} style={{ ...navBtn, width: '100%', marginTop: 10, fontSize: 12 }}>
              {isOpen ? 'Masquer le détail' : 'Voir le détail des vols'}
            </button>

            {isOpen && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[...g.flights].sort((a, b) => a.date.localeCompare(b.date)).map((f, i) => (
                  <div key={f.id || i} style={{ fontSize: 12, color: '#94a3b8', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span>{new Date(f.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                    <span style={{ color: '#e2e8f0' }}>{typeLabel(f.flight_type_id)}</span>
                    {f.pilot_name && <span>🧑‍✈️ {f.pilot_name}</span>}
                    {f.note && <span>📝 {f.note}</span>}
                    {f.media_pack && f.media_pack !== 'none' && <span>{MEDIA_LABELS[f.media_pack]}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const navBtn = { background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 16 }
const card = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 14, marginBottom: 12 }
const rateInput = { width: 80, background: '#1e293b', border: '1px solid #334155', borderRadius: 7, padding: '6px 8px', color: '#e2e8f0', fontFamily: 'inherit', fontSize: 13, textAlign: 'right' }
