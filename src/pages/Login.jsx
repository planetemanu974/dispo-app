import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  // Email + password login
  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Email ou mot de passe incorrect.')
    setLoading(false)
  }

  // GitHub OAuth login
  async function handleGitHub() {
    setLoading(true)
    setError('')
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: window.location.origin },
    })
    // page redirects — no need to setLoading(false)
  }

  return (
    <div className="booking-page" style={{ maxWidth: 400, margin: '0 auto' }}>
      <header className="booking-header">
        <span className="logo">🪂</span>
        <h1>Dispo / Pas Dispo</h1>
        <p>Espace moniteur</p>
      </header>

      <section className="booking-section">
        {/* GitHub button */}
        <button
          onClick={handleGitHub}
          disabled={loading}
          style={{
            width: '100%',
            padding: '11px',
            background: '#24292e',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '0.95rem',
            fontWeight: 600,
            cursor: 'pointer',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577
              0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755
              -1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236
              1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466
              -1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176
              0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405
              2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23
              1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22
              0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295
              24 12c0-6.63-5.37-12-12-12"/>
          </svg>
          Se connecter avec GitHub
        </button>

        <div style={{ textAlign: 'center', color: '#aaa', marginBottom: '16px', fontSize: '0.85rem' }}>
          — ou avec email —
        </div>

        {/* Email / password form */}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="date-input"
              placeholder="votre@email.com"
              required
            />
          </div>
          <div className="field" style={{ marginTop: '12px' }}>
            <label>Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="date-input"
              placeholder="••••••••"
              required
            />
          </div>
          {error && (
            <p style={{ color: '#c0392b', fontSize: '0.9rem', marginTop: '8px' }}>{error}</p>
          )}
          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
            style={{ width: '100%', marginTop: '16px' }}
          >
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>
      </section>
    </div>
  )
}
