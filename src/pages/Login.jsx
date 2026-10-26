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

  return (
    <div style={{
      minHeight: '100vh',
      background: '#000',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 20px',
    }}>
      {/* Logo with text — centred */}
      <img
        src="/logo-text.png"
        alt="Dispo Pas Dispo"
        style={{
          width: '100%',
          maxWidth: 320,
          marginBottom: 40,
          display: 'block',
        }}
      />

      {/* Login form */}
      <form
        onSubmit={handleSubmit}
        style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        {/* Email */}
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="Email"
          required
          style={{
            background: '#111',
            border: '1px solid #333',
            borderRadius: 10,
            color: '#f1f5f9',
            fontSize: 16,
            padding: '13px 16px',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />

        {/* Password */}
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Mot de passe"
          required
          style={{
            background: '#111',
            border: '1px solid #333',
            borderRadius: 10,
            color: '#f1f5f9',
            fontSize: 16,
            padding: '13px 16px',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />

        {/* Error */}
        {error && (
          <p style={{ color: '#f87171', fontSize: 14, margin: 0, textAlign: 'center' }}>{error}</p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          style={{
            background: loading ? '#333' : '#fff',
            color: '#000',
            border: 'none',
            borderRadius: 10,
            fontSize: 16,
            fontWeight: 700,
            padding: '13px 16px',
            cursor: loading ? 'default' : 'pointer',
            marginTop: 4,
            fontFamily: 'inherit',
            transition: 'background 0.15s',
          }}
        >
          {loading ? 'Connexion...' : 'Se connecter'}
        </button>
      </form>
    </div>
  )
}
