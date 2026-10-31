/**
 * StructuresCompta.jsx — « Structures » tab of the accounting page.
 * Flights flown for other structures (closed with « Clôturer »), per month and per structure:
 *   • prices per flight (type + media pack), saved in the database
 *   • paid / unpaid checkbox per flight (« tout marquer payé »)
 *   • monthly invoice (PDF) + sending by e-mail
 * Private: every query is filtered on the signed-in pilot (RLS).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { generateInvoice, invoiceFilename } from '../lib/invoice'

const MEDIA_LABELS = { pack_photo: 'Photo', pack_photo_video: 'Photo+vidéo' }
const normName = n => (n || '').trim().toLowerCase()
const monthKey = d => d.slice(0, 7)
const eur = n => `${(Math.round(n * 100) / 100).toString().replace('.', ',')} €`

function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function StructuresCompta({ pilot, flightTypes }) {
  const [rows, setRows]         = useState([])        // partner bookings with closure_data
  const [rates, setRates]       = useState({})        // `${structKey}::${flightKey}` → price
  const [paid, setPaid]         = useState(new Set()) // `${bookingId}::${flightKey}`
  const [invoices, setInvoices] = useState({})        // `${structKey}|${month}` → invoice row
  const [emails, setEmails]     = useState({})        // structKey → email
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [month, setMonth]       = useState(() => todayStr().slice(0, 7))
  const [open, setOpen]         = useState(null)
  const [busy, setBusy]         = useState(null)

  const typeLabel = id => flightTypes.find(t => t.id === id)?.label || id

  const load = useCallback(async () => {
    if (!pilot?.id) return
    setLoading(true); setError(null)
    try {
      const [b, r, p, inv, col] = await Promise.all([
        supabase.from('bookings')
          .select('id, booking_ref, contact_name, paid_at, closure_data, pilot_slots!inner ( slot_date, pilot_id )')
          .eq('pilot_slots.pilot_id', pilot.id).like('booking_ref', 'COL-%').not('closure_data', 'is', null).limit(1000),
        supabase.from('structure_rates').select('*').eq('pilot_id', pilot.id),
        supabase.from('structure_flight_payments').select('booking_id, flight_key').eq('pilot_id', pilot.id),
        supabase.from('structure_invoices').select('*').eq('pilot_id', pilot.id),
        supabase.from('colleagues').select('name, email, is_direct').eq('pilot_id', pilot.id),
      ])
      if (b.error) throw b.error
      setRows(b.data || [])
      // The three new tables exist only once migration 028 has been applied
      if (r.error || p.error || inv.error) setError("Il manque la mise à jour de la base (migration 028). Les tarifs et paiements ne seront pas enregistrés.")
      setRates(Object.fromEntries((r.data || []).map(x => [`${x.structure_key}::${x.flight_key}`, Number(x.price_eur)])))
      setPaid(new Set((p.data || []).map(x => `${x.booking_id}::${x.flight_key}`)))
      setInvoices(Object.fromEntries((inv.data || []).map(x => [`${x.structure_key}|${x.month}`, x])))
      setEmails(Object.fromEntries((col.data || []).filter(c => !c.is_direct).map(c => [normName(c.name), c.email || ''])))
    } catch (e) {
      setError('Chargement impossible : ' + (e.message || e))
    } finally {
      setLoading(false)
    }
  }, [pilot?.id])

  useEffect(() => { load() }, [load])

  // Flights of the month, grouped by structure
  const groups = useMemo(() => {
    const map = new Map()
    for (const bk of rows) {
      const date = bk.pilot_slots?.slot_date || bk.paid_at?.slice(0, 10) || ''
      if (!date || monthKey(date) !== month) continue
      const key = normName(bk.contact_name)
      if (!map.has(key)) map.set(key, { key, name: bk.contact_name || '—', flights: [] })
      ;(bk.closure_data?.pilot_flights || []).forEach((f, i) => {
        if (!f.flight_type_id) return
        const media = f.media_pack && f.media_pack !== 'none' ? f.media_pack : 'none'
        map.get(key).flights.push({
          ...f, date, booking_id: bk.id, flight_key: f.id || `i${i}`, media,
          price_key: `${f.flight_type_id}|${media}`,
        })
      })
    }
    return [...map.values()].filter(g => g.flights.length).sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, month])

  const priceOf = (structKey, f) => rates[`${structKey}::${f.price_key}`] || 0
  const isPaid  = f => paid.has(`${f.booking_id}::${f.flight_key}`)
  const lineLabel = f => `${typeLabel(f.flight_type_id)}${f.media !== 'none' ? ' + ' + MEDIA_LABELS[f.media] : ''}`

  // ── Actions ────────────────────────────────────────────────────────────────
  async function saveRate(structKey, priceKey, text) {
    const v = parseFloat(String(text).replace(',', '.'))
    const price = Number.isFinite(v) ? v : 0
    setRates(r => ({ ...r, [`${structKey}::${priceKey}`]: price }))
    const { error: e } = await supabase.from('structure_rates')
      .upsert({ pilot_id: pilot.id, structure_key: structKey, flight_key: priceKey, price_eur: price, updated_at: new Date().toISOString() },
        { onConflict: 'pilot_id,structure_key,flight_key' })
    if (e) setError('Tarif non enregistré : ' + e.message)
  }

  async function setFlightsPaid(flights, value) {
    setPaid(prev => {
      const n = new Set(prev)
      flights.forEach(f => value ? n.add(`${f.booking_id}::${f.flight_key}`) : n.delete(`${f.booking_id}::${f.flight_key}`))
      return n
    })
    if (value) {
      const { error: e } = await supabase.from('structure_flight_payments')
        .upsert(flights.map(f => ({ pilot_id: pilot.id, booking_id: f.booking_id, flight_key: f.flight_key })), { onConflict: 'booking_id,flight_key' })
      if (e) { setError('Paiement non enregistré : ' + e.message); load() }
    } else {
      for (const f of flights) {
        await supabase.from('structure_flight_payments').delete().eq('booking_id', f.booking_id).eq('flight_key', f.flight_key)
      }
    }
  }

  async function saveEmail(g, value) {
    const email = value.trim()
    setEmails(m => ({ ...m, [g.key]: email }))
    const { data: cols } = await supabase.from('colleagues').select('id, name, is_direct').eq('pilot_id', pilot.id)
    const col = (cols || []).find(c => !c.is_direct && normName(c.name) === g.key)
    if (col) await supabase.from('colleagues').update({ email }).eq('id', col.id)
  }

  // Build (or rebuild) the month's invoice PDF. The invoice number is created once per structure and month.
  async function buildInvoice(g) {
    let inv = invoices[`${g.key}|${month}`]
    const total = g.flights.reduce((s, f) => s + priceOf(g.key, f), 0)
    if (!inv) {
      const [yy, mm] = [month.slice(2, 4), month.slice(5, 7)]
      const prefix = `STR-${yy}${mm}-`
      const { data: same } = await supabase.from('structure_invoices').select('invoice_number')
        .eq('pilot_id', pilot.id).like('invoice_number', `${prefix}%`)
      const seq = (same || []).reduce((m, x) => Math.max(m, parseInt(x.invoice_number.slice(prefix.length), 10) || 0), 0) + 1
      const row = { pilot_id: pilot.id, structure_key: g.key, structure_name: g.name, month, invoice_number: `${prefix}${String(seq).padStart(2, '0')}`, total_eur: total }
      const { data, error: e } = await supabase.from('structure_invoices').insert(row).select().single()
      if (e) throw e
      inv = data
      setInvoices(m => ({ ...m, [`${g.key}|${month}`]: inv }))
    } else if (Number(inv.total_eur) !== total) {
      await supabase.from('structure_invoices').update({ total_eur: total }).eq('id', inv.id)
    }
    const lines = [...g.flights].sort((a, b) => a.date.localeCompare(b.date)).map(f => ({
      label: `${new Date(f.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} · ${lineLabel(f)}${f.note ? ' (' + f.note + ')' : ''}`,
      priceEur: priceOf(g.key, f),
    }))
    const doc = generateInvoice({ invoiceNumber: inv.invoice_number, date: todayStr(), clientName: g.name, lines })
    return { doc, number: inv.invoice_number, total }
  }

  const missingRates = g => g.flights.some(f => !priceOf(g.key, f))

  async function handleInvoice(g, thenMail) {
    if (missingRates(g)) { alert('Renseignez d\'abord le tarif de chaque type de vol pour cette structure.'); return }
    setBusy(g.key)
    try {
      const { doc, number, total } = await buildInvoice(g)
      const filename = invoiceFilename(number)
      if (!thenMail) { doc.save(filename); return }

      const subject = `Facture ${number} — vols ${monthLabel(month)}`
      const body = `Bonjour,\n\nVeuillez trouver ci-joint la facture ${number} pour les vols de ${monthLabel(month)} (${g.flights.length} vol${g.flights.length > 1 ? 's' : ''}, total ${eur(total)}).\n\nCordialement,\n${pilot.name || ''}`
      const file = new File([doc.output('blob')], filename, { type: 'application/pdf' })
      // Phones: share sheet with the PDF attached (choose Gmail / Mail). Computers: download + open the mail draft.
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: subject, text: body }) } catch { /* cancelled */ }
      } else {
        doc.save(filename)
        const to = emails[g.key] || ''
        window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + '\n\n(Pensez à joindre le PDF téléchargé.)')}`
      }
    } catch (e) {
      alert('Facture impossible : ' + (e.message || e))
    } finally {
      setBusy(null)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const monthTotals = groups.reduce((acc, g) => {
    g.flights.forEach(f => { const p = priceOf(g.key, f); acc.due += p; if (isPaid(f)) acc.paid += p })
    return acc
  }, { due: 0, paid: 0 })

  return (
    <div style={{ padding: '4px 14px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0 12px' }}>
        <button onClick={() => setMonth(m => shiftMonth(m, -1))} style={navBtn}>‹</button>
        <strong style={{ textTransform: 'capitalize' }}>{monthLabel(month)}</strong>
        <button onClick={() => setMonth(m => shiftMonth(m, 1))} style={navBtn}>›</button>
      </div>

      {loading && <div style={{ color: '#64748b', textAlign: 'center', padding: 30 }}>⏳ Chargement…</div>}
      {error && <div style={{ color: '#fca5a5', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {!loading && groups.length === 0 && (
        <div style={{ color: '#64748b', textAlign: 'center', padding: '40px 10px', fontSize: 13 }}>
          Aucun vol clôturé pour une structure ce mois-ci.<br />
          <span style={{ fontSize: 11, color: '#475569' }}>Ils apparaissent ici dès que tu clôtures un vol fait pour une structure.</span>
        </div>
      )}

      {groups.length > 0 && (
        <div style={{ ...card, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span>À encaisser : <b>{eur(monthTotals.due)}</b></span>
          <span style={{ color: '#4ade80' }}>Payé : <b>{eur(monthTotals.paid)}</b></span>
          <span style={{ color: monthTotals.due - monthTotals.paid > 0 ? '#fbbf24' : '#64748b' }}>Reste : <b>{eur(monthTotals.due - monthTotals.paid)}</b></span>
        </div>
      )}

      {groups.map(g => {
        // One line per (flight type + media pack): « 3 × Performance + Photo+vidéo » with a single price
        const lines = new Map()
        g.flights.forEach(f => {
          if (!lines.has(f.price_key)) lines.set(f.price_key, { key: f.price_key, label: lineLabel(f), n: 0 })
          lines.get(f.price_key).n++
        })
        const due = g.flights.reduce((s, f) => s + priceOf(g.key, f), 0)
        const got = g.flights.filter(isPaid).reduce((s, f) => s + priceOf(g.key, f), 0)
        const unpaid = g.flights.filter(f => !isPaid(f))
        const inv = invoices[`${g.key}|${month}`]
        const isOpen = open === g.key
        return (
          <div key={g.key} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong style={{ fontSize: 16 }}>{g.name}</strong>
              <span style={{ color: '#7dd3fc', fontWeight: 700 }}>{g.flights.length} vol{g.flights.length > 1 ? 's' : ''}</span>
            </div>

            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[...lines.values()].map(l => (
                <div key={l.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ flex: 1 }}>{l.n} × {l.label}</span>
                  <input type="text" inputMode="decimal" placeholder="€ / vol"
                    defaultValue={rates[`${g.key}::${l.key}`] || ''}
                    onBlur={e => saveRate(g.key, l.key, e.target.value)}
                    style={rateInput} />
                </div>
              ))}
            </div>

            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
              <span style={{ color: '#4ade80' }}>Payé {eur(got)}</span>
              <strong style={{ fontSize: 16, color: due - got > 0 ? '#fbbf24' : '#4ade80' }}>
                {due ? (due - got > 0 ? `Reste ${eur(due - got)}` : '✓ Tout est payé') : '—'}
              </strong>
            </div>

            <button onClick={() => setOpen(isOpen ? null : g.key)} style={{ ...navBtn, width: '100%', marginTop: 10, fontSize: 12 }}>
              {isOpen ? 'Masquer le détail' : 'Voir les vols et les paiements'}
            </button>

            {isOpen && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[...g.flights].sort((a, b) => a.date.localeCompare(b.date)).map(f => (
                  <label key={`${f.booking_id}${f.flight_key}`} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                    <input type="checkbox" checked={isPaid(f)} onChange={e => setFlightsPaid([f], e.target.checked)} />
                    <span style={{ color: '#94a3b8', width: 52 }}>{new Date(f.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                    <span style={{ flex: 1, color: isPaid(f) ? '#64748b' : '#e2e8f0' }}>{lineLabel(f)}{f.pilot_name ? ` · 🧑‍✈️ ${f.pilot_name}` : ''}{f.note ? ` · ${f.note}` : ''}</span>
                    <span style={{ color: isPaid(f) ? '#4ade80' : '#94a3b8' }}>{priceOf(g.key, f) ? eur(priceOf(g.key, f)) : ''}</span>
                  </label>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  {unpaid.length > 0
                    ? <button style={{ ...navBtn, flex: 1, fontSize: 12 }} onClick={() => setFlightsPaid(unpaid, true)}>✅ Tout marquer payé</button>
                    : <button style={{ ...navBtn, flex: 1, fontSize: 12 }} onClick={() => setFlightsPaid(g.flights, false)}>↩ Tout remettre « à payer »</button>}
                </div>
              </div>
            )}

            {/* Invoice */}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #1e293b' }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>
                🧾 Facture du mois {inv ? <span style={{ color: '#86efac' }}>· n° {inv.invoice_number}</span> : '· pas encore éditée'}
              </div>
              <input type="email" placeholder="E-mail de la structure (pour l'envoi)"
                defaultValue={emails[g.key] || ''} onBlur={e => saveEmail(g, e.target.value)} style={{ ...rateInput, width: '100%', textAlign: 'left', marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button disabled={busy === g.key} style={{ ...navBtn, flex: 1, fontSize: 13 }} onClick={() => handleInvoice(g, false)}>⬇ PDF</button>
                <button disabled={busy === g.key} style={{ ...navBtn, flex: 2, fontSize: 13, background: '#1d4ed8', borderColor: '#1d4ed8' }} onClick={() => handleInvoice(g, true)}>📧 Envoyer par mail</button>
              </div>
              {missingRates(g) && <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 6 }}>Renseigne le tarif de chaque ligne ci-dessus pour éditer la facture.</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const navBtn = { background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 16 }
const card = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 14, marginBottom: 12 }
const rateInput = { width: 80, background: '#1e293b', border: '1px solid #334155', borderRadius: 7, padding: '8px 8px', color: '#e2e8f0', fontFamily: 'inherit', fontSize: 14, textAlign: 'right', boxSizing: 'border-box' }
