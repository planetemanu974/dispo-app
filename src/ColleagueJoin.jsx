// ColleagueJoin.jsx — Inscription du collègue via lien d'invitation
// Route : /join?token=<invite_token>
// Le pilote partage ce lien. Le collègue choisit son code secret.
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function ColleagueJoin() {
  const [token, setToken]           = useState(null)
  const [info, setInfo]             = useState(null)   // { id, name, pilot_id }
  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState(null)
  const [done, setDone]             = useState(false)

  // ── Vérifier le token à l'ouverture de la page ────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('token')

    if (!t) {
      setError("Lien invalide. Demandez un nouveau lien d'invitation à votre collègue.")
      setLoading(false)
      return
    }

    setToken(t)

    // Lire le record colleague via la politique publique invite_used=FALSE
    supabase
      .from('colleagues')
      .select('id, name, pilot_id')
      .eq('invite_token', t)
      .eq('invite_used', false)
      .eq('active', true)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err || !data) {
          setError("Ce lien d'invitation est invalide ou a déjà été utilisé.")
        } else {
          setInfo(data)
        }
        setLoading(false)
      })
  }, [])

  // ── Soumettre le formulaire d'inscription ────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (password.length < 4) {
      setError('Le code secret doit avoir au moins 4 caractères.')
      return
    }
    if (password !== confirm) {
      setError('Les codes secrets ne correspondent pas.')
      return
    }

    setSaving(true)

    // Appel à la RPC SECURITY DEFINER qui hache le mot de passe côté serveur
    const { data: colleagueId, error: regError } = await supabase
      .rpc('colleague_register', {
        p_token:    token,
        p_password: password,
      })

    if (regError || !colleagueId) {
      setError("Erreur lors de l'inscription. Ce lien a peut-être déjà été utilisé.")
      setSaving(false)
      return
    }

    // Sauvegarder la session dans localStorage pour connexion automatique
    try {
      localStorage.setItem('colleagueSession', JSON.stringify({
        colleague_id: info.id,
        pilot_id:     info.pilot_id,
        name:         info.name,
      }))
    } catch { /* localStorage peut être bloqué sur certains navigateurs */ }

    setDone(true)
    setSaving(false)

    // Redirection automatique vers le planning
    setTimeout(() => { window.location.href = '/dispo' }, 2000)
  }

  // ── États de rendu ────────────────────────────────────────────────────

  if (loading) return (
    <Wrapper>
      <Card>
        <Emoji>🪂</Emoji>
        <p style={s.info}>Vérification du lien…</p>
      </Card>
    </Wrapper>
  )

  if (done) return (
    <Wrapper>
      <Card>
        <Emoji>✅</Emoji>
        <h2 style={s.title}>Compte créé !</h2>
        <p style={s.info}>Redirection vers le planning…</p>
      </Card>
    </Wrapper>
  )

  if (error && !info) return (
    <Wrapper>
      <Card>
        <Emoji>❌</Emoji>
        <p style={{ ...s.error, textAlign: 'center', marginTop: 8 }}>{error}</p>
      </Card>
    </Wrapper>
  )

  return (
    <Wrapper>
      <Card>
        <Emoji>🪂</Emoji>
        <h2 style={s.title}>Manu Dispo</h2>
        <p style={s.info}>
          Bienvenue <strong>{info?.name}</strong> !<br />
          Choisissez un code secret pour accéder<br />au planning de disponibilités.
        </p>

        <form onSubmit={handleSubmit}>
          <Field label="Votre nom d'utilisateur">
            <input
              type="text"
              readOnly
              value={info?.name ?? ''}
              style={{ ...s.input, background: '#f1f5f9', color: '#64748b', cursor: 'default' }}
            />
          </Field>

          <Field label="Code secret">
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={s.input}
              placeholder="4 caractères minimum"
              autoFocus
              required
            />
          </Field>

          <Field label="Confirmer le code secret">
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              style={s.input}
              placeholder="Répétez le code secret"
              required
            />
          </Field>

          {error && <p style={s.error}>{error}</p>}

          <button type="submit" disabled={saving} style={s.btn}>
            {saving ? 'Création en cours…' : 'Créer mon accès →'}
          </button>
        </form>
      </Card>
    </Wrapper>
  )
}

// ── Petits composants utilitaires ─────────────────────────────────────────
function Wrapper({ children }) {
  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)',
      padding: '16px',
    }}>
      {children}
    </div>
  )
}

function Card({ children }) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 20,
      padding: '32px 24px',
      maxWidth: 380,
      width: '100%',
      boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
    }}>
      {children}
    </div>
  )
}

function Emoji({ children }) {
  return <div style={{ fontSize: 52, textAlign: 'center', marginBottom: 4 }}>{children}</div>
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={s.label}>{label}</label>
      {children}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────
const s = {
  title: {
    textAlign: 'center',
    margin: '4px 0 8px',
    fontSize: 22,
    fontWeight: 700,
    color: '#0f172a',
  },
  info: {
    textAlign: 'center',
    color: '#64748b',
    fontSize: 14,
    lineHeight: 1.6,
    marginBottom: 20,
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1.5px solid #d1d5db',
    borderRadius: 8,
    fontSize: 15,
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  error: {
    color: '#dc2626',
    fontSize: 13,
    marginBottom: 10,
    background: '#fef2f2',
    padding: '8px 10px',
    borderRadius: 6,
  },
  btn: {
    width: '100%',
    padding: '13px',
    background: '#16a34a',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 8,
    letterSpacing: '0.02em',
  },
}
