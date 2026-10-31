import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { generateVoucher, voucherFilename } from '../lib/voucherPdf'

const STATUS = { pending: ['Non payé', '#94a3b8'], paid: ['À utiliser', '#22c55e'], used: ['Utilisé', '#f97316'], cancelled: ['Annulé', '#ef4444'] }
const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('fr-FR') : ''

/** Pilot-side list of gift vouchers: status, download/print the PDF, mark flown. */
export default function GiftVouchersAdmin() {
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
  const shown = rows.filter(r => filter === 'all' ? true : r.status === filter)

  return (
    <div style={{ padding: 16, color: '#e2e8f0' }}>
      <h2 style={{ marginBottom: 10 }}>🎁 Bons cadeaux</h2>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[['paid', 'À utiliser'], ['used', 'Utilisés'], ['pending', 'Non payés'], ['all', 'Tous']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            padding: '6px 12px', borderRadius: 16, border: '1px solid #334155', cursor: 'pointer',
            background: filter === k ? '#f97316' : '#1e293b', color: '#fff', fontFamily: 'inherit',
          }}>{l}</button>
        ))}
      </div>
      {shown.length === 0 && <p style={{ opacity: .6 }}>Aucun bon.</p>}
      {shown.map(v => {
        const [label, color] = STATUS[v.status] ?? [v.status, '#94a3b8']
        const expired = v.status === 'paid' && v.expires_at && new Date(v.expires_at) < new Date()
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
              {v.paid_at && <>Payé le {fmt(v.paid_at)} · valable jusqu'au {fmt(v.expires_at)}<br /></>}
              {v.desired_date && <>Date souhaitée : {fmt(v.desired_date)}<br /></>}
              {v.used_at && <>Vol effectué le {fmt(v.used_at)}</>}
            </div>
            {v.status !== 'pending' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={async () => (await generateVoucher(v)).save(voucherFilename(v))}
                  style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#fff', cursor: 'pointer' }}>⬇ PDF</button>
                {v.status === 'paid' && (
                  <button onClick={() => markUsed(v)}
                    style={{ flex: 1, padding: 8, borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer' }}>✅ Vol effectué</button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
