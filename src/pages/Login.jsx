import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Email ou mot de passe incorrect')
    setLoading(false)
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">🪂</div>
        <h1>Dispo / Pas Dispo</h1>
        <p className="login-sub">Espace moniteur</p>
        <form onSubmit={handleLogin}>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email}
              onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Mot de passe</label>
            <input type="password" value={password}
              onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <p className="error-msg" style={{ marginTop: 8 }}>{error}</p>}
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  )
}