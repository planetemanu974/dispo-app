import { useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSettings, DEFAULT_SETTINGS } from '../contexts/SettingsContext'
import Verify from './GiftVoucherVerify'
import { generateVoucher, voucherFilename, VOUCHER_DESIGNS } from '../lib/voucherPdf'

const CGV_URL = 'https://planete-parapente-reunion.com/cgv'

/** Public gift voucher page: order form (/bon-cadeau) and thank-you + download (/bon-cadeau/merci?t=…). */
export default function GiftVoucher() {
  const { pathname } = useLocation()
  if (pathname.endsWith('/verif')) return <Verify />
  if (pathname.endsWith('/payer')) return <PayPage />
  return pathname.endsWith('/merci') ? <Thanks /> : <OrderForm />
}

function OrderForm() {
  let ctx; try { ctx = useSettings() } catch { ctx = null }
  const flightTypes = ctx?.settings?.flight_types ?? DEFAULT_SETTINGS.flight_types
  const [params] = useSearchParams()

  const [f, setF] = useState({
    flight_type_id: params.get('vol') || '', design: 'adult', cgv: false,
    first_name: '', last_name: '', phone: '', email: '',
    from_name: '', to_name: '', message: '', desired_date: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  // Default to the first flight type once settings are loaded
  useEffect(() => {
    if (!f.flight_type_id && flightTypes[0]) set('flight_type_id', flightTypes[0].id)
  }, [flightTypes]) // eslint-disable-line

  const ft = flightTypes.find(t => t.id === f.flight_type_id)
  const total = ft?.price_eur ?? 0

  async function submit(e) {
    e.preventDefault(); setError('')
    if (!f.first_name.trim() || !f.last_name.trim() || !f.phone.trim() || !/^\S+@\S+\.\S+$/.test(f.email)) {
      setError('Merci de renseigner nom, prénom, téléphone et un e-mail valide.'); return
    }
    if (!f.cgv) { setError('Merci d\'accepter les conditions générales de vente.'); return }
    setBusy(true)
    const { data, error: err } = await supabase.functions.invoke('gift-checkout', { body: f })
    if (err || !data?.url) { setError('Le paiement est momentanément indisponible. Réessayez ou appelez-nous.'); setBusy(false); return }
    window.location.href = data.url
  }

  return (
    <div className="booking-page">
      <header className="booking-header">
        <img src="/logo-icon.png" alt="Planète Parapente" style={{ height: 48, marginBottom: 10 }} />
        <h1>Offrir un vol 🎁</h1>
        <p>Planete Parapente - Saint-Leu</p>
      </header>

      <form onSubmit={submit}>
        <section className="booking-section">
          <h2>1. Le vol à offrir</h2>
          <div className="field">
            <select value={f.flight_type_id} onChange={e => set('flight_type_id', e.target.value)}>
              {flightTypes.map(t => (
                <option key={t.id} value={t.id}>{t.label} · {t.duration_min} min · {t.price_eur} €</option>
              ))}
            </select>
          </div>
          <p style={{ fontSize: 12, opacity: .75 }}>Photos et vidéo non incluses dans le bon (en option le jour du vol).</p>
        </section>

        <section className="booking-section">
          <h2>2. Le modèle du bon</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {VOUCHER_DESIGNS.map(d => (
              <button type="button" key={d.id} onClick={() => set('design', d.id)}
                style={{
                  border: f.design === d.id ? '3px solid #f97316' : '3px solid transparent',
                  borderRadius: 14, padding: '18px 8px', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
                  background: `linear-gradient(135deg, ${d.colors[0]}, ${d.colors[1]})`,
                  textShadow: '0 1px 3px rgba(0,0,0,.5)',
                }}>
                <div style={{ fontSize: 30 }}>{d.emoji}</div>{d.label}
              </button>
            ))}
          </div>
        </section>

        <section className="booking-section">
          <h2>3. Pour qui ?</h2>
          <div className="field-row">
            <div className="field"><label>Pour</label>
              <input value={f.to_name} placeholder="Prénom du bénéficiaire" onChange={e => set('to_name', e.target.value)} /></div>
            <div className="field"><label>De la part de</label>
              <input value={f.from_name} onChange={e => set('from_name', e.target.value)} /></div>
          </div>
          <div className="field"><label>Message personnel (facultatif)</label>
            <textarea rows={3} maxLength={300} value={f.message} onChange={e => set('message', e.target.value)} /></div>
          <div className="field"><label>Date de vol souhaitée (facultatif)</label>
            <input type="date" value={f.desired_date} onChange={e => set('desired_date', e.target.value)} /></div>
        </section>

        <section className="booking-section">
          <h2>4. Vos coordonnées</h2>
          <div className="field-row">
            <div className="field"><label>Prénom</label>
              <input value={f.first_name} onChange={e => set('first_name', e.target.value)} /></div>
            <div className="field"><label>Nom</label>
              <input value={f.last_name} onChange={e => set('last_name', e.target.value)} /></div>
          </div>
          <div className="field-row">
            <div className="field"><label>Téléphone</label>
              <input type="tel" value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
            <div className="field"><label>E-mail</label>
              <input type="email" value={f.email} onChange={e => set('email', e.target.value)} /></div>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, fontSize: 13 }}>
            <input type="checkbox" checked={f.cgv} onChange={e => set('cgv', e.target.checked)} style={{ width: 'auto', marginTop: 3 }} />
            <span>J'ai lu et j'accepte les <a href={CGV_URL} target="_blank" rel="noreferrer" style={{ color: '#f97316' }}>conditions générales de vente</a> :
              bon valable 6 mois, non remboursable, non échangeable.</span>
          </label>
          {error && <p className="error-msg">{error}</p>}
          <button className="btn-primary" type="submit" disabled={busy || !ft} style={{ width: '100%', marginTop: 12 }}>
            {busy ? 'Redirection vers le paiement…' : `Payer ${total} € — recevoir le bon`}
          </button>
          <p style={{ fontSize: 12, opacity: .7, marginTop: 8 }}>
            Paiement sécurisé par carte. Le bon est valable 6 mois et vous est envoyé par e-mail dès que le paiement est accepté.
          </p>
        </section>
      </form>
    </div>
  )
}

function Thanks() {
  const [params] = useSearchParams()
  const token = params.get('t')
  const [v, setV] = useState(undefined) // undefined = loading, null = not found
  const [tries, setTries] = useState(0)

  // The webhook can take a few seconds: poll until the voucher is paid
  useEffect(() => {
    let alive = true
    async function load() {
      const { data } = await supabase.rpc('get_gift_voucher', { p_token: token })
      if (!alive) return
      const row = data?.[0] ?? null
      setV(row)
      if (row && row.status === 'pending' && tries < 20) setTimeout(() => alive && setTries(t => t + 1), 2000)
    }
    if (token) load(); else setV(null)
    return () => { alive = false }
  }, [token, tries])

  const download = async () => (await generateVoucher(v)).save(voucherFilename(v))
  const print = async () => {
    const url = (await generateVoucher(v)).output('bloburl')
    window.open(url, '_blank')
  }

  return (
    <div className="booking-page">
      <header className="booking-header">
        <img src="/logo-icon.png" alt="Planète Parapente" style={{ height: 48, marginBottom: 10 }} />
        <h1>Votre bon cadeau 🎁</h1>
      </header>
      <section className="booking-section" style={{ textAlign: 'center' }}>
        {v === undefined && <p>Chargement…</p>}
        {v === null && <p className="error-msg">Bon introuvable. Vérifiez le lien reçu par e-mail.</p>}
        {v && v.status === 'pending' && (
          <p>Paiement en cours de validation… {tries >= 20 && 'Si le paiement a été accepté, vous recevrez le bon par e-mail.'}</p>
        )}
        {v && v.status !== 'pending' && (
          <>
            <h2>Paiement accepté ✅</h2>
            <p>Code du bon : <b>{v.code}</b></p>
            <p style={{ opacity: .8 }}>Vol {v.flight_label} — valable jusqu'au {new Date(v.expires_at).toLocaleDateString('fr-FR')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              <button className="btn-primary" onClick={download}>⬇ Télécharger le bon (PDF)</button>
              <button className="btn-primary" onClick={print}>🖨 Ouvrir pour imprimer</button>
            </div>
            <p style={{ fontSize: 12, opacity: .7, marginTop: 12 }}>
              Imprimez-le pour le glisser dans une enveloppe, ou envoyez le PDF par e-mail au bénéficiaire.
            </p>
          </>
        )}
      </section>
    </div>
  )
}

/** Payment page for a voucher created by the pilot by phone: /bon-cadeau/payer?t=<token> */
function PayPage() {
  const [params] = useSearchParams()
  const token = params.get('t')
  const [v, setV] = useState(undefined)
  const [cgv, setCgv] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('get_gift_voucher', { p_token: token })
      setV(data?.[0] ?? null)
    })()
  }, [token])

  async function pay() {
    if (!cgv) { setError("Merci d'accepter les conditions générales de vente."); return }
    setBusy(true); setError('')
    const { data, error: err } = await supabase.functions.invoke('gift-checkout', { body: { pay_token: token, cgv: true } })
    if (err || !data?.url) { setError('Paiement momentanément indisponible. Réessayez ou appelez-nous.'); setBusy(false); return }
    window.location.href = data.url
  }

  return (
    <div className="booking-page">
      <header className="booking-header">
        <img src="/logo-icon.png" alt="Planète Parapente" style={{ height: 48, marginBottom: 10 }} />
        <h1>Régler votre bon cadeau 🎁</h1>
      </header>
      <section className="booking-section" style={{ textAlign: 'center' }}>
        {v === undefined && <p>Chargement…</p>}
        {v === null && <p className="error-msg">Bon introuvable. Vérifiez le lien reçu.</p>}
        {v && v.status !== 'pending' && <p>✅ Ce bon est déjà réglé. Code : <b>{v.code}</b></p>}
        {v && v.status === 'pending' && (
          <>
            <p><b>Vol {v.flight_label}</b> — {v.amount_eur} €</p>
            {v.to_name && <p>Pour : {v.to_name}</p>}
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, fontSize: 13, textAlign: 'left' }}>
              <input type="checkbox" checked={cgv} onChange={e => setCgv(e.target.checked)} style={{ width: 'auto', marginTop: 3 }} />
              <span>J'ai lu et j'accepte les <a href={CGV_URL} target="_blank" rel="noreferrer" style={{ color: '#f97316' }}>conditions générales de vente</a> :
                bon valable 6 mois, non remboursable, non échangeable.</span>
            </label>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn-primary" disabled={busy} onClick={pay} style={{ width: '100%', marginTop: 12 }}>
              {busy ? 'Redirection…' : `Payer ${v.amount_eur} €`}
            </button>
            <p style={{ fontSize: 12, opacity: .7, marginTop: 8 }}>Le bon n'est valable qu'une fois le paiement accepté.</p>
          </>
        )}
      </section>
    </div>
  )
}
