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
      <Logo />
      <p style={s.info}>Vérification du lien…</p>
    </Wrapper>
  )

  if (done) return (
    <Wrapper>
      <Logo />
      <p style={{ ...s.info, color: '#4ade80' }}>✅ Compte créé ! Redirection…</p>
    </Wrapper>
  )

  if (error && !info) return (
    <Wrapper>
      <Logo />
      <p style={{ ...s.error, textAlign: 'center', marginTop: 8 }}>{error}</p>
    </Wrapper>
  )

  return (
    <Wrapper>
      <Logo />

      <p style={s.info}>
        Bienvenue <strong style={{ color: '#f1f5f9' }}>{info?.name}</strong> !<br />
        Choisissez un code secret pour accéder au planning.
      </p>

      <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Nom en lecture seule */}
        <input
          type="text"
          readOnly
          value={info?.name ?? ''}
          style={{ ...s.input, color: '#64748b', cursor: 'default' }}
        />

        {/* Code secret */}
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={s.input}
          placeholder="Code secret (4 caractères minimum)"
          autoFocus
          required
        />

        {/* Confirmation */}
        <input
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          style={s.input}
          placeholder="Confirmer le code secret"
          required
        />

        {error && <p style={s.error}>{error}</p>}

        <button type="submit" disabled={saving} style={s.btn}>
          {saving ? 'Création en cours…' : 'Créer mon accès →'}
        </button>
      </form>
    </Wrapper>
  )
}

// ── Logo centré (identique à la page Login) ───────────────────────────────
function Logo() {
  return (
    <img
      src="/logo-text.png"
      alt="Dispo Pas Dispo"
      style={{ width: '100%', maxWidth: 320, marginBottom: 32, display: 'block' }}
    />
  )
}

// ── Wrapper page entière — même fond noir que Login ───────────────────────
function Wrapper({ children }) {
  return (
    <div style={{
      minHeight: '100dvh',
      background: '#000',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 20px',
    }}>
      {children}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────
const s = {
  info: {
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 1.6,
    marginBottom: 20,
    maxWidth: 320,
  },
  input: {
    width: '100%',
    background: '#111',
    border: '1px solid #333',
    borderRadius: 10,
    color: '#f1f5f9',
    fontSize: 16,
    padding: '13px 16px',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  error: {
    color: '#f87171',
    fontSize: 13,
    background: '#1a0505',
    border: '1px solid #7f1d1d',
    padding: '8px 12px',
    borderRadius: 8,
    margin: 0,
  },
  btn: {
    width: '100%',
    padding: '13px 16px',
    background: '#fff',
    color: '#000',
    border: 'none',
    borderRadius: 10,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 4,
    fontFamily: 'inherit',
    letterSpacing: '0.02em',
  },
}
