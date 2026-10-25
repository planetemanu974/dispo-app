// ColleaguePanel.jsx — Panneau de gestion des collègues (pour le pilote)
// Inclus dans Dashboard.jsx via : <ColleaguePanel pilot={pilot} />
// Fonctions : inviter une structure, voir/gérer les demandes entrantes
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const MONTHS_FR = ['jan', 'fév', 'mar', 'avr', 'mai', 'jun', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc']

function fmtDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  const days = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']
  return `${days[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]}`
}
function fmtTime(t) { return t ? t.slice(0, 5) : '' }

export default function ColleaguePanel({ pilot }) {
  const [open, setOpen]             = useState(false)
  const [tab, setTab]               = useState('requests')  // 'requests' | 'colleagues'

  // ── Demandes entrantes ────────────────────────────────────────────────
  const [requests, setRequests]     = useState([])
  const [reqLoading, setReqLoading] = useState(false)

  // ── Collègues (liste) ─────────────────────────────────────────────────
  const [colleagues, setColleagues] = useState([])
  const [colLoading, setColLoading] = useState(false)

  // ── Modal d'invitation ────────────────────────────────────────────────
  const [showInvite, setShowInvite] = useState(false)
  const [inviteName, setInviteName] = useState('')
  const [inviteLink, setInviteLink] = useState(null)
  const [inviteSaving, setInviteSaving] = useState(false)
  const [inviteError, setInviteError]   = useState(null)

  // ── Charger demandes et collègues quand le panneau s'ouvre ────────────
  const loadRequests = useCallback(async () => {
    setReqLoading(true)
    const { data } = await supabase.rpc('get_colleague_requests', {
      p_pilot_id: pilot.id,
    })
    setRequests(data || [])
    setReqLoading(false)
  }, [pilot.id])

  const loadColleagues = useCallback(async () => {
    setColLoading(true)
    const { data } = await supabase
      .from('colleagues')
      .select('id, name, active, invite_used, created_at')
      .eq('pilot_id', pilot.id)
      .order('created_at', { ascending: false })
    setColleagues(data || [])
    setColLoading(false)
  }, [pilot.id])

  useEffect(() => {
    if (!open) return
    loadRequests()
    loadColleagues()
  }, [open, loadRequests, loadColleagues])

  // Nombre de demandes en attente (pour le badge)
  const pendingCount = requests.filter(r => r.status === 'pending').length

  // ── Accepter / refuser une demande ────────────────────────────────────
  async function handleDecision(requestId, newStatus) {
    await supabase.rpc('update_colleague_request', {
      p_request_id: requestId,
      p_status:     newStatus,
    })
    // Mettre à jour localement
    setRequests(prev => prev.map(r =>
      r.request_id === requestId ? { ...r, status: newStatus } : r
    ))
  }

  // ── Créer un lien d'invitation ────────────────────────────────────────
  async function handleCreateInvite(e) {
    e.preventDefault()
    if (!inviteName.trim()) return
    setInviteSaving(true)
    setInviteError(null)

    const { data, error } = await supabase
      .from('colleagues')
      .insert({ pilot_id: pilot.id, name: inviteName.trim() })
      .select('invite_token')
      .single()

    if (error || !data) {
      setInviteError('Erreur lors de la création du lien. Réessayez.')
      setInviteSaving(false)
      return
    }

    const link = `${window.location.origin}/join?token=${data.invite_token}`
    setInviteLink(link)
    setInviteSaving(false)
    loadColleagues()
  }

  // ── Révoquer l'accès d'un collègue ───────────────────────────────────
  async function handleRevoke(colleagueId) {
    if (!window.confirm('Révoquer l\'accès de ce collègue ?')) return
    await supabase
      .from('colleagues')
      .update({ active: false })
      .eq('id', colleagueId)
      .eq('pilot_id', pilot.id)
    loadColleagues()
  }

  // ── Réactiver ─────────────────────────────────────────────────────────
  async function handleReactivate(colleagueId) {
    await supabase
      .from('colleagues')
      .update({ active: true })
      .eq('id', colleagueId)
      .eq('pilot_id', pilot.id)
    loadColleagues()
  }

  // ── Copier le lien ────────────────────────────────────────────────────
  function copyLink(link) {
    navigator.clipboard.writeText(link).catch(() => {
      // fallback : sélectionner le texte
      const el = document.querySelector('[data-invite-link]')
      if (el) { el.select(); document.execCommand('copy') }
    })
  }

  // ── Rendu ─────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Bouton flottant dans le header (badge si demandes en attente) */}
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'relative',
          background: open ? '#1d4ed8' : '#1e293b',
          border: '1px solid #334155',
          color: '#f1f5f9',
          borderRadius: 10,
          padding: '7px 12px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        🤝 Collègues
        {pendingCount > 0 && (
          <span style={{
            background: '#dc2626',
            color: '#fff',
            borderRadius: '50%',
            width: 18,
            height: 18,
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
          }}>
            {pendingCount}
          </span>
        )}
      </button>

      {/* ── Drawer / panneau ─────────────────────────────────────────────── */}
      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 200,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
          onClick={e => e.target === e.currentTarget && setOpen(false)}
        >
          <div style={{
            background: '#0f172a',
            borderRadius: '20px 20px 0 0',
            padding: '20px 0 env(safe-area-inset-bottom, 16px)',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* En-tête drawer */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 16px 12px',
              borderBottom: '1px solid #1e293b',
            }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#f1f5f9' }}>
                🤝 Structures collègues
              </h2>
              <button
                onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}
              >
                ×
              </button>
            </div>

            {/* Onglets */}
            <div style={{ display: 'flex', borderBottom: '1px solid #1e293b' }}>
              {[
                { id: 'requests', label: `Demandes${pendingCount > 0 ? ` (${pendingCount})` : ''}` },
                { id: 'colleagues', label: 'Mes collègues' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: 'none',
                    border: 'none',
                    borderBottom: tab === t.id ? '2px solid #3b82f6' : '2px solid transparent',
                    color: tab === t.id ? '#3b82f6' : '#64748b',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Contenu scrollable */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '0 16px' }}>

              {/* ── Onglet : Demandes ────────────────────────────────── */}
              {tab === 'requests' && (
                <div style={{ paddingTop: 12 }}>
                  {reqLoading ? (
                    <p style={s.muted}>Chargement…</p>
                  ) : requests.length === 0 ? (
                    <p style={s.muted}>Aucune demande pour l'instant.</p>
                  ) : (
                    requests.map(r => (
                      <div key={r.request_id} style={{
                        background: '#1e293b',
                        borderRadius: 12,
                        padding: '12px',
                        marginBottom: 10,
                        borderLeft: `4px solid ${r.status === 'pending' ? '#f59e0b' : r.status === 'accepted' ? '#16a34a' : '#94a3b8'}`,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 14 }}>
                            {r.colleague_name}
                          </span>
                          <StatusBadge status={r.status} />
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 4 }}>
                          📅 {fmtDate(r.slot_date)} · 🕐 {fmtTime(r.slot_time)}
                        </div>
                        {r.note && (
                          <div style={{
                            background: '#0f172a',
                            borderRadius: 6,
                            padding: '6px 8px',
                            fontSize: 13,
                            color: '#cbd5e1',
                            marginBottom: 8,
                            fontStyle: 'italic',
                          }}>
                            💬 {r.note}
                          </div>
                        )}
                        {r.status === 'pending' && (
                          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                            <button
                              onClick={() => handleDecision(r.request_id, 'accepted')}
                              style={s.btnAccept}
                            >
                              ✓ Accepter
                            </button>
                            <button
                              onClick={() => handleDecision(r.request_id, 'refused')}
                              style={s.btnRefuse}
                            >
                              ✗ Refuser
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* ── Onglet : Mes collègues ────────────────────────────── */}
              {tab === 'colleagues' && (
                <div style={{ paddingTop: 12 }}>
                  {/* Bouton inviter */}
                  <button
                    onClick={() => { setShowInvite(true); setInviteName(''); setInviteLink(null); setInviteError(null) }}
                    style={s.btnInvite}
                  >
                    + Inviter une structure
                  </button>

                  {/* Liste des collègues */}
                  {colLoading ? (
                    <p style={s.muted}>Chargement…</p>
                  ) : colleagues.length === 0 ? (
                    <p style={s.muted}>Aucun collègue invité pour l'instant.</p>
                  ) : (
                    colleagues.map(c => (
                      <div key={c.id} style={{
                        background: '#1e293b',
                        borderRadius: 10,
                        padding: '10px 12px',
                        marginBottom: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        opacity: c.active ? 1 : 0.5,
                      }}>
                        <div>
                          <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: 14 }}>
                            {c.name || <em style={{ color: '#64748b' }}>Sans nom</em>}
                          </div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                            {c.invite_used ? '✅ Compte créé' : '⏳ Lien non utilisé'}
                            {!c.active && ' · Accès révoqué'}
                          </div>
                        </div>
                        {c.active ? (
                          <button
                            onClick={() => handleRevoke(c.id)}
                            style={s.btnSmallRed}
                          >
                            Révoquer
                          </button>
                        ) : (
                          <button
                            onClick={() => handleReactivate(c.id)}
                            style={s.btnSmallGreen}
                          >
                            Réactiver
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal : créer un lien d'invitation ───────────────────────────── */}
      {showInvite && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            zIndex: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={e => e.target === e.currentTarget && setShowInvite(false)}
        >
          <div style={{
            background: '#1e293b',
            borderRadius: 16,
            padding: '24px 20px',
            maxWidth: 380,
            width: '100%',
          }}>
            <h3 style={{ margin: '0 0 16px', color: '#f1f5f9', fontSize: 16, fontWeight: 700 }}>
              🔗 Inviter une structure
            </h3>

            {!inviteLink ? (
              <form onSubmit={handleCreateInvite}>
                <label style={s.label}>Nom de la structure collègue</label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={e => setInviteName(e.target.value)}
                  style={s.input}
                  placeholder="Ex : 974 Parapente"
                  autoFocus
                  required
                />
                <p style={{ color: '#64748b', fontSize: 12, margin: '8px 0 16px' }}>
                  Ce nom sera utilisé pour se connecter à l'application.
                </p>

                {inviteError && <p style={s.error}>{inviteError}</p>}

                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="button" onClick={() => setShowInvite(false)} style={s.btnGrey}>
                    Annuler
                  </button>
                  <button type="submit" disabled={inviteSaving} style={s.btnGreen}>
                    {inviteSaving ? 'Création…' : 'Créer le lien'}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
                  Envoyez ce lien à <strong style={{ color: '#f1f5f9' }}>{inviteName}</strong>.
                  Il lui permettra de créer son accès.
                </p>
                <div style={{
                  background: '#0f172a',
                  borderRadius: 8,
                  padding: '10px 12px',
                  marginBottom: 12,
                  wordBreak: 'break-all',
                  fontSize: 12,
                  color: '#94a3b8',
                }}>
                  <input
                    data-invite-link
                    readOnly
                    value={inviteLink}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      width: '100%',
                      color: '#94a3b8',
                      fontSize: 12,
                      fontFamily: 'monospace',
                      outline: 'none',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => copyLink(inviteLink)}
                    style={s.btnGreen}
                  >
                    📋 Copier le lien
                  </button>
                  <button onClick={() => setShowInvite(false)} style={s.btnGrey}>
                    Fermer
                  </button>
                </div>
                <p style={{ color: '#64748b', fontSize: 11, marginTop: 10 }}>
                  ⚠️ Ce lien est à usage unique. Générez-en un nouveau si nécessaire.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ── Badge de statut ───────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    pending:  { bg: '#f59e0b22', color: '#f59e0b', label: 'En attente' },
    accepted: { bg: '#16a34a22', color: '#16a34a', label: 'Accepté' },
    refused:  { bg: '#94a3b822', color: '#94a3b8', label: 'Refusé' },
  }
  const m = map[status] || map.pending
  return (
    <span style={{
      background: m.bg,
      color: m.color,
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 20,
    }}>
      {m.label}
    </span>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────
const s = {
  muted: { color: '#64748b', fontSize: 13, textAlign: 'center', padding: '20px 0' },
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
    fontSize: 14,
    color: '#f1f5f9',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    marginBottom: 4,
  },
  error: {
    color: '#fca5a5',
    fontSize: 12,
    marginBottom: 10,
    background: '#7f1d1d33',
    padding: '6px 8px',
    borderRadius: 6,
  },
  btnGreen: {
    flex: 1,
    padding: '10px',
    background: '#16a34a',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnGrey: {
    flex: 1,
    padding: '10px',
    background: '#334155',
    color: '#94a3b8',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnAccept: {
    flex: 1,
    padding: '8px',
    background: '#16a34a',
    color: '#fff',
    border: 'none',
    borderRadius: 7,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnRefuse: {
    flex: 1,
    padding: '8px',
    background: '#334155',
    color: '#fca5a5',
    border: 'none',
    borderRadius: 7,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnInvite: {
    width: '100%',
    padding: '11px',
    background: '#1d4ed8',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    marginBottom: 16,
    fontFamily: 'inherit',
  },
  btnSmallRed: {
    background: '#7f1d1d44',
    color: '#fca5a5',
    border: 'none',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnSmallGreen: {
    background: '#14532d44',
    color: '#86efac',
    border: 'none',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
}