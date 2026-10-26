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

// ── Composant principal ───────────────────────────────────────────────────
export default function ColleagueDispo() {
  // Session du collègue (localStorage)
  const [session, setSession]       = useState(null)   // { colleague_id, pilot_id, name }
  const [authLoading, setAuthLoading] = useState(true)

  // Formulaire de connexion
  const [loginName, setLoginName]   = useState('')
  const [loginPwd, setLoginPwd]     = useState('')
  const [loginError, setLoginError] = useState(null)
  const [loginSaving, setLoginSaving] = useState(false)

  // Calendrier
  const [weekStart, setWeekStart]   = useState(() => today())
  const [slots, setSlots]           = useState([])     // []{ slot_id, slot_date, slot_time, is_available, is_booked, my_request_status }
  const [calLoading, setCalLoading] = useState(false)

  // Modal de demande
  const [requestSlot, setRequestSlot] = useState(null) // slot sélectionné
  const [note, setNote]               = useState('')
  const [requestSaving, setRequestSaving] = useState(false)
  const [requestError, setRequestError]   = useState(null)
  const [requestDone, setRequestDone]     = useState(false)

  // ── Charger la session depuis localStorage ────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem('colleagueSession')
      if (raw) {
        const s = JSON.parse(raw)
        if (s?.colleague_id && s?.pilot_id) setSession(s)
      }
    } catch { /* ignore */ }
    setAuthLoading(false)
  }, [])

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
    const newSession = { colleague_id, pilot_id, name: loginName.trim() }

    try { localStorage.setItem('colleagueSession', JSON.stringify(newSession)) } catch { }

    setSession(newSession)
    setLoginSaving(false)
  }

  // ── Déconnexion ───────────────────────────────────────────────────────
  function handleLogout() {
    try { localStorage.removeItem('colleagueSession') } catch { }
    setSession(null)
    setSlots([])
  }

  // ── Ouvrir le modal de demande ────────────────────────────────────────
  function openRequest(slot) {
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

    setTimeout(() => setRequestSlot(null), 2000)
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
        <img src="/logo-text.png" alt="Dispo Pas Dispo" style={{ height: 36, display: 'block' }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>{session.name}</span>
          <button onClick={handleLogout} style={s.logoutBtn}>Déconnexion</button>
        </div>
      </div>

      {/* ── Légende ── */}
      <div style={s.legend}>
        <span style={s.dot('#16a34a')} /> Disponible
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

      {/* ── Grille hebdomadaire ── */}
      {calLoading ? (
        <p style={{ textAlign: 'center', color: '#94a3b8', padding: 24 }}>Chargement…</p>
      ) : (
        <div style={s.grid}>
          {days.map(date => {
            const daySlots = slotsByDay[date] || []
            const isPast   = date < today()

            // Ne pas afficher les jours passés
            if (isPast) return null

            return (
              <div key={date} style={s.dayCard}>
                {/* En-tête du jour */}
                <div style={s.dayHeader}>{formatDate(date)}</div>

                {/* Créneaux */}
                {daySlots.length === 0 ? (
                  <div style={s.noSlot}>—</div>
                ) : (
                  daySlots
                    // Ne montrer que les créneaux disponibles (pas dispo masqués)
                    // + les créneaux déjà demandés/confirmés par ce collègue
                    .filter(slot =>
                      (slot.is_available && !slot.is_booked) || slot.my_request_status
                    )
                    .map(slot => {
                    const canRequest = slot.is_available && !slot.is_booked
                      && !slot.my_request_status

                    const { bg, label } = slotAppearance(slot)

                    return (
                      <button
                        key={slot.slot_id}
                        onClick={() => canRequest && openRequest(slot)}
                        disabled={!canRequest}
                        style={{
                          ...s.slotBtn,
                          background: bg,
                          cursor: canRequest ? 'pointer' : 'default',
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: 14 }}>
                          {formatTime(slot.slot_time)}
                        </span>
                        <span style={{ fontSize: 11, marginTop: 2 }}>{label}</span>
                      </button>
                    )
                  })
                )}
              </div>
            )
          })}
        </div>
      )}

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
  if (slot.my_request_status === 'pending')  return { bg: '#f59e0b', label: 'En attente' }
  if (!slot.is_available)                    return { bg: '#dc2626', label: 'Non dispo' }
  if (slot.is_booked)                        return { bg: '#94a3b8', label: 'Occupé' }
  return { bg: '#16a34a', label: 'Disponible' }
}

// ── Composant enveloppant ─────────────────────────────────────────────────
function Screen({ children }) {
  return (
    <div style={{
      minHeight: '100dvh',
      background: '#0f172a',
      color: '#f1f5f9',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      paddingBottom: 32,
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
    padding: '16px 16px 8px',
    background: '#1e293b',
    borderBottom: '1px solid #334155',
  },
  headerTitle: { fontSize: 18, fontWeight: 800, color: '#f1f5f9' },
  headerSub:   { fontSize: 12, color: '#64748b', marginTop: 2 },
  logoutBtn: {
    background: 'transparent',
    border: '1px solid #334155',
    color: '#94a3b8',
    borderRadius: 6,
    padding: '5px 10px',
    fontSize: 12,
    cursor: 'pointer',
  },
  // ─ Légende ─
  legend: {
    display: 'flex',
    gap: 14,
    padding: '8px 16px',
    fontSize: 11,
    color: '#94a3b8',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  dot: (color) => ({
    display: 'inline-block',
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: color,
    marginRight: 4,
  }),
  // ─ Navigation semaine ─
  weekNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    gap: 8,
  },
  weekLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: '#cbd5e1',
    textAlign: 'center',
    flex: 1,
  },
  navBtn: {
    background: '#1e293b',
    border: '1px solid #334155',
    color: '#94a3b8',
    borderRadius: 8,
    padding: '6px 14px',
    fontSize: 18,
    cursor: 'pointer',
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
    fontSize: 10,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    textAlign: 'center',
    marginBottom: 2,
    lineHeight: 1.3,
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
    padding: '6px 4px',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    transition: 'filter 0.15s',
    fontFamily: 'inherit',
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
