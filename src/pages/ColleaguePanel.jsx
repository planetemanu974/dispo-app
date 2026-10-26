// ColleaguePanel.jsx — Panneau de gestion des collègues (pour le pilote)
// Inclus dans Dashboard.jsx via : <ColleaguePanel pilot={pilot} />
// Fonctions : inviter une structure, voir/gérer les demandes, éditer fiche, émettre des factures
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

// Load jsPDF from CDN on demand (avoids build-time npm dependency)
let jsPDFClass = null
async function loadJsPDF() {
  if (jsPDFClass) return jsPDFClass
  await new Promise((resolve, reject) => {
    if (document.querySelector('script[data-jspdf]')) { resolve(); return }
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
    s.setAttribute('data-jspdf', '1')
    s.onload  = resolve
    s.onerror = reject
    document.head.appendChild(s)
  })
  jsPDFClass = window.jspdf.jsPDF
  return jsPDFClass
}

// ── Constantes pilote (informations de facturation) ───────────────────────────
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
function fmtTime(t)      { return t ? t.slice(0, 5) : '' }
function fmtDateFR(iso)  { if (!iso) return ''; const [y,m,d]=iso.split('-'); return `${d}/${m}/${y}` }
function todayISO()      { return new Date().toISOString().split('T')[0] }
function invoiceDatePrefix(iso) { const [y,m,d]=iso.split('-'); return `${d}${m}${y.slice(2)}` }

// ── Génération du PDF de facture ──────────────────────────────────────────────
function generateInvoicePDF({ JsPDF, invoiceNumber, invoiceDate, amount, designation, colleague }) {
  const doc  = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W    = 210
  const M    = 20   // marge gauche/droite

  // En-tête pilote
  doc.setFont('helvetica', 'bold');   doc.setFontSize(12)
  doc.text(PILOT_INFO.name, M, 25)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  doc.text(PILOT_INFO.address, M, 31)
  doc.text(PILOT_INFO.city,    M, 36)
  doc.text(`Tél : ${PILOT_INFO.phone}`, M, 41)
  doc.setFont('helvetica', 'bold');   doc.setFontSize(9)
  doc.text(`SIRET : ${PILOT_INFO.siret}`, M, 48)

  // Titre
  doc.setFont('helvetica', 'bold');   doc.setFontSize(20)
  doc.text('FACTURE', W / 2, 65, { align: 'center' })

  // Numéro + date (coin droit)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  doc.text(`N° ${invoiceNumber}`,               W - M, 55, { align: 'right' })
  doc.text(`Date : ${fmtDateFR(invoiceDate)}`,  W - M, 61, { align: 'right' })

  // Bloc destinataire
  const dx = W - M - 80, dy = 72
  doc.setDrawColor(180, 180, 180)
  doc.rect(dx, dy - 5, 82, 32)
  doc.setFont('helvetica', 'bold');   doc.setFontSize(9)
  doc.text('Destinataire :', dx + 3, dy + 1)
  doc.setFont('helvetica', 'normal')
  doc.text(colleague.name    || '',           dx + 3, dy + 7)
  if (colleague.address) doc.text(colleague.address, dx + 3, dy + 13)
  if (colleague.siret)   doc.text(`SIRET : ${colleague.siret}`, dx + 3, dy + 19)

  // Tableau
  doc.setDrawColor(0, 0, 0)
  doc.line(M, 112, W - M, 112)
  doc.setFont('helvetica', 'bold');   doc.setFontSize(10)
  doc.text('Désignation', M, 120)
  doc.text('Montant HT',  W - M, 120, { align: 'right' })
  doc.line(M, 123, W - M, 123)
  doc.setFont('helvetica', 'normal')
  doc.text(designation, M, 132)
  doc.text(`${Number(amount).toFixed(2)} €`, W - M, 132, { align: 'right' })
  doc.line(M, 137, W - M, 137)

  // TVA
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8)
  doc.text('TVA non applicable — art. 293 B du CGI', M, 143)

  // Total
  doc.setFont('helvetica', 'bold');   doc.setFontSize(11)
  doc.rect(W - M - 52, 146, 54, 10)
  doc.text('TOTAL TTC :', W - M - 50, 152)
  doc.text(`${Number(amount).toFixed(2)} €`, W - M, 152, { align: 'right' })

  // Pied
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(100)
  doc.text('Merci pour votre confiance.', W / 2, 270, { align: 'center' })

  return doc
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function ColleaguePanel({ pilot, forceOpen, onClose }) {
  const [open, setOpen] = useState(false)

  useEffect(() => { if (forceOpen) setOpen(true) }, [forceOpen])

  const [tab, setTab] = useState('requests')

  // Demandes entrantes
  const [requests,   setRequests]   = useState([])
  const [reqLoading, setReqLoading] = useState(false)

  // Collègues
  const [colleagues, setColleagues] = useState([])
  const [colLoading, setColLoading] = useState(false)

  // Modal : invitation
  const [showInvite,   setShowInvite]   = useState(false)
  const [inviteName,   setInviteName]   = useState('')
  const [inviteLink,   setInviteLink]   = useState(null)
  const [inviteSaving, setInviteSaving] = useState(false)
  const [inviteError,  setInviteError]  = useState(null)
  const [copied,       setCopied]       = useState(false)

  // Modal : fiche collègue (édition)
  const [detailColleague, setDetailColleague] = useState(null)  // { id, name, address, siret, phone, active }
  const [detailSaving,    setDetailSaving]    = useState(false)
  const [detailError,     setDetailError]     = useState(null)

  // Historique (dans la fiche collègue)
  const [history,        setHistory]        = useState({ invoices: [], requests: [] })
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyTab,     setHistoryTab]     = useState('invoices')  // 'invoices' | 'requests'

  // Modal : facture
  const [invoiceColleague, setInvoiceColleague] = useState(null)
  const [invoiceAmount,    setInvoiceAmount]    = useState('')
  const [invoiceDate,      setInvoiceDate]      = useState(todayISO())
  const [invoiceDesig,     setInvoiceDesig]     = useState('Prestation biplace')
  const [invoiceSaving,    setInvoiceSaving]    = useState(false)
  const [invoiceError,     setInvoiceError]     = useState(null)
  const [invoiceNumber,    setInvoiceNumber]    = useState(null)

  // ── Chargement ────────────────────────────────────────────────────────────
  const loadRequests = useCallback(async () => {
    setReqLoading(true)
    const { data } = await supabase.rpc('get_colleague_requests', { p_pilot_id: pilot.id })
    setRequests(data || [])
    setReqLoading(false)
  }, [pilot.id])

  const loadColleagues = useCallback(async () => {
    setColLoading(true)
    const { data } = await supabase
      .from('colleagues')
      .select('id, name, address, siret, phone, email, active, invite_used, created_at')
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

  const pendingCount = requests.filter(r => r.status === 'pending').length

  // ── Demandes ──────────────────────────────────────────────────────────────
  async function handleDecision(requestId, newStatus) {
    await supabase.rpc('update_colleague_request', { p_request_id: requestId, p_status: newStatus })
    setRequests(prev => prev.map(r => r.request_id === requestId ? { ...r, status: newStatus } : r))
  }

  // ── Invitation ────────────────────────────────────────────────────────────
  async function handleCreateInvite(e) {
    e.preventDefault()
    if (!inviteName.trim()) return
    setInviteSaving(true); setInviteError(null)
    const { data, error } = await supabase
      .from('colleagues')
      .insert({ pilot_id: pilot.id, name: inviteName.trim() })
      .select('invite_token')
      .single()
    if (error || !data) { setInviteError('Erreur lors de la création du lien.'); setInviteSaving(false); return }
    setInviteLink(`${window.location.origin}/join?token=${data.invite_token}`)
    setInviteSaving(false)
    loadColleagues()
  }

  function copyLink(link) {
    navigator.clipboard.writeText(link)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500) })
      .catch(() => { const el = document.querySelector('[data-invite-link]'); if (el) { el.select(); document.execCommand('copy') } })
  }

  // ── Fiche collègue ────────────────────────────────────────────────────────
  async function openDetail(c) {
    setDetailColleague({ ...c })
    setDetailError(null)
    setHistoryTab('invoices')
    setHistoryLoading(true)
    // Charger factures + demandes en parallèle
    const [invRes, reqRes] = await Promise.all([
      supabase
        .from('colleague_invoices')
        .select('id, invoice_number, invoice_date, amount_eur, designation')
        .eq('colleague_id', c.id)
        .order('invoice_date', { ascending: false }),
      supabase
        .rpc('get_colleague_requests', { p_pilot_id: pilot.id })
        .then(({ data }) => ({ data: (data || []).filter(r => r.colleague_id === c.id) }))
    ])
    setHistory({ invoices: invRes.data || [], requests: reqRes.data || [] })
    setHistoryLoading(false)
  }

  async function handleSaveDetail(e) {
    e.preventDefault()
    setDetailSaving(true); setDetailError(null)
    const { error } = await supabase
      .from('colleagues')
      .update({
        name:    detailColleague.name,
        address: detailColleague.address || null,
        siret:   detailColleague.siret   || null,
        phone:   detailColleague.phone   || null,
        email:   detailColleague.email   || null,
      })
      .eq('id', detailColleague.id)
      .eq('pilot_id', pilot.id)
    if (error) { setDetailError('Erreur de sauvegarde. Réessayez.'); setDetailSaving(false); return }
    setDetailSaving(false)
    loadColleagues()
    // Mettre à jour les données locales du modal (sans fermer)
    setColleagues(prev => prev.map(c => c.id === detailColleague.id ? { ...c, ...detailColleague } : c))
  }

  async function handleToggleActive() {
    const newActive = !detailColleague.active
    if (newActive === false && !window.confirm('Révoquer l\'accès de ce collègue ?')) return
    await supabase
      .from('colleagues')
      .update({ active: newActive })
      .eq('id', detailColleague.id)
      .eq('pilot_id', pilot.id)
    setDetailColleague(prev => ({ ...prev, active: newActive }))
    loadColleagues()
  }

  // ── Re-télécharger une facture existante ─────────────────────────────────
  async function redownloadInvoice(inv) {
    const JsPDF = await loadJsPDF()
    const doc = generateInvoicePDF({
      JsPDF,
      invoiceNumber: inv.invoice_number,
      invoiceDate:   inv.invoice_date,
      amount:        inv.amount_eur,
      designation:   inv.designation,
      colleague:     detailColleague,
    })
    const [prefix, seq] = inv.invoice_number.split('/')
    const safe = (detailColleague.name || 'collegue').toLowerCase().replace(/[^a-z0-9]/g, '_')
    doc.save(`facture_${prefix}_${seq || '1'}_${safe}.pdf`)
  }

  // ── Facture ───────────────────────────────────────────────────────────────
  async function openInvoiceModal(colleague) {
    const today  = todayISO()
    const prefix = invoiceDatePrefix(today)
    const { count } = await supabase
      .from('colleague_invoices')
      .select('id', { count: 'exact', head: true })
      .eq('pilot_id', pilot.id)
      .ilike('invoice_number', `${prefix}/%`)
    setInvoiceNumber(`${prefix}/${(count || 0) + 1}`)
    setInvoiceColleague(colleague)
    setInvoiceAmount('')
    setInvoiceDate(today)
    setInvoiceDesig('Prestation biplace')
    setInvoiceError(null)
    setDetailColleague(null)  // fermer la fiche
  }

  async function handleGenerateInvoice(e) {
    e.preventDefault()
    if (!invoiceAmount || Number(invoiceAmount) <= 0) { setInvoiceError('Veuillez saisir un montant valide.'); return }

    // Detect which button was clicked: "save" (download) or "send" (email)
    const action = e.nativeEvent?.submitter?.value || 'save'

    setInvoiceSaving(true); setInvoiceError(null)

    // Recalculer le numéro (date peut avoir changé)
    const prefix = invoiceDatePrefix(invoiceDate)
    const { count } = await supabase
      .from('colleague_invoices')
      .select('id', { count: 'exact', head: true })
      .eq('pilot_id', pilot.id)
      .ilike('invoice_number', `${prefix}/%`)
    const seq    = (count || 0) + 1
    const finalN = `${prefix}/${seq}`

    const { error } = await supabase
      .from('colleague_invoices')
      .insert({
        pilot_id:       pilot.id,
        colleague_id:   invoiceColleague.id,
        invoice_number: finalN,
        invoice_date:   invoiceDate,
        designation:    invoiceDesig,
        amount_eur:     Number(invoiceAmount),
      })
    if (error) { setInvoiceError('Erreur lors de la sauvegarde.'); setInvoiceSaving(false); return }

    const JsPDF = await loadJsPDF()
    const doc = generateInvoicePDF({ JsPDF, invoiceNumber: finalN, invoiceDate, amount: invoiceAmount, designation: invoiceDesig, colleague: invoiceColleague })
    const safe = (invoiceColleague.name || 'collegue').toLowerCase().replace(/[^a-z0-9]/g, '_')
    const filename = `facture_${prefix}_${seq}_${safe}.pdf`

    if (action === 'send' && invoiceColleague.email) {
      // Generate PDF as blob, try Web Share API first (mobile), fallback to mailto
      const pdfBlob = doc.output('blob')
      const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' })
      const subject = encodeURIComponent(`Facture ${finalN}`)
      const body    = encodeURIComponent(`Bonjour,\n\nVeuillez trouver ci-joint ma facture n° ${finalN}.\n\nCordialement`)

      if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
        // Mobile: Web Share API with file attachment
        try {
          await navigator.share({ files: [pdfFile], title: `Facture ${finalN}`, text: 'Facture parapente' })
        } catch (shareErr) {
          // User cancelled share or share failed — fallback to download
          if (shareErr.name !== 'AbortError') doc.save(filename)
        }
      } else {
        // Desktop: open mailto with PDF downloaded first so user can attach manually
        doc.save(filename)
        window.location.href = `mailto:${invoiceColleague.email}?subject=${subject}&body=${body}`
      }
    } else {
      // Default: download PDF
      doc.save(filename)
    }

    setInvoiceColleague(null)
    setInvoiceSaving(false)
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Bouton flottant header */}
      {forceOpen === undefined && (
        <button onClick={() => setOpen(true)} style={{
          position: 'relative', background: open ? '#1d4ed8' : '#1e293b',
          border: '1px solid #334155', color: '#f1f5f9', borderRadius: 10,
          padding: '7px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          🤝 Collègues
          {pendingCount > 0 && (
            <span style={{ background: '#dc2626', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
              {pendingCount}
            </span>
          )}
        </button>
      )}

      {/* ── Drawer principal ─────────────────────────────────────────────── */}
      {open && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) { setOpen(false); onClose && onClose() } }}
        >
          <div style={{ background: '#0f172a', borderRadius: '20px 20px 0 0', padding: '20px 0 env(safe-area-inset-bottom, 16px)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>

            {/* En-tête */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px 12px', borderBottom: '1px solid #1e293b' }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#f1f5f9' }}>🤝 Structures collègues</h2>
              <button onClick={() => { setOpen(false); onClose && onClose() }} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>

            {/* Onglets */}
            <div style={{ display: 'flex', borderBottom: '1px solid #1e293b' }}>
              {[
                { id: 'requests',   label: `Demandes${pendingCount > 0 ? ` (${pendingCount})` : ''}` },
                { id: 'colleagues', label: 'Mes collègues' },
              ].map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  flex: 1, padding: '10px', background: 'none', border: 'none',
                  borderBottom: tab === t.id ? '2px solid #3b82f6' : '2px solid transparent',
                  color: tab === t.id ? '#3b82f6' : '#64748b',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>{t.label}</button>
              ))}
            </div>

            {/* Contenu scrollable */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '0 16px' }}>

              {/* ── Onglet Demandes ───────────────────────────────────── */}
              {tab === 'requests' && (
                <div style={{ paddingTop: 12 }}>
                  {reqLoading ? <p style={s.muted}>Chargement…</p>
                    : requests.length === 0 ? <p style={s.muted}>Aucune demande pour l'instant.</p>
                    : requests.map(r => (
                      <div key={r.request_id} style={{ background: '#1e293b', borderRadius: 12, padding: '12px', marginBottom: 10, borderLeft: `4px solid ${r.status === 'pending' ? '#f59e0b' : r.status === 'accepted' ? '#16a34a' : '#94a3b8'}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 14 }}>{r.colleague_name}</span>
                          <StatusBadge status={r.status} />
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 4 }}>📅 {fmtDate(r.slot_date)} · 🕐 {fmtTime(r.slot_time)}</div>
                        {r.note && <div style={{ background: '#0f172a', borderRadius: 6, padding: '6px 8px', fontSize: 13, color: '#cbd5e1', marginBottom: 8, fontStyle: 'italic' }}>💬 {r.note}</div>}
                        {r.status === 'pending' && (
                          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                            <button onClick={() => handleDecision(r.request_id, 'accepted')} style={s.btnAccept}>✓ Accepter</button>
                            <button onClick={() => handleDecision(r.request_id, 'refused')}  style={s.btnRefuse}>✗ Refuser</button>
                          </div>
                        )}
                      </div>
                    ))
                  }
                </div>
              )}

              {/* ── Onglet Mes collègues ──────────────────────────────── */}
              {tab === 'colleagues' && (
                <div style={{ paddingTop: 12 }}>
                  <button
                    onClick={() => { setShowInvite(true); setInviteName(''); setInviteLink(null); setInviteError(null) }}
                    style={s.btnInvite}
                  >
                    + Inviter une structure
                  </button>

                  {colLoading ? <p style={s.muted}>Chargement…</p>
                    : colleagues.length === 0 ? <p style={s.muted}>Aucun collègue invité pour l'instant.</p>
                    : colleagues.map(c => (
                      // Carte cliquable → ouvre la fiche
                      <button
                        key={c.id}
                        onClick={() => openDetail(c)}
                        style={{
                          width: '100%', textAlign: 'left', background: '#1e293b',
                          border: '1px solid #334155', borderRadius: 10, padding: '12px 14px',
                          marginBottom: 8, cursor: 'pointer', opacity: c.active ? 1 : 0.5,
                          fontFamily: 'inherit',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 14, marginBottom: 3 }}>
                              {c.name || <em style={{ color: '#64748b' }}>Sans nom</em>}
                            </div>
                            <div style={{ fontSize: 11, color: '#64748b' }}>
                              {c.active
                                ? (c.invite_used ? '✅ Compte actif' : '⏳ Invitation non utilisée')
                                : '🚫 Accès révoqué'}
                            </div>
                          </div>
                          <span style={{ color: '#475569', fontSize: 18 }}>›</span>
                        </div>
                      </button>
                    ))
                  }
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal : invitation ────────────────────────────────────────────── */}
      {showInvite && (
        <ModalOverlay onClose={() => setShowInvite(false)}>
          <h3 style={s.modalTitle}>🔗 Inviter une structure</h3>
          {!inviteLink ? (
            <form onSubmit={handleCreateInvite}>
              <label style={s.label}>Nom de la structure collègue</label>
              <input type="text" value={inviteName} onChange={e => setInviteName(e.target.value)}
                style={s.input} placeholder="Ex : 974 Parapente" autoFocus required />
              <p style={{ color: '#64748b', fontSize: 12, margin: '8px 0 16px' }}>
                Ce nom sera utilisé pour se connecter à l'application.
              </p>
              {inviteError && <p style={s.error}>{inviteError}</p>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" onClick={() => setShowInvite(false)} style={s.btnGrey}>Annuler</button>
                <button type="submit" disabled={inviteSaving} style={s.btnGreen}>{inviteSaving ? 'Création…' : 'Créer le lien'}</button>
              </div>
            </form>
          ) : (
            <>
              <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
                Envoyez ce lien à <strong style={{ color: '#f1f5f9' }}>{inviteName}</strong>.
              </p>
              <textarea data-invite-link readOnly value={inviteLink} rows={3} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px', marginBottom: 12, width: '100%', color: '#94a3b8', fontSize: 12, fontFamily: 'monospace', outline: 'none', resize: 'none', wordBreak: 'break-all', boxSizing: 'border-box', lineHeight: 1.5 }} />
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => copyLink(inviteLink)} style={{ ...s.btnGreen, background: copied ? '#15803d' : '#16a34a' }}>
                  {copied ? '✅ Copié !' : '📋 Copier le lien'}
                </button>
                <button onClick={() => setShowInvite(false)} style={s.btnGrey}>Fermer</button>
              </div>
              <p style={{ color: '#64748b', fontSize: 11, marginTop: 10 }}>⚠️ Ce lien est à usage unique.</p>
            </>
          )}
        </ModalOverlay>
      )}

      {/* ── Modal : fiche collègue ────────────────────────────────────────── */}
      {detailColleague && (
        <ModalOverlay onClose={() => setDetailColleague(null)}>
          <h3 style={{ ...s.modalTitle, marginBottom: 4 }}>
            {detailColleague.name || 'Collègue'}
          </h3>
          <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 12 }}>
            {detailColleague.active
              ? (detailColleague.invite_used ? '✅ Compte actif' : '⏳ Invitation non utilisée')
              : '🚫 Accès révoqué'}
          </p>

          <form onSubmit={handleSaveDetail}>
            <label style={s.label}>Nom de la structure</label>
            <input type="text" value={detailColleague.name || ''} onChange={e => setDetailColleague(p => ({ ...p, name: e.target.value }))} style={s.input} required />

            <label style={{ ...s.label, marginTop: 12 }}>Adresse</label>
            <input type="text" value={detailColleague.address || ''} onChange={e => setDetailColleague(p => ({ ...p, address: e.target.value }))} style={s.input} placeholder="Ex : 12 rue des Flamboyants, 97423 …" />

            <label style={{ ...s.label, marginTop: 12 }}>SIRET</label>
            <input type="text" value={detailColleague.siret || ''} onChange={e => setDetailColleague(p => ({ ...p, siret: e.target.value }))} style={s.input} placeholder="Ex : 123 456 789 00012" />

            <label style={{ ...s.label, marginTop: 12 }}>Téléphone</label>
            <input type="tel" value={detailColleague.phone || ''} onChange={e => setDetailColleague(p => ({ ...p, phone: e.target.value }))} style={s.input} placeholder="Ex : 0692 …" />

            <label style={{ ...s.label, marginTop: 12 }}>Email</label>
            <input type="email" value={detailColleague.email || ''} onChange={e => setDetailColleague(p => ({ ...p, email: e.target.value }))} style={s.input} placeholder="Ex : contact@974parapente.re" />

            {detailError && <p style={{ ...s.error, marginTop: 8 }}>{detailError}</p>}

            <button type="submit" disabled={detailSaving} style={{ ...s.btnGreen, width: '100%', marginTop: 16 }}>
              {detailSaving ? 'Sauvegarde…' : '💾 Enregistrer'}
            </button>
          </form>

          {/* Bouton facture */}
          {detailColleague.active && (
            <button
              onClick={() => openInvoiceModal(detailColleague)}
              style={{ width: '100%', marginTop: 10, padding: '11px', background: '#1e3a5f', color: '#93c5fd', border: '1px solid #1d4ed855', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              🧾 Nouvelle facture
            </button>
          )}

          {/* ── Historique ── */}
          <div style={{ marginTop: 20, borderTop: '1px solid #1e293b', paddingTop: 14 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {[{ id: 'invoices', label: `🧾 Factures (${history.invoices.length})` }, { id: 'requests', label: `📋 Demandes (${history.requests.length})` }].map(t => (
                <button key={t.id} onClick={() => setHistoryTab(t.id)} style={{ flex: 1, padding: '7px 4px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: historyTab === t.id ? 700 : 500, background: historyTab === t.id ? '#0ea5e9' : '#1e293b', color: historyTab === t.id ? '#fff' : '#94a3b8' }}>{t.label}</button>
              ))}
            </div>

            {historyLoading ? <p style={{ ...s.muted, textAlign: 'center' }}>Chargement…</p> : (
              <>
                {/* Factures */}
                {historyTab === 'invoices' && (
                  history.invoices.length === 0
                    ? <p style={s.muted}>Aucune facture pour ce collègue.</p>
                    : history.invoices.map(inv => (
                      <div key={inv.id} style={{ background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 8, padding: '10px 12px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 700, color: '#93c5fd', fontSize: 13 }}>N° {inv.invoice_number}</div>
                          <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{fmtDateFR(inv.invoice_date)} · {inv.designation}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                          <span style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 14 }}>{Number(inv.amount_eur).toFixed(2)} €</span>
                          <button onClick={() => redownloadInvoice(inv)} style={{ fontSize: 11, padding: '4px 8px', background: '#1e3a5f', color: '#93c5fd', border: 'none', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}>📥 PDF</button>
                        </div>
                      </div>
                    ))
                )}

                {/* Demandes */}
                {historyTab === 'requests' && (
                  history.requests.length === 0
                    ? <p style={s.muted}>Aucune demande de ce collègue.</p>
                    : history.requests.map(r => (
                      <div key={r.request_id} style={{ background: '#0f172a', border: `1px solid ${r.status === 'pending' ? '#92400e' : r.status === 'accepted' ? '#14532d' : '#1e293b'}`, borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ color: '#f1f5f9', fontSize: 13 }}>📅 {fmtDate(r.slot_date)} · 🕐 {fmtTime(r.slot_time)}</span>
                          <StatusBadge status={r.status} />
                        </div>
                        {r.note && <div style={{ color: '#64748b', fontSize: 12, fontStyle: 'italic' }}>💬 {r.note}</div>}
                      </div>
                    ))
                )}
              </>
            )}
          </div>

          {/* Révoquer / Réactiver */}
          <button
            onClick={handleToggleActive}
            style={{ width: '100%', marginTop: 10, padding: '10px', background: detailColleague.active ? '#7f1d1d33' : '#14532d33', color: detailColleague.active ? '#fca5a5' : '#86efac', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {detailColleague.active ? 'Révoquer l\'accès' : 'Réactiver'}
          </button>
        </ModalOverlay>
      )}

      {/* ── Modal : facture ───────────────────────────────────────────────── */}
      {invoiceColleague && (
        <ModalOverlay onClose={() => setInvoiceColleague(null)}>
          <h3 style={{ ...s.modalTitle, marginBottom: 4 }}>🧾 Facture</h3>
          <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 12 }}>
            {invoiceColleague.name} · N° {invoiceNumber || '…'}
          </p>

          <form onSubmit={handleGenerateInvoice}>
            <label style={s.label}>Montant (€)</label>
            <input type="number" value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)}
              style={{ ...s.input, fontSize: 22, fontWeight: 700, textAlign: 'center', letterSpacing: 1 }}
              placeholder="0" min="1" step="1" autoFocus required />

            <label style={{ ...s.label, marginTop: 12 }}>Désignation</label>
            <input type="text" value={invoiceDesig} onChange={e => setInvoiceDesig(e.target.value)} style={s.input} required />

            <label style={{ ...s.label, marginTop: 12 }}>Date de la facture</label>
            <input type="date" value={invoiceDate}
              onChange={e => {
                setInvoiceDate(e.target.value)
                const prefix = invoiceDatePrefix(e.target.value)
                supabase.from('colleague_invoices').select('id', { count: 'exact', head: true })
                  .eq('pilot_id', pilot.id).ilike('invoice_number', `${prefix}/%`)
                  .then(({ count }) => setInvoiceNumber(`${prefix}/${(count || 0) + 1}`))
              }}
              style={s.input} required />

            {invoiceError && <p style={{ ...s.error, marginTop: 8 }}>{invoiceError}</p>}

            {invoiceError && <p style={{ ...s.error, marginTop: 8 }}>{invoiceError}</p>}

            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button type="button" onClick={() => setInvoiceColleague(null)} style={s.btnGrey}>Annuler</button>
              <button type="submit" name="action" value="save" disabled={invoiceSaving} style={s.btnGreen}>{invoiceSaving ? 'Génération…' : '📥 Enregistrer'}</button>
              {invoiceColleague?.email && (
                <button type="submit" name="action" value="send" disabled={invoiceSaving} style={{ ...s.btnGreen, background: '#0369a1', flex: 1 }}>📧 Envoyer</button>
              )}
            </div>
          </form>
        </ModalOverlay>
      )}
    </>
  )
}

// ── Overlay modal réutilisable ────────────────────────────────────────────────
function ModalOverlay({ children, onClose }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: '#1e293b', borderRadius: 16, padding: '24px 20px', maxWidth: 420, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        {children}
      </div>
    </div>
  )
}

// ── Badge statut ─────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    pending:  { bg: '#f59e0b22', color: '#f59e0b', label: 'En attente' },
    accepted: { bg: '#16a34a22', color: '#16a34a', label: 'Accepté' },
    refused:  { bg: '#94a3b822', color: '#94a3b8', label: 'Refusé' },
  }
  const m = map[status] || map.pending
  return <span style={{ background: m.bg, color: m.color, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20 }}>{m.label}</span>
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  muted:      { color: '#64748b', fontSize: 13, textAlign: 'center', padding: '20px 0' },
  modalTitle: { margin: '0 0 16px', color: '#f1f5f9', fontSize: 16, fontWeight: 700 },
  label: {
    display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8',
    textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
  },
  input: {
    width: '100%', padding: '10px 12px', background: '#0f172a',
    border: '1.5px solid #334155', borderRadius: 8, fontSize: 14,
    color: '#f1f5f9', outline: 'none', boxSizing: 'border-box',
    fontFamily: 'inherit', marginBottom: 4,
  },
  error:    { color: '#fca5a5', fontSize: 12, background: '#7f1d1d33', padding: '6px 8px', borderRadius: 6 },
  btnGreen: { flex: 1, padding: '10px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  btnGrey:  { flex: 1, padding: '10px', background: '#334155', color: '#94a3b8', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  btnAccept: { flex: 1, padding: '8px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  btnRefuse: { flex: 1, padding: '8px', background: '#334155', color: '#fca5a5', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  btnInvite: { width: '100%', padding: '11px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 16, fontFamily: 'inherit' },
}
