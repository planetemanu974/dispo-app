import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Booking from './pages/Booking'

export default function App() {
  const [session, setSession] = useState(undefined)
  const [pilot, setPilot]     = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) loadPilot(session.user.id)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) loadPilot(session.user.id)
      else setPilot(null)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function loadPilot(userId) {
    const { data } = await supabase
      .from('pilots').select('*').eq('user_id', userId).single()
    setPilot(data)
  }

  if (session === undefined) return <div className="loading-screen">Chargement...</div>

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/reservation" element={<Booking />} />
        <Route path="/" element={session && pilot ? <Dashboard pilot={pilot} /> : <Login />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}