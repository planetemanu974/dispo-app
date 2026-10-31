// ColleagueDispo.jsx — Vue "Manu Dispo" pour les structures collègues
// Route : /dispo
// Affiche : connexion → calendrier vert/rouge → demande de créneau
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ── Helpers ───────────────────────────────────────────────────────────────
const DAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']

// Format local YYYY-MM-DD sans conversion UTC (fix fuseau horaire UTC+4)
function toLocalDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function today() {
  return toLocalDateStr(new Date())
}

// Lundi de la semaine contenant dateStr
function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return toLocalDateStr(d)
}

// Génère un tableau de N dates à partir de startDate
function getDays(startDate, n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(startDate + 'T00:00:00')
    d.setDate(d.getDate() + i)
    return toLocalDateStr(d)
  })
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]}`
}

function formatTime(timeStr) {
  // timeStr peut être "HH:MM:SS" ou "HH:MM"
  return timeStr ? timeStr.slice(0, 5) : '--:--'
}

// Name shown in the page title: the pilot works here as an independent (not as the « Planète Parapente » structure)
const PILOT_DISPLAY_NAME = 'Manu'

// ── Composant principal ───────────────────────────────────────────────────
export default function ColleagueDispo() {
  // Session du collègue (localStorage)
  const [session, setSession]       = useState(null)   // { colleague_id, pilot_id, name }
  const [authLoading, setAuthLoading] = useState(true)
  const [logoUrl, setLogoUrl]   = useState(null)   // the structure's own logo (header)
  const [flights, setFlights]   = useState([])     // flights this structure booked with the pilot (shown with its logo)

  // Formulaire de connexion
  const [loginName, setLoginName]   = useState('')
  const [loginPwd, setLoginPwd]     = useState('')
  const [loginError, setLoginError] = useState(null)
  const [loginSaving, setLoginSaving] = useState(false)

  // Calendrier
  const [weekStart, setWeekStart]   = useState(() => today())
  const [slots, setSlots]           = useState([])     // []{ slot_id, slot_date, slot_time, is_available, is_booked, my_request_status }
  const [calLoading, setCalLoading] = useState(false)

  // Historique des demandes
  const [history, setHistory]         = useState([])
  const [histLoading, setHistLoading] = useState(false)

  // Modal de demande
  const [requestSlot, setRequestSlot] = useState(null) // slot sélectionné
  const [note, setNote]               = useState('')
  const [requestSaving, setRequestSaving] = useState(false)
  const [requestError, setRequestError]   = useState(null)
  const [requestDone, setRequestDone]     = useState(false)

  // Message collègue → pilote
  const [msgBody, setMsgBody]         = useState('')
  const [msgSending, setMsgSending]   = useState(false)
  const [msgSent, setMsgSent]         = useState(false)
  const [msgError, setMsgError]       = useState(null)

  // ── Récupérer le nom affiché du pilote ───────────────────────────────
  async function fetchPilotName(pilotId) {
    // Essaie d'abord sms_name (champ court dédié), puis name générique
    const { data } = await supabase
      .from('pilots')
      .select('sms_name, name')
      .eq('id', pilotId)
      .maybeSingle()
    return data?.sms_name || data?.name || null
  }

  // ── Charger la session depuis localStorage ────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        // Preview mode (/dispo?apercu=<colleague_id>): the owner, signed in, sees exactly what that structure sees.
        // Nothing is saved and nothing can be sent from here.
        const previewId = new URLSearchParams(window.location.search).get('apercu')
        if (previewId) {
          const { data: col } = await supabase.from('colleagues').select('id, name, pilot_id').eq('id', previewId).maybeSingle()
          if (col) {
            const pName = await fetchPilotName(col.pilot_id)
            setSession({ colleague_id: col.id, pilot_id: col.pilot_id, name: col.name, pilotName: pName || '', preview: true })
          }
          setAuthLoading(false)
          return
        }
        const raw = localStorage.getItem('colleagueSession')
        if (raw) {
          const s = JSON.parse(raw)
          if (s?.colleague_id && s?.pilot_id) {
            // Récupérer le nom du pilote si pas encore en cache
            if (!s.pilotName) {
              const pName = await fetchPilotName(s.pilot_id)
              if (pName) {
                s.pilotName = pName
                try { localStorage.setItem('colleagueSession', JSON.stringify(s)) } catch { }
              }
            }
            setSession(s)
          }
        }
      } catch { /* ignore */ }
      setAuthLoading(false)
    }
    init()
  }, [])

  // Logo of the structure (fails silently until migration 027 is applied)
  useEffect(() => {
    if (!session?.colleague_id) { setLogoUrl(null); return }
    supabase.rpc('get_colleague_logo', { p_colleague_id: session.colleague_id })
      .then(({ data, error }) => setLogoUrl(error ? null : (data || null)))
  }, [session?.colleague_id])

  // ── Charger l'historique des demandes ────────────────────────────────
  const loadHistory = useCallback(async (colSession) => {
    if (!colSession) return
    setHistLoading(true)
    const { data } = await supabase.rpc('get_colleague_history', {
      p_colleague_id: colSession.colleague_id,
    })
    setHistory(data || [])
    setHistLoading(false)
  }, [])

  useEffect(() => {
    if (session) loadHistory(session)
  }, [session, loadHistory])

  // ── Charger les créneaux quand session ou semaine change ──────────────
  const loadSlots = useCallback(async (colSession, start) => {
    if (!colSession) return
    setCalLoading(true)

    const days = getDays(start, 7)
    const { data, error } = await supabase.rpc('get_slots_for_colleague', {
      p_colleague_id: colSession.colleague_id,
      p_start_date:   days[0],
      p_end_date:     days[6],
    })

    if (!error) setSlots(data || [])

    // The structure's own flights with the pilot (logo). Fails silently until migration 026 is applied.
    const { data: fl, error: flErr } = await supabase.rpc('get_structure_flights', {
      p_colleague_id: colSession.colleague_id,
      p_start_date:   days[0],
      p_end_date:     days[6],
    })
    setFlights(flErr ? [] : (fl || []))
    setCalLoading(false)
  }, [])

  useEffect(() => {
    if (session) loadSlots(session, weekStart)
  }, [session, weekStart, loadSlots])

  // ── Connexion ─────────────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault()
    setLoginError(null)
    setLoginSaving(true)

    const { data, error } = await supabase.rpc('colleague_login', {
      p_name:     loginName.trim(),
      p_password: loginPwd,
    })

    if (error || !data || data.length === 0) {
      setLoginError('Nom ou code secret incorrect.')
      setLoginSaving(false)
      return
    }

    const { colleague_id, pilot_id } = data[0]
    const pilotName = await fetchPilotName(pilot_id)
    const newSession = { colleague_id, pilot_id, name: loginName.trim(), pilotName: pilotName || '' }

    try { localStorage.setItem('colleagueSession', JSON.stringify(newSession)) } catch { }

    setSession(newSession)
    setLoginSaving(false)
  }

  // ── Déconnexion ───────────────────────────────────────────────────────
  function handleLogout() {
    if (session?.preview) { window.location.href = '/'; return }   // preview: just go back to the app
    try { localStorage.removeItem('colleagueSession') } catch { }
    setSession(null)
    setSlots([])
  }

  // ── Ouvrir le modal de demande ────────────────────────────────────────
  function openRequest(slot) {
    if (session?.preview) return   // preview is read-only
    setRequestSlot(slot)
    setNote('')
    setRequestError(null)
    setRequestDone(false)
  }

  // ── Envoyer la demande ────────────────────────────────────────────────
  async function handleRequest(e) {
    e.preventDefault()
    setRequestSaving(true)
    setRequestError(null)

    const { data: requestId, error } = await supabase.rpc('create_colleague_request', {
      p_colleague_id:  session.colleague_id,
      p_pilot_slot_id: requestSlot.slot_id,
      p_note:          note.trim(),
    })

    if (error) {
      setRequestError(error.message || 'Erreur lors de l\'envoi de la demande.')
      setRequestSaving(false)
      return
    }

    setRequestDone(true)
    setRequestSaving(false)

    // Mettre à jour le slot localement pour refléter la demande en attente
    setSlots(prev => prev.map(s =>
      s.slot_id === requestSlot.slot_id
        ? { ...s, my_request_status: 'pending' }
        : s
    ))

    // Recharger l'historique pour inclure la nouvelle demande
    loadHistory(session)

    setTimeout(() => setRequestSlot(null), 2000)
  }

  // ── Envoyer un message au pilote ─────────────────────────────────────
  async function sendMessage(e) {
    e.preventDefault()
    if (session?.preview) return   // preview is read-only
    if (!msgBody.trim()) return
    setMsgSending(true)
    setMsgError(null)
    const { error } = await supabase.from('colleague_messages').insert({
      pilot_id:       session.pilot_id,
      colleague_id:   session.colleague_id,
      colleague_name: session.name,
      body:           msgBody.trim(),
    })
    setMsgSending(false)
    if (error) { setMsgError('Erreur : ' + error.message); return }
    setMsgSent(true)
    setMsgBody('')
    setTimeout(() => setMsgSent(false), 4000)
  }

  // ── Rendu : écran de chargement ───────────────────────────────────────
  if (authLoading) return (
    <Screen>
      <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 80 }}>Chargement…</p>
    </Screen>
  )

  // ── Rendu : formulaire de connexion ───────────────────────────────────
  if (!session) return (
    <div style={{ minHeight: '100dvh', background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 20px' }}>
      <img src="/logo-text.png" alt="Dispo Pas Dispo" style={{ width: '100%', maxWidth: 320, marginBottom: 40, display: 'block' }} />
      <form onSubmit={handleLogin} style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <input
          type="text"
          value={loginName}
          onChange={e => setLoginName(e.target.value)}
          style={s.inputDark}
          placeholder="Nom d'utilisateur"
          autoFocus
          required
        />
        <input
          type="password"
          value={loginPwd}
          onChange={e => setLoginPwd(e.target.value)}
          style={s.inputDark}
          placeholder="Code secret"
          required
        />
        {loginError && <p style={{ color: '#f87171', fontSize: 14, margin: 0, textAlign: 'center' }}>{loginError}</p>}
        <button type="submit" disabled={loginSaving} style={s.btnWhite}>
          {loginSaving ? 'Connexion…' : 'Accéder au planning →'}
        </button>
      </form>
    </div>
  )

  // ── Rendu : calendrier ────────────────────────────────────────────────
  const days = getDays(weekStart, 7)

  // Grouper les créneaux par date
  const slotsByDay = {}
  days.forEach(d => { slotsByDay[d] = [] })
  slots.forEach(sl => {
    if (slotsByDay[sl.slot_date]) slotsByDay[sl.slot_date].push(sl)
  })

  // Semaine suivante / précédente
  function prevWeek() {
    const d = new Date(weekStart + 'T00:00:00')
    d.setDate(d.getDate() - 7)
    setWeekStart(toLocalDateStr(d))
  }
  function nextWeek() {
    const d = new Date(weekStart + 'T00:00:00')
    d.setDate(d.getDate() + 7)
    setWeekStart(toLocalDateStr(d))
  }
  const canPrev = weekStart > today()

  return (
    <Screen>
      {/* ── Header ── */}
      <div style={s.header}>
        {/* Logo gauche */}
        <img src="/logo-text.png" alt="Dispo Pas Dispo" style={{ height: 36, display: 'block', flexShrink: 0 }} />

        {/* Titre centré : "[Nom du pilote] Dispo" */}
        <div style={{ flex: 1, textAlign: 'center', padding: '0 8px' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#f1f5f9', letterSpacing: '0.01em', lineHeight: 1.2 }}>
            {PILOT_DISPLAY_NAME}
            <span style={{ fontWeight: 400, color: '#22c55e', marginLeft: 6, fontSize: 12 }}>Dispo</span>
          </div>
          {logoUrl
            ? <img src={logoUrl} alt={session.name} style={{ height: 30, maxWidth: 140, objectFit: 'contain', marginTop: 4, display: 'inline-block' }} />
            : <div style={{ fontSize: 10, color: '#475569', marginTop: 2, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{session.name}</div>}
        </div>

        {/* Déconnexion droite */}
        <button onClick={handleLogout} style={s.logoutBtn}>{session.preview ? '← Retour' : 'Déconnexion'}</button>
      </div>
      {session.preview && (
        <div style={{ background: '#312e81', color: '#e0e7ff', textAlign: 'center', fontSize: 13, padding: '8px 12px' }}>
          👁 Aperçu : voici ce que voit <b>{session.name}</b>. Lecture seule, aucune demande ne peut être envoyée.
        </div>
      )}

      {/* ── Légende ── */}
      <div style={s.legend}>
        <span style={s.dot('#16a34a')} /> Dispo
        <span style={s.dot('#f59e0b')} /> Demandé
        <span style={s.dot('#6366f1')} /> Confirmé
      </div>

      {/* ── Navigation semaine ── */}
      <div style={s.weekNav}>
        <button onClick={prevWeek} disabled={!canPrev} style={s.navBtn}>‹</button>
        <span style={s.weekLabel}>
          {formatDate(days[0])} — {formatDate(days[6])}
        </span>
        <button onClick={nextWeek} style={s.navBtn}>›</button>
      </div>

      {/* ── Grille hebdomadaire (lignes fixes par horaire) ── */}
      {calLoading ? (
        <p style={{ textAlign: 'center', color: '#94a3b8', padding: 24 }}>Chargement…</p>
      ) : (() => {
        // Jours visibles (aujourd'hui + futur uniquement)
        const visibleDays = days.filter(d => d >= today())

        // Collecter tous les horaires distincts toutes colonnes confondues,
        // triés chronologiquement — ce sont les lignes fixes de la grille
        const allTimes = [...new Set(
          slots.map(sl => sl.slot_time.slice(0, 5))
        )].sort()

        // Index rapide : slotsByDay[date][HH:MM] → slot object
        const slotIndex = {}
        slots.forEach(sl => {
          const d = sl.slot_date
          const t = sl.slot_time.slice(0, 5)
          if (!slotIndex[d]) slotIndex[d] = {}
          slotIndex[d][t] = sl
        })

        // Flights this structure booked with the pilot: flightIndex[date][HH:MM]
        const flightIndex = {}
        flights.forEach(f => {
          const t = String(f.slot_time).slice(0, 5)
          if (!flightIndex[f.slot_date]) flightIndex[f.slot_date] = {}
          flightIndex[f.slot_date][t] = f
        })

        return (
          <div style={{ overflowX: 'auto', padding: '0 8px', marginTop: 2 }}>
            {/* Table : 1re colonne = heure, puis 1 colonne par jour */}
            <table style={{ borderCollapse: 'separate', borderSpacing: '3px 4px', width: '100%', tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  {/* Cellule vide coin supérieur gauche */}
                  <th style={{ width: 32 }} />
                  {visibleDays.map(date => {
                    const isToday = date === today()
                    return (
                      <th key={date} style={{
                        ...s.dayHeader,
                        padding: '4px 2px 6px',
                        color: isToday ? '#38bdf8' : '#475569',
                      }}>
                        {formatDate(date)}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {allTimes.map(time => (
                  <tr key={time}>
                    {/* Colonne heure */}
                    <td style={{ fontSize: 9, color: '#475569', fontWeight: 700, textAlign: 'right', paddingRight: 5, whiteSpace: 'nowrap', verticalAlign: 'middle', letterSpacing: '0.02em' }}>
                      {time}
                    </td>
                    {/* Une cellule par jour */}
                    {visibleDays.map(date => {
                      const slot = slotIndex[date]?.[time]

                      // Cellule vide : pas de créneau ce jour à cette heure
                      if (!slot) return <td key={date} />

                      // Vol déjà réservé par cette structure : case blanche avec son logo
                      const flight = flightIndex[date]?.[time]
                      if (flight) {
                        const confirmed = flight.status === 'confirmed'
                        return (
                          <td key={date} style={{ padding: 0 }}>
                            <button disabled style={{
                              ...s.slotBtn, width: '100%', cursor: 'default',
                              // Same size as the other cells; the status colour is an inner outline
                              background: flight.logo_url ? `#fff url(${flight.logo_url}) center / 58% no-repeat` : '#fff',
                              boxShadow: `inset 0 0 0 2px ${confirmed ? '#6366f1' : '#f59e0b'}`,
                              color: '#0f172a',
                            }}>
                              <span style={{ fontWeight: 800, fontSize: 11, textShadow: '0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff' }}>{time}</span>
                              <span style={{ fontSize: 8, marginTop: 1, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: confirmed ? '#4338ca' : '#b45309', textShadow: '0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff' }}>
                                {confirmed ? 'Confirmé ✓' : 'En attente'}{flight.pax > 1 ? ` · ${flight.pax}` : ''}
                              </span>
                            </button>
                          </td>
                        )
                      }

                      // Créneau caché (pas dispo ou occupé sans relation avec ce collègue)
                      const visible = (slot.is_available && !slot.is_booked) || slot.my_request_status
                      if (!visible) return <td key={date} />

                      const canRequest = slot.is_available && !slot.is_booked && !slot.my_request_status
                      const { bg, label } = slotAppearance(slot)

                      return (
                        <td key={date} style={{ padding: 0 }}>
                          <button
                            onClick={() => canRequest && openRequest(slot)}
                            disabled={!canRequest}
                            style={{
                              ...s.slotBtn,
                              background: `linear-gradient(135deg, ${bg}, ${bg}cc)`,
                              cursor: canRequest ? 'pointer' : 'default',
                              width: '100%',
                              opacity: canRequest ? 1 : 0.75,
                            }}
                          >
                            <span style={{ fontWeight: 800, fontSize: 11, letterSpacing: '0.01em' }}>{time}</span>
                            <span style={{ fontSize: 8, marginTop: 1, opacity: 0.8, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })()}

      {/* ── Message au pilote ── */}
      <div style={{ padding: '20px 16px 0' }}>
        <h2 style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, height: 1, background: '#1e293b' }} />
          Envoyer un message
          <span style={{ flex: 1, height: 1, background: '#1e293b' }} />
        </h2>
        <form onSubmit={sendMessage} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={msgBody}
            onChange={e => setMsgBody(e.target.value)}
            placeholder={`Message pour ${session.pilotName || 'le pilote'}…`}
            maxLength={1000}
            rows={3}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#1e293b', border: '1px solid #334155',
              borderRadius: 10, padding: '10px 12px',
              color: '#e2e8f0', fontSize: 14, fontFamily: 'inherit',
              resize: 'none', outline: 'none',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 10, color: '#475569' }}>{msgBody.length}/1000</span>
            {msgSent && (
              <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>✓ Message envoyé !</span>
            )}
            {msgError && (
              <span style={{ fontSize: 12, color: '#f87171' }}>{msgError}</span>
            )}
            <button
              type="submit"
              disabled={msgSending || !msgBody.trim()}
              style={{
                background: msgBody.trim() ? '#22c55e' : '#334155',
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '8px 18px', fontSize: 13, fontWeight: 700,
                cursor: msgBody.trim() ? 'pointer' : 'default',
                transition: 'background 0.2s',
                fontFamily: 'inherit',
              }}
            >
              {msgSending ? 'Envoi…' : 'Envoyer'}
            </button>
          </div>
        </form>
      </div>

      {/* ── Historique des demandes ── */}
      <div style={{ padding: '20px 16px 8px' }}>
        <h2 style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, height: 1, background: '#1e293b' }} />
          Historique de vos demandes
          <span style={{ flex: 1, height: 1, background: '#1e293b' }} />
        </h2>

        {histLoading ? (
          <p style={{ color: '#475569', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>Chargement…</p>
        ) : history.length === 0 ? (
          <p style={{ color: '#334155', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
            Aucune demande pour l'instant.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.map(req => {
              const { bg, label } = historyAppearance(req.status)
              return (
                <div key={req.request_id} style={{
                  background: '#1e293b',
                  borderRadius: 10,
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}>
                  {/* Date + heure */}
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>
                      {formatDate(req.slot_date)}
                    </div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                      🕐 {formatTime(req.slot_time)}
                      {req.note ? <span style={{ marginLeft: 8, fontStyle: 'italic' }}>« {req.note} »</span> : null}
                    </div>
                  </div>
                  {/* Badge statut */}
                  <span style={{
                    background: bg,
                    color: '#fff',
                    borderRadius: 20,
                    padding: '4px 12px',
                    fontSize: 11,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}>
                    {label}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Modal demande ── */}
      {requestSlot && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && setRequestSlot(null)}>
          <div style={s.modal}>
            {requestDone ? (
              <>
                <div style={{ fontSize: 44, textAlign: 'center' }}>✅</div>
                <h3 style={s.modalTitle}>Demande envoyée !</h3>
                <p style={s.modalSub}>
                  {formatDate(requestSlot.slot_date)} à {formatTime(requestSlot.slot_time)}<br />
                  Vous serez notifié de la réponse.
                </p>
              </>
            ) : (
              <>
                <h3 style={s.modalTitle}>Demander ce créneau</h3>
                <p style={s.modalSub}>
                  📅 {formatDate(requestSlot.slot_date)}<br />
                  🕐 {formatTime(requestSlot.slot_time)}
                </p>

                <form onSubmit={handleRequest}>
                  <div style={s.field}>
                    <label style={s.label}>Note pour le pilote (optionnel)</label>
                    <textarea
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      style={{ ...s.input, height: 80, resize: 'vertical' }}
                      placeholder="Ex : RV à 9h15, covoiturage avec Bernard…"
                      maxLength={300}
                    />
                  </div>

                  {requestError && <p style={s.error}>{requestError}</p>}

                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => setRequestSlot(null)}
                      style={s.btnGrey}
                    >
                      Annuler
                    </button>
                    <button type="submit" disabled={requestSaving} style={s.btnGreen}>
                      {requestSaving ? 'Envoi…' : 'Envoyer la demande'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </Screen>
  )
}

// ── Couleur et libellé d'un créneau selon son statut ─────────────────────
function slotAppearance(slot) {
  if (slot.my_request_status === 'accepted') return { bg: '#6366f1', label: 'Confirmé' }
  if (slot.my_request_status === 'pending')  return { bg: '#f59e0b', label: 'Demandé' }
  if (!slot.is_available)                    return { bg: '#dc2626', label: 'Non dispo' }
  if (slot.is_booked)                        return { bg: '#94a3b8', label: 'Occupé' }
  return { bg: '#16a34a', label: 'Dispo' }
}

// ── Couleur et libellé d'une entrée historique ────────────────────────────
function historyAppearance(status) {
  if (status === 'accepted') return { bg: '#6366f1', label: 'Confirmé ✓' }
  if (status === 'refused')  return { bg: '#dc2626', label: 'Refusé' }
  return { bg: '#f59e0b', label: 'En attente' }
}

// ── Composant enveloppant ─────────────────────────────────────────────────
function Screen({ children }) {
  return (
    <div style={{
      minHeight: '100dvh',
      background: 'linear-gradient(160deg, #0c1628 0%, #0f172a 60%, #111827 100%)',
      color: '#f1f5f9',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      paddingBottom: 40,
    }}>
      {children}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────
const s = {
  // ─ Login ─
  loginCard: {
    background: '#1e293b',
    borderRadius: 20,
    padding: '32px 24px',
    maxWidth: 380,
    width: '90%',
    margin: '60px auto 0',
    boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
  },
  loginTitle: {
    textAlign: 'center',
    margin: '4px 0 4px',
    fontSize: 26,
    fontWeight: 800,
    color: '#f1f5f9',
  },
  loginSub: {
    textAlign: 'center',
    color: '#64748b',
    fontSize: 13,
    marginBottom: 24,
  },
  // ─ Header ─
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px 12px',
    background: 'rgba(30,41,59,0.85)',
    backdropFilter: 'blur(12px)',
    borderBottom: '1px solid rgba(51,65,85,0.6)',
    boxShadow: '0 2px 16px rgba(0,0,0,0.3)',
  },
  headerTitle: { fontSize: 18, fontWeight: 800, color: '#f1f5f9' },
  headerSub:   { fontSize: 12, color: '#64748b', marginTop: 2 },
  logoutBtn: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: '#94a3b8',
    borderRadius: 8,
    padding: '5px 12px',
    fontSize: 11,
    cursor: 'pointer',
    fontWeight: 500,
    letterSpacing: '0.02em',
  },
  // ─ Légende ─
  legend: {
    display: 'flex',
    gap: 16,
    padding: '8px 16px 6px',
    fontSize: 10,
    color: '#94a3b8',
    flexWrap: 'wrap',
    alignItems: 'center',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    fontWeight: 600,
  },
  dot: (color) => ({
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: color,
    marginRight: 5,
    boxShadow: `0 0 5px ${color}80`,
  }),
  // ─ Navigation semaine ─
  weekNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px 10px',
    gap: 8,
  },
  weekLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: '#e2e8f0',
    textAlign: 'center',
    flex: 1,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  },
  navBtn: {
    background: 'rgba(30,41,59,0.8)',
    border: '1px solid rgba(71,85,105,0.5)',
    color: '#94a3b8',
    borderRadius: 10,
    padding: '6px 16px',
    fontSize: 16,
    cursor: 'pointer',
    lineHeight: 1,
  },
  // ─ Grille ─
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 4,
    padding: '0 8px',
    overflowX: 'auto',
    minWidth: 0,
  },
  dayCard: {
    background: '#1e293b',
    borderRadius: 10,
    padding: '6px 4px',
    minWidth: 44,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    alignItems: 'center',
  },
  dayHeader: {
    fontSize: 9,
    fontWeight: 700,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    textAlign: 'center',
    marginBottom: 2,
    lineHeight: 1.4,
  },
  noSlot: {
    color: '#334155',
    fontSize: 16,
    textAlign: 'center',
    padding: '4px 0',
  },
  slotBtn: {
    width: '100%',
    border: 'none',
    borderRadius: 7,
    padding: '5px 3px',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    transition: 'filter 0.15s, transform 0.1s',
    fontFamily: 'inherit',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  },
  // ─ Modal ─
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    zIndex: 100,
  },
  modal: {
    background: '#1e293b',
    borderRadius: '20px 20px 0 0',
    padding: '24px 20px 32px',
    width: '100%',
    maxWidth: 480,
    boxShadow: '0 -4px 32px rgba(0,0,0,0.4)',
  },
  modalTitle: {
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 700,
    margin: '8px 0 4px',
    color: '#f1f5f9',
  },
  modalSub: {
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 1.6,
    marginBottom: 16,
  },
  // ─ Formulaires ─
  field: { marginBottom: 14 },
  label: {
    display: 'block',
    fontSize: 11,
    fontWeight: 600,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    background: '#0f172a',
    border: '1.5px solid #334155',
    borderRadius: 8,
    fontSize: 15,
    color: '#f1f5f9',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  error: {
    color: '#fca5a5',
    fontSize: 13,
    marginBottom: 10,
    background: '#7f1d1d33',
    padding: '8px 10px',
    borderRadius: 6,
  },
  btnGreen: {
    flex: 1,
    padding: '12px',
    background: '#16a34a',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnGrey: {
    flex: 1,
    padding: '12px',
    background: '#334155',
    color: '#94a3b8',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  // ─ Login page dark inputs (same as Login.jsx) ─
  inputDark: {
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
  btnWhite: {
    width: '100%',
    background: '#fff',
    color: '#000',
    border: 'none',
    borderRadius: 10,
    fontSize: 16,
    fontWeight: 700,
    padding: '13px 16px',
    cursor: 'pointer',
    marginTop: 4,
    fontFamily: 'inherit',
  },
}
