/**
 * StructuresCompta.jsx — « Structures » tab of the accounting page.
 * Plain list of the flights flown for other structures, day by day:
 *   time · structure · flight type · media pack · price · « paid » checkbox.
 * Flights come straight from the planning (bookings), so deleting a flight there removes the line here.
 * Month-end: « Éditer une facture » (amounts typed by the pilot) and « Mes factures » (archive).
 * Private: every query is filtered on the signed-in pilot (RLS).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { generateInvoice, invoiceFilename } from '../lib/invoice'

const MEDIA_LABELS = { pack_photo: 'Photo', pack_photo_video: 'Photo+vidéo' }
const GONE = ['cancelled', 'canceled', 'refused', 'deleted']
const normName = n => (n || '').trim().toLowerCase()
const eur = n => `${(Math.round(n * 100) / 100).toString().replace('.', ',')} €`
const pad = n => String(n).padStart(2, '0')
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const shortTime = t => (t ? `${parseInt(t.slice(0, 2), 10)}h${t.slice(3, 5)}` : '')

function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
const monthLabel = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) }
const dayLabel = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

export default function StructuresCompta({ pilot, flightTypes, mode = 'list' }) {
  const [rows, setRows]         = useState([])
  const [rates, setRates]       = useState({})        // `${structKey}::${flightKey}` → price
  const [paid, setPaid]         = useState(new Set()) // `${bookingId}::${flightKey}`
  const [invoices, setInvoices] = useState([])
  const [emails, setEmails]     = useState({})
  const [allStructs, setAllStructs] = useState([])   // names of every partner structure
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [month, setMonth]       = useState(todayStr().slice(0, 7))
  const [view, setView]         = useState(mode === 'archive' ? 'archive' : 'list')  // 'list' | 'editor' | 'archive'
  const [busy, setBusy]         = useState(false)

  const typeLabel = id => flightTypes.find(t => t.id === id)?.label || id

  const load = useCallback(async () => {
    if (!pilot?.id) return
    setLoading(true); setError(null)
    try {
      const [b, r, p, inv, col] = await Promise.all([
        supabase.from('bookings')
          .select('id, status, contact_name, closure_data, pilot_slots!inner ( slot_date, slot_time, pilot_id )')
          .eq('pilot_slots.pilot_id', pilot.id).like('booking_ref', 'COL-%').not('closure_data', 'is', null).limit(1000),
        supabase.from('structure_rates').select('*').eq('pilot_id', pilot.id),
        supabase.from('structure_flight_payments').select('booking_id, flight_key').eq('pilot_id', pilot.id),
        supabase.from('structure_invoices').select('*').eq('pilot_id', pilot.id).order('created_at', { ascending: false }),
        supabase.from('colleagues').select('name, email, is_direct').eq('pilot_id', pilot.id),
      ])
      if (b.error) throw b.error
      setRows((b.data || []).filter(x => !GONE.includes(x.status)))
      if (r.error || p.error || inv.error) setError("Mise à jour de la base manquante (migrations 028 et 029) : tarifs, paiements et factures ne seront pas enregistrés.")
      setRates(Object.fromEntries((r.data || []).map(x => [`${x.structure_key}::${x.flight_key}`, Number(x.price_eur)])))
      setPaid(new Set((p.data || []).map(x => `${x.booking_id}::${x.flight_key}`)))
      setInvoices(inv.data || [])
      setAllStructs((col.data || []).filter(c => !c.is_direct).map(c => c.name))
      setEmails(Object.fromEntries((col.data || []).filter(c => !c.is_direct).map(c => [normName(c.name), c.email || ''])))
    } catch (e) {
      setError('Chargement impossible : ' + (e.message || e))
    } finally { setLoading(false) }
  }, [pilot?.id])
  useEffect(() => { load() }, [load])

  // All flights of the month, flat and sorted by date + time
  const flights = useMemo(() => {
    const out = []
    for (const bk of rows) {
      const date = bk.pilot_slots?.slot_date
      if (!date || date.slice(0, 7) !== month) continue
      const key = normName(bk.contact_name)
      ;(bk.closure_data?.pilot_flights || []).forEach((f, i) => {
        if (!f.flight_type_id) return
        const media = f.media_pack && f.media_pack !== 'none' ? f.media_pack : 'none'
        out.push({ ...f, date, time: bk.pilot_slots.slot_time || '', booking_id: bk.id, flight_key: f.id || `i${i}`,
          media, price_key: `${f.flight_type_id}|${media}`, structKey: key, structName: bk.contact_name || '—' })
      })
    }
    return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
  }, [rows, month])

  // Every flight (all months) — lets the invoice form prefill the sum for any month
  const allFlightsFor = useMemo(() => {
    const out = []
    for (const bk of rows) {
      const date = bk.pilot_slots?.slot_date
      if (!date) continue
      ;(bk.closure_data?.pilot_flights || []).forEach((f, i) => {
        if (!f.flight_type_id) return
        const media = f.media_pack && f.media_pack !== 'none' ? f.media_pack : 'none'
        out.push({ date, structKey: normName(bk.contact_name), structName: bk.contact_name || '—', price_key: `${f.flight_type_id}|${media}` })
      })
    }
    return out
  }, [rows])

  const priceOf = f => rates[`${f.structKey}::${f.price_key}`] || 0
  const isPaid  = f => paid.has(`${f.booking_id}::${f.flight_key}`)
  const mediaOf = f => (f.media !== 'none' ? MEDIA_LABELS[f.media] : '')
  const days = useMemo(() => {
    const m = new Map()
    flights.forEach(f => { if (!m.has(f.date)) m.set(f.date, []); m.get(f.date).push(f) })
    return [...m.entries()]
  }, [flights])

  const due = flights.reduce((s, f) => s + priceOf(f), 0)
  const got = flights.filter(isPaid).reduce((s, f) => s + priceOf(f), 0)

  async function savePrice(f, text) {
    const v = parseFloat(String(text).replace(',', '.'))
    const price = Number.isFinite(v) ? v : 0
    if (price === priceOf(f)) return
    // The price is kept per structure + flight type + pack: it applies to every identical flight
    setRates(r => ({ ...r, [`${f.structKey}::${f.price_key}`]: price }))
    const { error: e } = await supabase.from('structure_rates').upsert(
      { pilot_id: pilot.id, structure_key: f.structKey, flight_key: f.price_key, price_eur: price, updated_at: new Date().toISOString() },
      { onConflict: 'pilot_id,structure_key,flight_key' })
    if (e) setError('Prix non enregistré : ' + e.message)
  }

  async function togglePaid(f, value) {
    const k = `${f.booking_id}::${f.flight_key}`
    setPaid(prev => { const n = new Set(prev); value ? n.add(k) : n.delete(k); return n })
    const { error: e } = value
      ? await supabase.from('structure_flight_payments').upsert({ pilot_id: pilot.id, booking_id: f.booking_id, flight_key: f.flight_key }, { onConflict: 'booking_id,flight_key' })
      : await supabase.from('structure_flight_payments').delete().eq('booking_id', f.booking_id).eq('flight_key', f.flight_key)
    if (e) { setError('Paiement non enregistré : ' + e.message); load() }
  }

  // ── Invoice ────────────────────────────────────────────────────────────────
  // Creates (or updates) the month's invoice of a structure, then returns the PDF.
  async function saveInvoice({ structKey, structName, month, lines, email }) {
    const total = lines.reduce((s, l) => s + l.priceEur, 0)
    let inv = invoices.find(i => i.structure_key === structKey && i.month === month)
    if (inv) {
      const { data, error: e } = await supabase.from('structure_invoices').update({ lines, total_eur: total }).eq('id', inv.id).select().single()
      if (e) throw e
      inv = data
    } else {
      const prefix = `STR-${month.slice(2, 4)}${month.slice(5, 7)}-`
      const { data: same } = await supabase.from('structure_invoices').select('invoice_number').eq('pilot_id', pilot.id).like('invoice_number', `${prefix}%`)
      const seq = (same || []).reduce((m, x) => Math.max(m, parseInt(x.invoice_number.slice(prefix.length), 10) || 0), 0) + 1
      const { data, error: e } = await supabase.from('structure_invoices').insert({
        pilot_id: pilot.id, structure_key: structKey, structure_name: structName, month, invoice_number: `${prefix}${pad(seq)}`,
        total_eur: total, lines, invoice_date: todayStr(),
      }).select().single()
      if (e) throw e
      inv = data
    }
    if (email !== undefined && email !== (emails[structKey] || '')) {
      const { data: cols } = await supabase.from('colleagues').select('id, name, is_direct').eq('pilot_id', pilot.id)
      const col = (cols || []).find(c => !c.is_direct && normName(c.name) === structKey)
      if (col) await supabase.from('colleagues').update({ email }).eq('id', col.id)
      setEmails(m => ({ ...m, [structKey]: email }))
    }
    await load()
    return inv
  }

  function pdfOf(inv) {
    return generateInvoice({ invoiceNumber: inv.invoice_number, date: inv.invoice_date || todayStr(), clientName: inv.structure_name, lines: inv.lines })
  }

  // Phones: share sheet with the PDF attached. Computers: download + open a mail draft.
  async function sendByMail(inv, email) {
    const doc = pdfOf(inv)
    const filename = invoiceFilename(inv.invoice_number)
    const subject = `Facture ${inv.invoice_number} — vols ${monthLabel(inv.month)}`
    const body = `Bonjour,\n\nVeuillez trouver ci-joint la facture ${inv.invoice_number} (${monthLabel(inv.month)}), d'un montant de ${eur(Number(inv.total_eur))}.\n\nCordialement,\n${pilot.name || ''}`
    const file = new File([doc.output('blob')], filename, { type: 'application/pdf' })
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: subject, text: body }) } catch { /* cancelled */ }
    } else {
      doc.save(filename)
      window.location.href = `mailto:${encodeURIComponent(email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + '\n\n(Joindre le PDF téléchargé.)')}`
    }
  }

  // ── Views ──────────────────────────────────────────────────────────────────
  if (view === 'editor') {
    return <InvoiceEditor startMonth={month} flights={allFlightsFor} structNames={[...new Map([...allStructs, ...allFlightsFor.map(f => f.structName)].filter(Boolean).map(n => [normName(n), n])).values()].sort((a, b) => a.localeCompare(b))} priceOf={priceOf}
      emails={emails} invoices={invoices} busy={busy} onBack={() => setView('list')}
      onSubmit={async (payload, mail) => {
        setBusy(true)
        try {
          const inv = await saveInvoice(payload)
          if (mail) await sendByMail(inv, payload.email); else pdfOf(inv).save(invoiceFilename(inv.invoice_number))
          setView(mode === 'archive' ? 'archive' : 'list')
        } catch (e) { alert('Facture impossible : ' + (e.message || e)) } finally { setBusy(false) }
      }} />
  }

  if (view === 'archive') {
    const byMonth = new Map()
    invoices.forEach(i => { if (!byMonth.has(i.month)) byMonth.set(i.month, []); byMonth.get(i.month).push(i) })
    const ordered = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]))
    return (
      <div style={wrap}>
        {mode === 'archive'
          ? <button style={{ ...btn, width: '100%', marginBottom: 12, background: '#1d4ed8', borderColor: '#1d4ed8' }} onClick={() => setView('editor')}>🧾 Éditer une facture</button>
          : <button onClick={() => setView('list')} style={{ ...btn, marginBottom: 12 }}>← Retour</button>}
        <h3 style={{ margin: '0 0 12px' }}>Mes factures</h3>
        {ordered.length === 0 && <div style={empty}>Aucune facture éditée pour l'instant.</div>}
        {ordered.map(([m, list]) => (
          <div key={m} style={{ marginBottom: 14 }}>
            <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'capitalize', marginBottom: 6 }}>{monthLabel(m)}</div>
            {list.map(i => (
              <div key={i.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{i.structure_name}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>n° {i.invoice_number} · {eur(Number(i.total_eur))}</div>
                </div>
                <button style={btn} onClick={() => pdfOf(i).save(invoiceFilename(i.invoice_number))}>⬇</button>
                <button style={btn} onClick={() => sendByMail(i, emails[i.structure_key])}>📧</button>
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button style={{ ...btn, flex: 1, background: '#1d4ed8', borderColor: '#1d4ed8' }} onClick={() => setView('editor')}>🧾 Éditer une facture</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0 12px' }}>
        <button onClick={() => setMonth(m => shiftMonth(m, -1))} style={btn}>‹</button>
        <strong style={{ textTransform: 'capitalize' }}>{monthLabel(month)}</strong>
        <button onClick={() => setMonth(m => shiftMonth(m, 1))} style={btn}>›</button>
      </div>

      {error && <div style={{ color: '#fca5a5', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {loading && <div style={empty}>⏳ Chargement…</div>}
      {!loading && flights.length === 0 && <div style={empty}>Aucun vol clôturé pour une structure ce mois-ci.</div>}

      {flights.length > 0 && (
        <div style={{ ...card, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span>À encaisser : <b>{eur(due)}</b></span>
          <span style={{ color: '#4ade80' }}>Payé : <b>{eur(got)}</b></span>
          <span style={{ color: due - got > 0 ? '#fbbf24' : '#64748b' }}>Reste : <b>{eur(due - got)}</b></span>
        </div>
      )}

      {days.map(([date, list]) => (
        <div key={date} style={{ marginBottom: 12 }}>
          <div style={{ color: '#7dd3fc', fontSize: 13, fontWeight: 700, textTransform: 'capitalize', margin: '4px 0 6px' }}>{dayLabel(date)}</div>
          {list.map(f => (
            <div key={`${f.booking_id}${f.flight_key}`} style={{ ...card, padding: '10px 12px', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#94a3b8', fontSize: 13, width: 40 }}>{shortTime(f.time)}</span>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.structName}</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: isPaid(f) ? '#4ade80' : '#94a3b8', cursor: 'pointer' }}>
                  <input type="checkbox" checked={isPaid(f)} onChange={e => togglePaid(f, e.target.checked)} style={{ width: 20, height: 20 }} />
                  réglé
                </label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <span style={{ flex: 1, fontSize: 13, color: '#e2e8f0' }}>
                  {typeLabel(f.flight_type_id)}{mediaOf(f) ? <span style={{ color: '#a5b4fc' }}> · {mediaOf(f)}</span> : ''}
                </span>
                <input type="text" inputMode="decimal" placeholder="€" key={`${f.price_key}${priceOf(f)}`} defaultValue={priceOf(f) || ''}
                  onBlur={e => savePrice(f, e.target.value)} style={priceInput} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Invoice form: structure + month + one sum. Creates the PDF and can send it by mail. */
function InvoiceEditor({ startMonth, flights, structNames, priceOf, emails, invoices, busy, onBack, onSubmit }) {
  const [month, setMonth] = useState(startMonth)
  const [structName, setStructName] = useState(structNames[0] || '')
  const [email, setEmail] = useState('')
  const [sum, setSum] = useState('')
  const structKey = normName(structName)
  const existing = invoices.find(i => i.structure_key === structKey && i.month === month)

  // Sum suggested from the flights' prices (only a starting point, the pilot types the real amount)
  const mine = flights.filter(f => f.structKey === structKey && f.date.slice(0, 7) === month)
  const suggested = mine.reduce((s, f) => s + priceOf(f), 0)

  useEffect(() => {
    setEmail(emails[structKey] || '')
    setSum(existing ? String(existing.total_eur) : suggested ? String(suggested) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structKey, month])

  const amount = (() => { const n = parseFloat(String(sum).replace(',', '.')); return Number.isFinite(n) ? n : 0 })()
  const ready = structName && amount > 0
  const payload = () => ({
    structKey, structName, month, email,
    lines: [{ label: `Vols parapente biplace - ${monthLabel(month)}${mine.length ? ` (${mine.length} vol${mine.length > 1 ? 's' : ''})` : ''}`, priceEur: amount }],
  })

  return (
    <div style={wrap}>
      <button onClick={onBack} style={{ ...btn, marginBottom: 12 }}>← Retour</button>
      <h3 style={{ margin: '0 0 12px' }}>🧾 Éditer une facture</h3>

      <label style={lbl}>Structure</label>
      <select value={structName} onChange={e => setStructName(e.target.value)} style={{ ...priceInput, width: '100%', textAlign: 'left', marginBottom: 12 }}>
        {structNames.map(n => <option key={n} value={n}>{n}</option>)}
      </select>

      <label style={lbl}>Mois</label>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button style={btn} onClick={() => setMonth(m => shiftMonth(m, -1))}>‹</button>
        <strong style={{ textTransform: 'capitalize' }}>{monthLabel(month)}</strong>
        <button style={btn} onClick={() => setMonth(m => shiftMonth(m, 1))}>›</button>
      </div>

      <label style={lbl}>Somme (€)</label>
      <input type="text" inputMode="decimal" placeholder="0" value={sum} onChange={e => setSum(e.target.value)}
        style={{ ...priceInput, width: '100%', fontSize: 22, padding: 12, marginBottom: 12 }} />
      {existing && <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 8 }}>Une facture existe déjà pour ce mois (n° {existing.invoice_number}) : elle sera mise à jour, avec le même numéro.</div>}

      <label style={lbl}>E-mail de la structure</label>
      <input type="email" placeholder="structure@exemple.fr" value={email} onChange={e => setEmail(e.target.value)}
        style={{ ...priceInput, width: '100%', textAlign: 'left', marginBottom: 14 }} />

      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={!ready || busy} style={{ ...btn, flex: 1, opacity: ready ? 1 : .5 }} onClick={() => onSubmit(payload(), false)}>⬇ PDF</button>
        <button disabled={!ready || busy} style={{ ...btn, flex: 2, background: '#1d4ed8', borderColor: '#1d4ed8', opacity: ready ? 1 : .5 }} onClick={() => onSubmit(payload(), true)}>📧 Envoyer par mail</button>
      </div>
    </div>
  )
}

const lbl = { display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }
const wrap = { padding: '12px 14px 30px' }
const empty = { color: '#64748b', textAlign: 'center', padding: '30px 10px', fontSize: 13 }
const btn = { background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: '10px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }
const card = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 14, marginBottom: 10 }
const priceInput = { width: 80, background: '#1e293b', border: '1px solid #334155', borderRadius: 7, padding: '8px', color: '#e2e8f0', fontFamily: 'inherit', fontSize: 14, textAlign: 'right', boxSizing: 'border-box' }
