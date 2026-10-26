// ColleaguePanel.jsx — Panneau de gestion des collègues (pour le pilote)
// Inclus dans Dashboard.jsx via : <ColleaguePanel pilot={pilot} />
// Fonctions : inviter une structure, voir/gérer les demandes entrantes, émettre des factures
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { jsPDF } from 'jspdf'

// ── Constantes pilote (informations de facturation) ───────────────────────────
// Ces infos figurent sur toutes les factures émises par le pilote.
const PILOT_INFO = {
  name:    'Emmanuel SAGET',
  address: '44A rue du Général de Gaulle',
  city:    '97426 LES TROIS BASSINS',
  siret:   '490 613 452 00047',
  phone:   '0692 20 09 61',
}

const MONTHS_FR = ['jan', 'fév', 'mar', 'avr', 'mai', 'jun', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc']

function fmtDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  const days = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']
  return `${days[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]}`
}
function fmtTime(t) { return t ? t.slice(0, 5) : '' }

// Formatte une date ISO (YYYY-MM-DD) en DD/MM/YYYY pour l'affichage
function fmtDateFR(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

// Retourne la date du jour au format YYYY-MM-DD (pour les inputs date)
function todayISO() {
  return new Date().toISOString().split('T')[0]
}

// Génère le préfixe DDMMYY d'un numéro de facture à partir d'une date ISO
function invoiceDatePrefix(dateISO) {
  const [y, m, d] = dateISO.split('-')
  return `${d}${m}${y.slice(2)}`
}

// ── Génération du PDF de facture ──────────────────────────────────────────────
function generateInvoicePDF({ invoiceNumber, invoiceDate, amount, designation, colleague }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const pageW = 210
  const margin = 20

  // ── En-tête : coordonnées du pilote ──────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(PILOT_INFO.name, margin, 25)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(PILOT_INFO.address, margin, 31)
  doc.text(PILOT_INFO.city,    margin, 36)
  doc.text(`Tél : ${PILOT_INFO.phone}`, margin, 41)

  // ── SIRET ─────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(`SIRET : ${PILOT_INFO.siret}`, margin, 48)

  // ── Titre FACTURE ─────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('FACTURE', pageW / 2, 65, { align: 'center' })

  // ── Numéro et date ────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`N° ${invoiceNumber}`, pageW - margin, 55, { align: 'right' })
  doc.text(`Date : ${fmtDateFR(invoiceDate)}`, pageW - margin, 61, { align: 'right' })

  // ── Destinataire ──────────────────────────────────────────────────────────
  const destX = pageW - margin - 80
  const destY = 72
  doc.setDrawColor(180, 180, 180)
  doc.rect(destX, destY - 5, 82, 32)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('Destinataire :', destX + 3, destY + 1)
  doc.setFont('helvetica', 'normal')
  doc.text(colleague.name || '', destX + 3, destY + 7)
  if (colleague.address) doc.text(colleague.address, destX + 3, destY + 13)
  if (colleague.siret)   doc.text(`SIRET : ${colleague.siret}`, destX + 3, destY + 19)

  // ── Ligne de séparation ───────────────────────────────────────────────────
  doc.setDrawColor(0, 0, 0)
  doc.line(margin, 112, pageW - margin, 112)

  // ── En-tête du tableau ────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('Désignation', margin, 120)
  doc.text('Montant HT', pageW - margin, 120, { align: 'right' })
  doc.line(margin, 123, pageW - margin, 123)

  // ── Ligne de prestation ───────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(designation, margin, 132)
  doc.text(`${Number(amount).toFixed(2)} €`, pageW - margin, 132, { align: 'right' })

  // ── Ligne de séparation bas tableau ──────────────────────────────────────
  doc.line(margin, 137, pageW - margin, 137)

  // ── Mention TVA non applicable ────────────────────────────────────────────
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.text('TVA non applicable — art. 293 B du CGI', margin, 143)

  // ── Total ─────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('TOTAL TTC :', pageW - margin - 50, 152)
  doc.text(`${Number(amount).toFixed(2)} €`, pageW - margin, 152, { align: 'right' })
  doc.rect(pageW - margin - 52, 146, 54, 10)

  // ── Pied de page ─────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(100)
  doc.text('Merci pour votre confiance.', pageW / 2, 270, { align: 'center' })

  return doc
}

// ── Composant principal ───────────────────────────────────────────────────────
// forceOpen: si passé en prop, le panneau s'ouvre quand la valeur devient true
// onClose: callback quand le panneau se ferme (pour que le parent reset forceOpen)
export default function ColleaguePanel({ pilot, forceOpen, onClose }) {
  const [open, setOpen] = useState(false)

  // Sync avec le prop forceOpen du parent (ex : menu latéral)
  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])

  const [tab, setTab] = useState('requests')  // 'requests' | 'colleagues'

  // ── Demandes entrantes ────────────────────────────────────────────────────
  const [requests, setRequests]     = useState([])
  const [reqLoading, setReqLoading] = useState(false)

  // ── Collègues (liste) ─────────────────────────────────────────────────────
  const [colleagues, setColleagues] = useState([])
  const [colLoading, setColLoading] = useState(false)

  // ── Modal d'invitation ────────────────────────────────────────────────────
  const [showInvite, setShowInvite] = useState(false)
  const [inviteName, setInviteName] = useState('')
  const [inviteLink, setInviteLink] = useState(null)
  const [inviteSaving, setInviteSaving] = useState(false)
  const [inviteError, setInviteError]   = useState(null)

  // ── Modal de facture ──────────────────────────────────────────────────────
  const [invoiceColleague, setInvoiceColleague] = useState(null)  // colleague sélectionné
  const [invoiceAmount,    setInvoiceAmount]    = useState('')
  const [invoiceDate,      setInvoiceDate]      = useState(todayISO())
  const [invoiceDesig,     setInvoiceDesig]     = useState('Prestation biplace')
  const [invoiceSaving,    setInvoiceSaving]    = useState(false)
  const [invoiceError,     setInvoiceError]     = useState(null)
  const [invoiceNumber,    setInvoiceNumber]    = useState(null)  // numéro calculé

  // ── Charger demandes et collègues quand le panneau s'ouvre ────────────────
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
      .select('id, name, address, siret, active, invite_used, created_at')
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

  // ── Accepter / refuser une demande ────────────────────────────────────────
  async function handleDecision(requestId, newStatus) {
    await supabase.rpc('update_colleague_request', {
      p_request_id: requestId,
      p_status:     newStatus,
    })
    setRequests(prev => prev.map(r =>
      r.request_id === requestId ? { ...r, status: newStatus } : r
    ))
  }

  // ── Créer un lien d'invitation ────────────────────────────────────────────
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

  // ── Révoquer l'accès d'un collègue ───────────────────────────────────────
  async function handleRevoke(colleagueId) {
    if (!window.confirm('Révoquer l\'accès de ce collègue ?')) return
    await supabase
      .from('colleagues')
      .update({ active: false })
      .eq('id', colleagueId)
      .eq('pilot_id', pilot.id)
    loadColleagues()
  }

  // ── Réactiver ─────────────────────────────────────────────────────────────
  async function handleReactivate(colleagueId) {
    await supabase
      .from('colleagues')
      .update({ active: true })
      .eq('id', colleagueId)
      .eq('pilot_id', pilot.id)
    loadColleagues()
  }

  const [copied, setCopied] = useState(false)

  // ── Copier le lien ────────────────────────────────────────────────────────
  function copyLink(link) {
    navigator.clipboard.writeText(link)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      })
      .catch(() => {
        const el = document.querySelector('[data-invite-link]')
        if (el) { el.select(); document.execCommand('copy') }
      })
  }

  // ── Ouvrir le modal de facture pour un collègue ───────────────────────────
  async function openInvoiceModal(colleague) {
    // Calculer le numéro de facture : DDMMYY/N
    const today = todayISO()
    const prefix = invoiceDatePrefix(today)

    // Compter les factures existantes avec ce préfixe
    const { count } = await supabase
      .from('colleague_invoices')
      .select('id', { count: 'exact', head: true })
      .eq('pilot_id', pilot.id)
      .ilike('invoice_number', `${prefix}/%`)

    const seq = (count || 0) + 1
    setInvoiceNumber(`${prefix}/${seq}`)
    setInvoiceColleague(colleague)
    setInvoiceAmount('')
    setInvoiceDate(today)
    setInvoiceDesig('Prestation biplace')
    setInvoiceError(null)
  }

  // ── Générer et sauvegarder la facture ─────────────────────────────────────
  async function handleGenerateInvoice(e) {
    e.preventDefault()
    if (!invoiceAmount || Number(invoiceAmount) <= 0) {
      setInvoiceError('Veuillez saisir un montant valide.')
      return
    }

    setInvoiceSaving(true)
    setInvoiceError(null)

    // Recalculer le numéro en cas de changement de date dans le modal
    const prefix = invoiceDatePrefix(invoiceDate)
    const { count } = await supabase
      .from('colleague_invoices')
      .select('id', { count: 'exact', head: true })
      .eq('pilot_id', pilot.id)
      .ilike('invoice_number', `${prefix}/%`)

    const seq = (count || 0) + 1
    const finalNumber = `${prefix}/${seq}`

    // Sauvegarder en base
    const { error } = await supabase
      .from('colleague_invoices')
      .insert({
        pilot_id:       pilot.id,
        colleague_id:   invoiceColleague.id,
        invoice_number: finalNumber,
        invoice_date:   invoiceDate,
        designation:    invoiceDesig,
        amount_eur:     Number(invoiceAmount),
      })

    if (error) {
      setInvoiceError('Erreur lors de la sauvegarde. Réessayez.')
      setInvoiceSaving(false)
      return
    }

    // Générer et télécharger le PDF
    const doc = generateInvoicePDF({
      invoiceNumber: finalNumber,
      invoiceDate,
      amount:      invoiceAmount,
      designation: invoiceDesig,
      colleague:   invoiceColleague,
    })

    // Nom du fichier : facture_DDMMYY_N_NomCollègue.pdf
    const safeName = (invoiceColleague.name || 'collegue')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
    const fileName = `facture_${prefix}_${seq}_${safeName}.pdf`
    doc.save(fileName)

    setInvoiceColleague(null)
    setInvoiceSaving(false)
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Bouton flottant dans le header (masqué si contrôlé depuis le menu) */}
      {forceOpen === undefined && (
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
      )}

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
          onClick={e => { if (e.target === e.currentTarget) { setOpen(false); onClose && onClose() } }}
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
                onClick={() => { setOpen(false); onClose && onClose() }}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}
              >
                ×
              </button>
            </div>

            {/* Onglets */}
            <div style={{ display: 'flex', borderBottom: '1px solid #1e293b' }}>
              {[
                { id: 'requests',   label: `Demandes${pendingCount > 0 ? ` (${pendingCount})` : ''}` },
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
                        padding: '12px',
                        marginBottom: 8,
                        opacity: c.active ? 1 : 0.5,
                      }}>
                        {/* Nom + statut */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
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
                            <button onClick={() => handleRevoke(c.id)} style={s.btnSmallRed}>
                              Révoquer
                            </button>
                          ) : (
                            <button onClick={() => handleReactivate(c.id)} style={s.btnSmallGreen}>
                              Réactiver
                            </button>
                          )}
                        </div>

                        {/* Infos facturation (adresse + SIRET) si renseignées */}
                        {(c.address || c.siret) && (
                          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, lineHeight: 1.5 }}>
                            {c.address && <span>📍 {c.address}</span>}
                            {c.address && c.siret && <span style={{ margin: '0 6px' }}>·</span>}
                            {c.siret && <span>SIRET : {c.siret}</span>}
                          </div>
                        )}

                        {/* Bouton facture */}
                        {c.active && (
                          <button
                            onClick={() => openInvoiceModal(c)}
                            style={s.btnInvoice}
                          >
                            🧾 Nouvelle facture
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
                <textarea
                  data-invite-link
                  readOnly
                  value={inviteLink}
                  rows={3}
                  style={{
                    background: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: 8,
                    padding: '10px 12px',
                    marginBottom: 12,
                    width: '100%',
                    color: '#94a3b8',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    outline: 'none',
                    resize: 'none',
                    wordBreak: 'break-all',
                    boxSizing: 'border-box',
                    lineHeight: 1.5,
                  }}
                />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => copyLink(inviteLink)}
                    style={{ ...s.btnGreen, background: copied ? '#15803d' : '#16a34a' }}
                  >
                    {copied ? '✅ Copié !' : '📋 Copier le lien'}
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

      {/* ── Modal : générer une facture ───────────────────────────────────── */}
      {invoiceColleague && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            zIndex: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={e => e.target === e.currentTarget && setInvoiceColleague(null)}
        >
          <div style={{
            background: '#1e293b',
            borderRadius: 16,
            padding: '24px 20px',
            maxWidth: 380,
            width: '100%',
          }}>
            <h3 style={{ margin: '0 0 4px', color: '#f1f5f9', fontSize: 16, fontWeight: 700 }}>
              🧾 Facture — {invoiceColleague.name}
            </h3>
            <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 12 }}>
              N° {invoiceNumber || '…'}
            </p>

            <form onSubmit={handleGenerateInvoice}>
              {/* Montant */}
              <label style={s.label}>Montant (€)</label>
              <input
                type="number"
                value={invoiceAmount}
                onChange={e => setInvoiceAmount(e.target.value)}
                style={{ ...s.input, fontSize: 20, fontWeight: 700, textAlign: 'center' }}
                placeholder="0"
                min="1"
                step="1"
                autoFocus
                required
              />

              {/* Désignation */}
              <label style={{ ...s.label, marginTop: 12 }}>Désignation</label>
              <input
                type="text"
                value={invoiceDesig}
                onChange={e => setInvoiceDesig(e.target.value)}
                style={s.input}
                required
              />

              {/* Date */}
              <label style={{ ...s.label, marginTop: 12 }}>Date de la facture</label>
              <input
                type="date"
                value={invoiceDate}
                onChange={e => {
                  setInvoiceDate(e.target.value)
                  // Mettre à jour le numéro prévisualisé si la date change
                  const prefix = invoiceDatePrefix(e.target.value)
                  supabase
                    .from('colleague_invoices')
                    .select('id', { count: 'exact', head: true })
                    .eq('pilot_id', pilot.id)
                    .ilike('invoice_number', `${prefix}/%`)
                    .then(({ count }) => setInvoiceNumber(`${prefix}/${(count || 0) + 1}`))
                }}
                style={s.input}
                required
              />

              {invoiceError && <p style={{ ...s.error, marginTop: 12 }}>{invoiceError}</p>}

              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button
                  type="button"
                  onClick={() => setInvoiceColleague(null)}
                  style={s.btnGrey}
                >
                  Annuler
                </button>
                <button type="submit" disabled={invoiceSaving} style={s.btnGreen}>
                  {invoiceSaving ? 'Génération…' : '⬇️ Générer PDF'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

// ── Badge de statut ───────────────────────────────────────────────────────────
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

// ── Styles ────────────────────────────────────────────────────────────────────
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
  btnInvoice: {
    width: '100%',
    padding: '8px',
    background: '#1e3a5f',
    color: '#93c5fd',
    border: '1px solid #1d4ed844',
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'center',
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
