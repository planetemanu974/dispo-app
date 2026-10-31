import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''

/**
 * Opened by scanning the QR code of a voucher. Shows nothing but a neutral message to the public:
 * the voucher details only load for a logged-in pilot (row-level security), who can mark the flight as done.
 */
export default function GiftVoucherVerify() {
  const [params] = useSearchParams()
  const code = (params.get('c') || '').toUpperCase()
  const [state, setState] = useState({ loading: true })
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setState({ noSession: true }); return }
    const { data, error } = await supabase.from('gift_vouchers').select('*').eq('code', code).maybeSingle()
    setState({ v: data, error })
  }
  useEffect(() => { load() }, [code]) // eslint-disable-line

  async function markUsed() {
    setBusy(true)
    await supabase.from('gift_vouchers').update({ status: 'used', used_at: new Date().toISOString() }).eq('code', code).eq('status', 'paid')
    await load(); setBusy(false)
  }

  const { v } = state
  const expired = v?.expires_at && new Date(v.expires_at) < new Date()
  let tone = '#64748b', title = '', lines = []
  if (v) {
    lines = [`Vol ${v.flight_label}${v.media_pack === 'photo' ? ' + photos' : v.media_pack === 'photo_video' ? ' + photos/vidéo' : ''}`,
      v.to_name ? `Pour : ${v.to_name}` : '', v.from_name ? `De la part de : ${v.from_name}` : ''].filter(Boolean)
    if (v.status === 'used') { tone = '#dc2626'; title = `Déjà utilisé — vol effectué le ${fmt(v.used_at)}` }
    else if (v.status === 'pending') { tone = '#dc2626'; title = 'Non payé — bon NON valide' }
    else if (v.status === 'cancelled') { tone = '#dc2626'; title = 'Bon annulé' }
    else if (expired) { tone = '#ea580c'; title = `Expiré depuis le ${fmt(v.expires_at)}` }
    else { tone = '#16a34a'; title = `Valide jusqu'au ${fmt(v.expires_at)}` }
  }

  return (
    <div className="booking-page">
      <header className="booking-header">
        <img src="/logo-icon.png" alt="" style={{ height: 48, marginBottom: 10 }} />
        <h1>Bon cadeau</h1>
      </header>
      <section className="booking-section" style={{ textAlign: 'center' }}>
        {state.loading && <p>Chargement…</p>}
        {state.noSession && <p>Contrôle réservé au moniteur. Connectez-vous à l'application puis flashez à nouveau le code.</p>}
        {!state.loading && !state.noSession && !v && <p style={{ color: '#dc2626', fontWeight: 700 }}>Code inconnu : {code}</p>}
        {v && (
          <>
            <div style={{ border: `3px solid ${tone}`, borderRadius: 14, padding: 18 }}>
              <div style={{ color: tone, fontWeight: 800, fontSize: 20 }}>{title}</div>
              <p style={{ marginTop: 10 }}><b>{v.code}</b></p>
              {lines.map(l => <p key={l}>{l}</p>)}
              {v.desired_date && <p style={{ opacity: .8 }}>Date souhaitée : {fmt(v.desired_date)}</p>}
              {v.message && <p style={{ fontStyle: 'italic', opacity: .8 }}>« {v.message} »</p>}
            </div>
            {v.status === 'paid' && !expired && (
              <button className="btn-primary" disabled={busy} onClick={markUsed} style={{ width: '100%', marginTop: 14 }}>
                ✅ Marquer le vol comme effectué
              </button>
            )}
          </>
        )}
      </section>
    </div>
  )
}
