import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { generateVoucher, voucherFilename } from '../lib/voucherPdf'

const STATUS = { pending: ['💶 À encaisser', '#eab308'], paid: ['À utiliser', '#22c55e'], booked: ['Réservé', '#3b82f6'], lost: ['Perdu', '#ef4444'], used: ['Utilisé', '#f97316'], cancelled: ['Annulé', '#ef4444'] }
const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('fr-FR') : ''

/** Pilot-side list of gift vouchers: status, download/print the PDF, mark flown. */
// Voucher code without ambiguous characters, same format as the server (PP-XXXX-XXXX)
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const pick = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => chars[b % chars.length]).join('')
  return `PP-${pick(4)}-${pick(4)}`
}

export default function GiftVouchersAdmin({ flightTypes = [] }) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ flight_type_id: '', to_name: '', from_name: '', buyer: '', phone: '', email: '', paid: false })
  const [formError, setFormError] = useState('')
  const setF = (k, val) => setForm(p => ({ ...p, [k]: val }))

  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('paid')

  const load = async () => {
    const { data } = await supabase.from('gift_vouchers').select('*').order('created_at', { ascending: false })
    setRows(data ?? [])
  }
  useEffect(() => { load() }, [])

  const markUsed = async (v) => {
    await supabase.from('gift_vouchers').update({ status: 'used', used_at: new Date().toISOString() }).eq('id', v.id)
    load()
  }
  const patch = async (v, fields) => { await supabase.from('gift_vouchers').update(fields).eq('id', v.id); load() }
  // Weather postponement: the voucher stays valid 45 more days from today
  const extend = (v) => patch(v, { extended_until: new Date(Date.now() + 45 * 864e5).toISOString() })
  // Weather cancellation by the pilot: the booking is released and the voucher is usable again
  const release = (v) => patch(v, { status: 'paid', booking_id: null, booked_at: null })
  // Voucher created by phone: unpaid ('pending') unless the pilot ticks "payé"
  async function createManual() {
    const ft = flightTypes.find(t => t.id === (form.flight_type_id || flightTypes[0]?.id))
    if (!ft || !form.buyer.trim() || !form.phone.trim()) { setFormError('Vol, nom et téléphone obligatoires.'); return }
    const exp = new Date(); exp.setMonth(exp.getMonth() + 6)
    const row = {
      code: makeCode(), flight_type_id: ft.id, flight_label: ft.label, media_pack: 'none', amount_eur: ft.price_eur,
      design: 'adult', buyer_first_name: form.buyer.trim(), buyer_last_name: '', buyer_phone: form.phone.trim(),
      buyer_email: form.email.trim(), from_name: form.from_name.trim() || null, to_name: form.to_name.trim() || null,
      status: form.paid ? 'paid' : 'pending',
      ...(form.paid ? { paid_at: new Date().toISOString(), expires_at: exp.toISOString() } : {}),
    }
    const { error } = await supabase.from('gift_vouchers').insert(row)
    if (error) { setFormError('Erreur : ' + error.message); return }
    setShowForm(false); setFormError('')
    setForm({ flight_type_id: '', to_name: '', from_name: '', buyer: '', phone: '', email: '', paid: false })
    setFilter(row.status); load()
  }

  // Payment link to send to the buyer (SMS / WhatsApp / mail via the phone's share sheet)
  async function sendPayLink(v) {
    const url = `${window.location.origin}/bon-cadeau/payer?t=${v.token}`
    const msg = `Bonjour, voici le lien pour régler votre bon cadeau vol parapente (${v.flight_label}, ${v.amount_eur} €) : ${url}`
    try { if (navigator.share) { await navigator.share({ text: msg }); return } } catch { return }
    try { await navigator.clipboard.writeText(msg); alert('Lien copié, collez-le dans votre message.') } catch { window.prompt('Copiez ce message :', msg) }
  }
  const cashIn = (v) => { const exp = new Date(); exp.setMonth(exp.getMonth() + 6); return patch(v, { status: 'paid', paid_at: new Date().toISOString(), expires_at: exp.toISOString() }) }
  const shown = rows.filter(r => filter === 'all' ? true : r.status === filter)

  return (
    <div style={{ padding: 16, color: '#e2e8f0' }}>
      <h2 style={{ marginBottom: 10 }}>🎁 Bons cadeaux</h2>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[['paid', 'À utiliser'], ['booked', 'Réservés'], ['used', 'Utilisés'], ['pending', 'À encaisser'], ['all', 'Tous']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            padding: '6px 12px', borderRadius: 16, border: '1px solid #334155', cursor: 'pointer',
            background: filter === k ? '#f97316' : '#1e293b', color: '#fff', fontFamily: 'inherit',
          }}>{l}</button>
        ))}
      </div>
      <button onClick={() => setShowForm(s => !s)} style={{ width: '100%', padding: 10, borderRadius: 10, border: 'none', background: '#f97316', color: '#fff', fontWeight: 700, cursor: 'pointer', marginBottom: 12 }}>
        {showForm ? 'Fermer' : '+ Créer un bon (commande par téléphone)'}
      </button>
      {showForm && (
        <div style={{ background: '#1e293b', borderRadius: 12, padding: 12, marginBottom: 12, display: 'grid', gap: 8 }}>
          <select value={form.flight_type_id || flightTypes[0]?.id || ''} onChange={e => setF('flight_type_id', e.target.value)}>
            {flightTypes.map(t => <option key={t.id} value={t.id}>{t.label} · {t.price_eur} €</option>)}
          </select>
          <input placeholder="Pour (bénéficiaire)" value={form.to_name} onChange={e => setF('to_name', e.target.value)} />
          <input placeholder="De la part de" value={form.from_name} onChange={e => setF('from_name', e.target.value)} />
          <input placeholder="Nom de l'acheteur *" value={form.buyer} onChange={e => setF('buyer', e.target.value)} />
          <input type="tel" placeholder="Téléphone de l'acheteur *" value={form.phone} onChange={e => setF('phone', e.target.value)} />
          <input type="email" placeholder="E-mail (facultatif)" value={form.email} onChange={e => setF('email', e.target.value)} />
          <label style={{ fontSize: 14 }}><input type="checkbox" checked={form.paid} onChange={e => setF('paid', e.target.checked)} style={{ width: 'auto', marginRight: 6 }} />
            Déjà payé (espèces, virement…)</label>
          {formError && <div style={{ color: '#f87171' }}>{formError}</div>}
          <button onClick={createManual} style={{ padding: 10, borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer' }}>Créer le bon</button>
        </div>
      )}
      {shown.length === 0 && <p style={{ opacity: .6 }}>Aucun bon.</p>}
      {shown.map(v => {
        const [label, color] = STATUS[v.status] ?? [v.status, '#94a3b8']
        const until = new Date(Math.max(new Date(v.expires_at), v.extended_until ? new Date(v.extended_until) : 0))
        const expired = v.status === 'paid' && v.expires_at && until < new Date()
        return (
          <div key={v.id} style={{ background: '#1e293b', borderRadius: 12, padding: 12, marginBottom: 10, borderLeft: `4px solid ${color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <b>{v.code}</b>
              <span style={{ color }}>{expired ? 'Expiré' : label}</span>
            </div>
            <div>Vol {v.flight_label}{v.media_pack !== 'none' ? ` + ${v.media_pack === 'photo' ? 'photos' : 'photos/vidéo'}` : ''} · {v.amount_eur} €</div>
            <div style={{ fontSize: 13, opacity: .85 }}>
              Pour {v.to_name || '—'} · de la part de {v.from_name || '—'}<br />
              Acheteur : {v.buyer_first_name} {v.buyer_last_name} · <a href={`tel:${v.buyer_phone}`} style={{ color: '#38bdf8' }}>{v.buyer_phone}</a> · {v.buyer_email}<br />
              {v.paid_at && <>Payé le {fmt(v.paid_at)} · valable jusqu'au {fmt(until)}{v.extended_until ? ' (prolongé météo)' : ''}<br /></>}
              {v.desired_date && <>Date souhaitée : {fmt(v.desired_date)}<br /></>}
              {v.used_at && <>Vol effectué le {fmt(v.used_at)}</>}
            </div>
            {(
              <>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={async () => (await generateVoucher(v)).save(voucherFilename(v))}
                  style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#fff', cursor: 'pointer' }}>⬇ PDF</button>
                {v.status === 'pending' && (
                  <button onClick={() => sendPayLink(v)}
                    style={{ flex: 1, padding: 8, borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer' }}>📲 Lien de paiement</button>
                )}
                {v.status === 'pending' && (
                  <button onClick={() => cashIn(v)}
                    style={{ flex: 1, padding: 8, borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer' }}>💶 Encaissé</button>
                )}
                {(v.status === 'paid' || v.status === 'booked') && (
                  <button onClick={() => markUsed(v)}
                    style={{ flex: 1, padding: 8, borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer' }}>✅ Vol effectué</button>
                )}
              </div>
              {(v.status === 'booked' || v.status === 'paid') && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => extend(v)} style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#fff', cursor: 'pointer' }}>⏱ Prolonger 45 j</button>
                  {v.status === 'booked' && <button onClick={() => release(v)} style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#fff', cursor: 'pointer' }}>↩ Rendre le bon</button>}
                  {v.status === 'booked' && <button onClick={() => patch(v, { status: 'lost' })} style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #7f1d1d', background: '#0f172a', color: '#fca5a5', cursor: 'pointer' }}>✖ Perdu</button>}
                </div>
              )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
