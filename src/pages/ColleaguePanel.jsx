// ColleaguePanel.jsx — Panneau de gestion des collègues (pour le pilote) v2
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

/** Date locale YYYY-MM-DD (sans décalage UTC — Réunion UTC+4) */
function localDateStr(d = new Date()) {
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

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
// Format a local phone number for WhatsApp (Réunion: 0692… → 262692…)
function toWhatsAppNumber(phone) {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('0')) return '262' + digits.slice(1)
  if (digits.startsWith('262') || digits.startsWith('33')) return digits
  return digits
}

// Format a slot date + time for a human-readable message
function formatSlotForMessage(date, time) {
  if (!date) return ''
  const d = new Date(date + 'T00:00:00')
  const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
  const label = `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`
  return time ? `${label} à ${time.slice(0, 5)}` : label
}

export default function ColleaguePanel({ pilot, forceOpen, onClose, requestSlot, flightTypes = [] }) {
  const [open, setOpen] = useState(false)

  useEffect(() => { if (forceOpen) setOpen(true) }, [forceOpen])

  const [tab, setTab] = useState('colleagues')

  // Demandes entrantes
  const [requests,   setRequests]   = useState([])
  const [reqLoading, setReqLoading] = useState(false)

  // Collègues
  const [colleagues, setColleagues] = useState([])
  const [colLoading, setColLoading] = useState(false)

  // Modal : invitation structure
  const [showInvite,   setShowInvite]   = useState(false)
  const [inviteName,   setInviteName]   = useState('')
  const [inviteLink,   setInviteLink]   = useState(null)
  const [inviteSaving, setInviteSaving] = useState(false)
  const [inviteError,  setInviteError]  = useState(null)
  const [copied,       setCopied]       = useState(false)

  // Modal : ajouter un pilote direct (indépendant, sans compte app)
  const [showAddDirect,  setShowAddDirect]  = useState(false)
  const [directName,     setDirectName]     = useState('')
  const [directPhone,    setDirectPhone]    = useState('')
  const [directEmail,    setDirectEmail]    = useState('')
  const [directSaving,   setDirectSaving]   = useState(false)
  const [directError,    setDirectError]    = useState(null)

  // Modal : fiche collègue (édition)
  const [detailColleague, setDetailColleague] = useState(null)  // { id, name, address, siret, phone, active }
  const [detailSaving,    setDetailSaving]    = useState(false)
  const [detailError,     setDetailError]     = useState(null)
  const [planningToken,   setPlanningToken]   = useState(null)  // active token for fixed pilot

  // Historique (dans la fiche collègue)
  const [history,        setHistory]        = useState({ invoices: [], requests: [], flights: [] })
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyTab,     setHistoryTab]     = useState('invoices')  // 'invoices' | 'requests' | 'vols'

  // Modal : facture
  const [invoiceColleague, setInvoiceColleague] = useState(null)
  const [invoiceAmount,    setInvoiceAmount]    = useState('')
  const [invoiceDate,      setInvoiceDate]      = useState(todayISO())
  const [invoiceDesig,     setInvoiceDesig]     = useState('Prestation biplace')
  const [invoiceSaving,    setInvoiceSaving]    = useState(false)
  const [invoiceError,     setInvoiceError]     = useState(null)
  const [invoiceGmailUrl,  setInvoiceGmailUrl]  = useState(null) // set after send → shows clickable link
  const [gmailPopup,       setGmailPopup]       = useState(null) // {url, filename} — shown after history send
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
      .select('*') // '*' so the list keeps loading even before migration 021 (logo_url) is applied
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

  // ── Ajouter un pilote direct (indépendant) ───────────────────────────────
  async function handleAddDirect(e) {
    e.preventDefault()
    if (!directName.trim()) return
    setDirectSaving(true); setDirectError(null)
    const { error } = await supabase
      .from('colleagues')
      .insert({
        pilot_id:  pilot.id,
        name:      directName.trim(),
        phone:     directPhone.trim() || null,
        email:     directEmail.trim() || null,
        is_direct: true,
        active:    true,
      })
    if (error) { setDirectError('Erreur lors de l\'ajout. Réessayez.'); setDirectSaving(false); return }
    setDirectSaving(false)
    setShowAddDirect(false)
    setDirectName(''); setDirectPhone(''); setDirectEmail('')
    loadColleagues()
  }

  // ── Supprimer un pilote direct ────────────────────────────────────────────
  async function handleDeleteColleague() {
    if (!window.confirm(`Supprimer définitivement ${detailColleague.name || 'ce pilote'} ?`)) return
    const { error } = await supabase
      .from('colleagues')
      .delete()
      .eq('id', detailColleague.id)
      .eq('pilot_id', pilot.id)
    if (error) { alert('Erreur lors de la suppression. Réessayez.'); return }
    setDetailColleague(null)
    loadColleagues()
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
    setPlanningToken(null)
    setHistoryTab('invoices')
    setHistoryLoading(true)
    // Load (or auto-create) planning token for fixed pilots
    if (c.is_fixed) {
      let { data: tokenRow, error: fetchErr } = await supabase
        .from('fixed_pilot_tokens')
        .select('token')
        .eq('colleague_id', c.id)
        .eq('pilot_id', pilot.id)
        .is('revoked_at', null)
        .maybeSingle()
      console.log('[token] fetch:', tokenRow, fetchErr)
      // Auto-generate token for pilots who were already fixed before migration 017
      if (!tokenRow) {
        const { data: newToken, error: insertErr } = await supabase
          .from('fixed_pilot_tokens')
          .insert({ colleague_id: c.id, pilot_id: pilot.id })
          .select('token')
          .single()
        console.log('[token] insert:', newToken, insertErr)
        tokenRow = newToken
      }
      setPlanningToken(tokenRow?.token || null)
    }
    // Charger factures + demandes + vols en parallèle
    const [invRes, reqRes, bookingsRes] = await Promise.all([
      supabase
        .from('colleague_invoices')
        .select('id, invoice_number, invoice_date, amount_eur, designation')
        .eq('colleague_id', c.id)
        .order('invoice_date', { ascending: false }),
      supabase
        .rpc('get_colleague_requests', { p_pilot_id: pilot.id })
        .then(({ data }) => ({ data: (data || []).filter(r => r.colleague_id === c.id) })),
      // Load all closed bookings to find flights performed by this colleague
      supabase
        .from('bookings')
        .select('id, booking_ref, contact_name, closure_data, pilot_slots!inner(slot_date, slot_time, pilot_id)')
        .eq('pilot_slots.pilot_id', pilot.id)
        .not('closure_data', 'is', null)
        .order('created_at', { ascending: false })
        .limit(300),
    ])

    // Extract flights where this colleague appears in pilot_flights[]
    const flights = []
    const norm = n => (n || '').trim().toLowerCase()
    for (const b of bookingsRes.data || []) {
      const pilotFlights = b.closure_data?.pilot_flights || []
      // Partner booking (COL-…) made FOR this colleague / structure: every recorded flight counts
      if (String(b.booking_ref || '').startsWith('COL-') && norm(b.contact_name) === norm(c.name)) {
        const done = pilotFlights.filter(pf => pf.flight_type_id)
        if (done.length) {
          flights.push({
            booking_id:     b.id,
            booking_ref:    b.booking_ref,
            date:           b.pilot_slots?.slot_date,
            time:           b.pilot_slots?.slot_time,
            flight_type_id: done[0].flight_type_id,
            media_pack:     done.some(pf => pf.media_pack && pf.media_pack !== 'none') ? 'yes' : null,
            count:          done.length,
          })
        }
        continue
      }
      // A colleague may appear multiple times (multi-pax booking) — deduplicate by booking
      const match = pilotFlights.find(pf => pf.pilot_name === c.name)
      if (match) {
        // Count flights on this booking for this colleague
        const count = pilotFlights.filter(pf => pf.pilot_name === c.name).length
        flights.push({
          booking_id:    b.id,
          booking_ref:   b.booking_ref,
          date:          b.pilot_slots?.slot_date,
          time:          b.pilot_slots?.slot_time,
          flight_type_id: match.flight_type_id,
          media_pack:    match.media_pack,
          count,
        })
      }
    }
    // Sort descending by date
    flights.sort((a, b) => (b.date || '').localeCompare(a.date || ''))

    setHistory({ invoices: invRes.data || [], requests: reqRes.data || [], flights })
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
        notes:   detailColleague.notes   || null,
      })
      .eq('id', detailColleague.id)
      .eq('pilot_id', pilot.id)
    if (error) { setDetailError('Erreur de sauvegarde. Réessayez.'); setDetailSaving(false); return }
    setDetailSaving(false)
    loadColleagues()
    // Mettre à jour les données locales du modal (sans fermer)
    setColleagues(prev => prev.map(c => c.id === detailColleague.id ? { ...c, ...detailColleague } : c))
  }

  // ── Structure logo: resized client-side, stored as a small data URL ──────
  function handleLogoFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = async () => {
        const MAX = 256
        const ratio = Math.min(1, MAX / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width  = Math.max(1, Math.round(img.width  * ratio))
        canvas.height = Math.max(1, Math.round(img.height * ratio))
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        await saveLogo(canvas.toDataURL('image/png'))
      }
      img.onerror = () => alert('Image illisible. Essayez un PNG ou un JPG.')
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  }

  async function saveLogo(dataUrl) {
    const { error } = await supabase.from('colleagues')
      .update({ logo_url: dataUrl })
      .eq('id', detailColleague.id).eq('pilot_id', pilot.id)
    if (error) {
      alert('Logo non enregistré : ' + error.message + '\n(La migration 021 doit être appliquée dans Supabase.)')
      return
    }
    setDetailColleague(prev => ({ ...prev, logo_url: dataUrl }))
    setColleagues(prev => prev.map(c => c.id === detailColleague.id ? { ...c, logo_url: dataUrl } : c))
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

  // ── Structure access link ────────────────────────────────────────────────
  // Not registered yet → one-time invite link (/join). Registered → permanent login page (/dispo).
  function structureLink(c) {
    return (!c.invite_used && c.invite_token)
      ? `${window.location.origin}/join?token=${c.invite_token}`
      : `${window.location.origin}/dispo`
  }

  // Re-send the link: re-enables access first if it was revoked, then shares / copies it
  async function handleResendLink() {
    const c = detailColleague
    if (!c.active) {
      if (!window.confirm('L\'accès est révoqué. Le réactiver et renvoyer le lien ?')) return
      const { error } = await supabase.from('colleagues').update({ active: true })
        .eq('id', c.id).eq('pilot_id', pilot.id)
      if (error) { alert('Erreur : ' + error.message); return }
      setDetailColleague(prev => ({ ...prev, active: true }))
      loadColleagues()
    }
    const link = structureLink(c)
    const msg = `Bonjour ${c.name}, voici votre lien pour voir mes disponibilités : ${link}`
    if (c.phone) {
      const { error } = await supabase.functions.invoke('send-sms', { body: { to: c.phone, message: msg } })
      if (!error) { alert('SMS envoyé !'); return }
    }
    if (navigator.share) {
      try { await navigator.share({ text: msg }); return } catch (_) { /* cancelled → fall back to copy */ }
    }
    try { await navigator.clipboard.writeText(msg); alert('Message copié — collez-le dans WhatsApp / SMS.') }
    catch (_) { window.prompt('Copiez ce message :', msg) }
  }

  // Forgotten secret code: issue a fresh one-time invite so the structure can choose a new code
  async function handleResetInvite() {
    const c = detailColleague
    if (!window.confirm('Générer une nouvelle invitation ? La structure devra choisir un nouveau code secret.')) return
    const newToken = crypto.randomUUID()
    const { error } = await supabase.from('colleagues')
      .update({ invite_token: newToken, invite_used: false, active: true })
      .eq('id', c.id).eq('pilot_id', pilot.id)
    if (error) { alert('Erreur : ' + error.message); return }
    setDetailColleague(prev => ({ ...prev, invite_token: newToken, invite_used: false, active: true }))
    loadColleagues()
  }

  // ── Basculer pilote fixe / indépendant ───────────────────────────────────
  async function handleToggleFixed() {
    const newFixed = !detailColleague.is_fixed
    let newOrder = null

    if (newFixed) {
      // Assign next available fixed_order rank
      const fixedPilots = colleagues.filter(c => c.is_direct && c.is_fixed)
      const maxOrder = fixedPilots.reduce((m, c) => Math.max(m, c.fixed_order || 0), 0)
      newOrder = maxOrder + 1
    }

    await supabase
      .from('colleagues')
      .update({ is_fixed: newFixed, fixed_order: newFixed ? newOrder : null })
      .eq('id', detailColleague.id)
      .eq('pilot_id', pilot.id)

    if (newFixed) {
      // Generate a new planning token for this fixed pilot
      const { data: tokenRow } = await supabase
        .from('fixed_pilot_tokens')
        .insert({ colleague_id: detailColleague.id, pilot_id: pilot.id })
        .select('token')
        .single()
      setPlanningToken(tokenRow?.token || null)
    } else {
      // Revoke all active tokens for this colleague
      await supabase
        .from('fixed_pilot_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('colleague_id', detailColleague.id)
        .eq('pilot_id', pilot.id)
        .is('revoked_at', null)
      setPlanningToken(null)
    }

    setDetailColleague(prev => ({ ...prev, is_fixed: newFixed, fixed_order: newOrder }))
    loadColleagues()
  }

  // ── Monter / descendre un pilote fixe dans l'ordre ───────────────────────
  async function handleMoveFixed(direction) {
    // direction: -1 = monter (rang plus petit), +1 = descendre (rang plus grand)
    const fixedPilots = colleagues
      .filter(c => c.is_direct && c.is_fixed)
      .sort((a, b) => (a.fixed_order || 99) - (b.fixed_order || 99))

    // Normalize: assign 1-based ranks to any pilot with null fixed_order
    // (handles pilots promoted before this migration ran)
    const normalized = fixedPilots.map((c, i) => ({
      ...c,
      fixed_order: c.fixed_order ?? (i + 1),
    }))

    const myIndex = normalized.findIndex(c => c.id === detailColleague.id)
    const swapIndex = myIndex + direction
    if (swapIndex < 0 || swapIndex >= normalized.length) return

    const myPilot = normalized[myIndex]
    const swapPilot = normalized[swapIndex]
    const myOrder = myPilot.fixed_order
    const swapOrder = swapPilot.fixed_order

    // Swap the two ranks in DB
    await Promise.all([
      supabase.from('colleagues').update({ fixed_order: swapOrder }).eq('id', myPilot.id).eq('pilot_id', pilot.id),
      supabase.from('colleagues').update({ fixed_order: myOrder }).eq('id', swapPilot.id).eq('pilot_id', pilot.id),
    ])
    setDetailColleague(prev => ({ ...prev, fixed_order: swapOrder }))
    loadColleagues()
  }

  // ── Re-télécharger une facture existante ─────────────────────────────────
  async function deleteInvoice(inv) {
    if (!window.confirm(`Supprimer la facture N° ${inv.invoice_number} (${Number(inv.amount_eur).toFixed(2)} €) ?`)) return
    const { error } = await supabase.from('colleague_invoices').delete().eq('id', inv.id)
    if (error) { alert('Erreur lors de la suppression.'); return }
    // Refresh history
    setHistory(h => ({ ...h, invoices: h.invoices.filter(i => i.id !== inv.id) }))
  }

  async function redownloadInvoice(inv, action = 'save') {
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
    const safe     = (detailColleague.name || 'collegue').toLowerCase().replace(/[^a-z0-9]/g, '_')
    const filename = `facture_${prefix}_${seq || '1'}_${safe}.pdf`

    if (action === 'send') {
      // Download PDF then show clickable Gmail link (same approach as new invoice modal)
      const email   = detailColleague.email || ''
      const subject = encodeURIComponent(`Facture ${inv.invoice_number}`)
      const body    = encodeURIComponent(`Bonjour,\n\nVeuillez trouver ci-joint ma facture n° ${inv.invoice_number}.\n\nCordialement`)
      doc.save(filename)
      const gmailUrl = `https://mail.google.com/mail/?view=cm${email ? `&to=${encodeURIComponent(email)}` : ''}&su=${subject}&body=${body}`
      setGmailPopup({ url: gmailUrl, filename })
    } else {
      doc.save(filename)
    }
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

    if (action === 'send') {
      // Send action: download PDF, then show a clickable Gmail link in the modal
      // (programmatic window.open is blocked by Chrome in async functions)
      const subject = encodeURIComponent(`Facture ${finalN}`)
      const body    = encodeURIComponent(`Bonjour,\n\nVeuillez trouver ci-joint ma facture n° ${finalN}.\n\nCordialement`)
      const emailTo = invoiceColleague.email || ''

      doc.save(filename)
      if (emailTo) {
        const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(emailTo)}&su=${subject}&body=${body}`
        setInvoiceGmailUrl(gmailUrl) // display link in modal for user to click directly
      } else {
        setInvoiceError('Aucun email enregistré pour ce collègue. PDF téléchargé — ajoutez son email dans sa fiche.')
      }
    } else {
      // Default: download PDF and close modal
      doc.save(filename)
      setInvoiceColleague(null)
    }

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
                { id: 'colleagues', label: 'Mes collègues' },
                { id: 'requests',   label: `Demandes${pendingCount > 0 ? ` (${pendingCount})` : ''}` },
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

                  {/* ── Section : Structures ───────────────────────────── */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>🏢 Structures</span>
                    <button
                      onClick={() => { setShowInvite(true); setInviteName(''); setInviteLink(null); setInviteError(null) }}
                      style={s.btnInviteSmall}
                    >
                      + Inviter
                    </button>
                  </div>

                  {colLoading ? <p style={s.muted}>Chargement…</p> : (() => {
                    const structures = colleagues.filter(c => !c.is_direct)
                    return structures.length === 0
                      ? <p style={{ ...s.muted, padding: '10px 0 16px', textAlign: 'left' }}>Aucune structure invitée.</p>
                      : structures.map(c => <ColleagueCard key={c.id} c={c} onOpen={openDetail} />)
                  })()}

                  {/* Séparateur */}
                  <div style={{ borderTop: '1px solid #1e293b', margin: '12px 0 14px' }} />

                  {/* ── Section : Pilotes fixes ─────────────────────────── */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>⭐ Pilotes fixes</span>
                  </div>

                  {!colLoading && (() => {
                    const fixed = colleagues
                      .filter(c => c.is_direct && c.is_fixed)
                      .sort((a, b) => (a.fixed_order || 99) - (b.fixed_order || 99))
                    return fixed.length === 0
                      ? <p style={{ ...s.muted, padding: '6px 0 10px', textAlign: 'left', fontSize: 12 }}>Aucun pilote fixe. Promouvez un pilote indépendant depuis sa fiche.</p>
                      : fixed.map((c, i) => <ColleagueCard key={c.id} c={c} onOpen={openDetail} badge={`N°${c.fixed_order || (i+1)}`} />)
                  })()}

                  {/* Séparateur */}
                  <div style={{ borderTop: '1px solid #1e293b', margin: '12px 0 14px' }} />

                  {/* ── Section : Pilotes indépendants ─────────────────── */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>👨‍✈️ Pilotes indépendants</span>
                    <button
                      onClick={() => { setShowAddDirect(true); setDirectName(''); setDirectPhone(''); setDirectEmail(''); setDirectError(null) }}
                      style={s.btnInviteSmall}
                    >
                      + Ajouter
                    </button>
                  </div>

                  {!colLoading && (() => {
                    const directs = colleagues.filter(c => c.is_direct && !c.is_fixed)
                    return directs.length === 0
                      ? <p style={{ ...s.muted, padding: '10px 0', textAlign: 'left' }}>Aucun pilote indépendant.</p>
                      : directs.map(c => <ColleagueCard key={c.id} c={c} onOpen={openDetail} />)
                  })()}
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

      {/* ── Modal : ajouter un pilote direct ─────────────────────────────── */}
      {showAddDirect && (
        <ModalOverlay onClose={() => setShowAddDirect(false)}>
          <h3 style={s.modalTitle}>👨‍✈️ Ajouter un pilote</h3>
          <p style={{ color: '#64748b', fontSize: 12, margin: '-8px 0 16px' }}>
            Un collègue indépendant que vous connaissez sur le terrain.
          </p>
          <form onSubmit={handleAddDirect}>
            <label style={s.label}>Prénom / Nom *</label>
            <input
              type="text" value={directName} onChange={e => setDirectName(e.target.value)}
              style={s.input} placeholder="Ex : Robert Payet" autoFocus required
            />

            <label style={{ ...s.label, marginTop: 12 }}>Téléphone</label>
            <input
              type="tel" value={directPhone} onChange={e => setDirectPhone(e.target.value)}
              style={s.input} placeholder="Ex : 0692 …"
            />

            <label style={{ ...s.label, marginTop: 12 }}>Email</label>
            <input
              type="email" value={directEmail} onChange={e => setDirectEmail(e.target.value)}
              style={s.input} placeholder="Ex : robert@parapente.re"
            />

            {directError && <p style={{ ...s.error, marginTop: 8 }}>{directError}</p>}

            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button type="button" onClick={() => setShowAddDirect(false)} style={s.btnGrey}>Annuler</button>
              <button type="submit" disabled={directSaving} style={s.btnGreen}>
                {directSaving ? 'Ajout…' : '✓ Ajouter'}
              </button>
            </div>
          </form>
        </ModalOverlay>
      )}

      {/* ── Modal : fiche collègue ────────────────────────────────────────── */}
      {detailColleague && (
        <ModalOverlay onClose={() => setDetailColleague(null)}>
          <h3 style={{ ...s.modalTitle, marginBottom: 4 }}>
            {detailColleague.name || 'Collègue'}
          </h3>
          <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 12 }}>
            {detailColleague.is_direct
              ? (detailColleague.is_fixed
                  ? `⭐ Pilote fixe · N°${detailColleague.fixed_order || '?'}`
                  : '👨‍✈️ Pilote indépendant')
              : (detailColleague.active
                  ? (detailColleague.invite_used ? '✅ Compte actif' : '⏳ Invitation non utilisée')
                  : '🚫 Accès révoqué')}
          </p>

          {/* Logo of the structure — shown on the planning instead of its name */}
          {!detailColleague.is_direct && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div style={{ width: 64, height: 64, borderRadius: 10, background: '#fff', border: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                {detailColleague.logo_url
                  ? <img src={detailColleague.logo_url} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  : <span style={{ fontSize: 11, color: '#94a3b8' }}>Logo</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ padding: '8px 12px', background: '#1e3a5f', color: '#93c5fd', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  🖼️ {detailColleague.logo_url ? 'Changer le logo' : 'Ajouter le logo'}
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => { handleLogoFile(e.target.files?.[0]); e.target.value = '' }} />
                </label>
                {detailColleague.logo_url && (
                  <button type="button" onClick={() => saveLogo(null)}
                    style={{ padding: '6px 12px', background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Retirer
                  </button>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleSaveDetail}>
            <label style={s.label}>{detailColleague.is_direct ? 'Prénom / Nom' : 'Nom de la structure'}</label>
            <input type="text" value={detailColleague.name || ''} onChange={e => setDetailColleague(p => ({ ...p, name: e.target.value }))} style={s.input} required />

            <label style={{ ...s.label, marginTop: 12 }}>Adresse</label>
            <input type="text" value={detailColleague.address || ''} onChange={e => setDetailColleague(p => ({ ...p, address: e.target.value }))} style={s.input} placeholder="Ex : 12 rue des Flamboyants, 97423 …" />

            <label style={{ ...s.label, marginTop: 12 }}>SIRET</label>
            <input type="text" value={detailColleague.siret || ''} onChange={e => setDetailColleague(p => ({ ...p, siret: e.target.value }))} style={s.input} placeholder="Ex : 123 456 789 00012" />

            <label style={{ ...s.label, marginTop: 12 }}>Téléphone</label>
            <input type="tel" value={detailColleague.phone || ''} onChange={e => setDetailColleague(p => ({ ...p, phone: e.target.value }))} style={s.input} placeholder="Ex : 0692 …" />

            <label style={{ ...s.label, marginTop: 12 }}>Email</label>
            <input type="email" value={detailColleague.email || ''} onChange={e => setDetailColleague(p => ({ ...p, email: e.target.value }))} style={s.input} placeholder="Ex : contact@974parapente.re" />

            {/* Notes libres — uniquement pour pilotes indépendants */}
            {detailColleague.is_direct && (
              <>
                <label style={{ ...s.label, marginTop: 14 }}>📝 Notes</label>
                <textarea
                  value={detailColleague.notes || ''}
                  onChange={e => setDetailColleague(p => ({ ...p, notes: e.target.value }))}
                  rows={3}
                  placeholder="Ex : en vacances du 15 au 20 nov. · disponible le matin uniquement…"
                  style={{
                    ...s.input,
                    resize: 'vertical',
                    minHeight: 72,
                    lineHeight: 1.5,
                    paddingTop: 10,
                    paddingBottom: 10,
                  }}
                />
              </>
            )}

            {detailError && <p style={{ ...s.error, marginTop: 8 }}>{detailError}</p>}

            <button type="submit" disabled={detailSaving} style={{ ...s.btnGreen, width: '100%', marginTop: 16 }}>
              {detailSaving ? 'Sauvegarde…' : '💾 Enregistrer'}
            </button>
          </form>

          {/* Action créneau — uniquement si ouvert depuis un "Pas de pilote" */}
          {requestSlot?.date && (() => {
            const slotLabel = formatSlotForMessage(requestSlot.date, requestSlot.time)

            const smsLink = detailColleague.phone
              ? (() => {
                  const msg = encodeURIComponent(
                    `Salut ${detailColleague.name.split(' ')[0]}, tu es disponible pour assurer un biplace le ${slotLabel} ? — Capitaine`
                  )
                  return `sms:${detailColleague.phone}?body=${msg}`
                })()
              : null

            if (detailColleague.is_fixed) {
              // Pilote fixe → assignation directe EN PREMIER + SMS en option
              return (
                <>
                  <button
                    onClick={async () => {
                      if (!requestSlot.bookingId) { alert('Identifiant de réservation manquant.'); return }
                      const { error } = await supabase
                        .from('booking_assignments')
                        .insert({
                          booking_id:   requestSlot.bookingId,
                          colleague_id: detailColleague.id,
                          pilot_id:     pilot.id,
                          status:       'accepted',
                        })
                      if (error) { alert('Erreur lors de l\'assignation : ' + error.message); return }
                      setDetailColleague(null)
                      setOpen(false)
                      onClose && onClose()
                    }}
                    style={{ display: 'block', width: '100%', marginTop: 12, padding: '13px', background: '#14532d', color: '#86efac', border: '1px solid #16a34a55', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center', boxSizing: 'border-box' }}
                  >
                    ✅ Sélectionner pour {slotLabel}
                  </button>
                  {smsLink && (
                    <a
                      href={smsLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'block', width: '100%', marginTop: 8, padding: '11px', background: 'transparent', color: '#64748b', border: '1px solid #334155', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' }}
                    >
                      💬 Prévenir par SMS
                    </a>
                  )}
                </>
              )
            }

            // Pilote indépendant → SMS
            if (smsLink) {
              return (
                <a
                  href={smsLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'block', width: '100%', marginTop: 12, padding: '13px', background: '#064e3b', color: '#6ee7b7', border: '1px solid #065f4655', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' }}
                >
                  💬 SMS — {slotLabel}
                </a>
              )
            }

            return (
              <p style={{ fontSize: 12, color: '#f59e0b', background: '#451a0333', borderRadius: 6, padding: '8px 10px', marginTop: 10 }}>
                ⚠️ Ajoutez un numéro de téléphone pour envoyer un message.
              </p>
            )
          })()}

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
              {[
                { id: 'invoices', label: `🧾 Factures (${history.invoices.length})` },
                { id: 'vols',     label: `✈ Vols (${history.flights.length})` },
                { id: 'requests', label: `📋 Demandes (${history.requests.length})` },
              ].map(t => (
                <button key={t.id} onClick={() => setHistoryTab(t.id)} style={{ flex: 1, padding: '7px 2px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: historyTab === t.id ? 700 : 500, background: historyTab === t.id ? '#0ea5e9' : '#1e293b', color: historyTab === t.id ? '#fff' : '#94a3b8' }}>{t.label}</button>
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
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                          <span style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 14 }}>{Number(inv.amount_eur).toFixed(2)} €</span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => redownloadInvoice(inv, 'save')} style={{ fontSize: 11, padding: '4px 8px', background: '#1e3a5f', color: '#93c5fd', border: 'none', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}>📥 PDF</button>
                            <button onClick={() => redownloadInvoice(inv, 'send')} style={{ fontSize: 11, padding: '4px 8px', background: '#1e3a5f', color: '#7dd3fc', border: 'none', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}>📧</button>
                            <button onClick={() => deleteInvoice(inv)} style={{ fontSize: 11, padding: '4px 8px', background: '#3b0a0a', color: '#fca5a5', border: 'none', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}>🗑️</button>
                          </div>
                        </div>
                      </div>
                    ))
                )}

                {/* Vols effectués */}
                {historyTab === 'vols' && (() => {
                  if (history.flights.length === 0) return (
                    <p style={s.muted}>Aucun vol enregistré pour ce pilote.</p>
                  )
                  // Compute totals
                  const totalFlights = history.flights.reduce((s, f) => s + (f.count || 1), 0)
                  // Month filter
                  const now    = new Date()
                  const curY   = now.getFullYear()
                  const curM   = now.getMonth()
                  const today  = localDateStr()
                  const todayFlights = history.flights.filter(f => f.date === today)
                  const monthFlights = history.flights.filter(f => {
                    if (!f.date) return false
                    const d = new Date(f.date + 'T00:00:00')
                    return d.getFullYear() === curY && d.getMonth() === curM
                  })
                  const todayCount = todayFlights.reduce((s, f) => s + (f.count || 1), 0)
                  const monthCount = monthFlights.reduce((s, f) => s + (f.count || 1), 0)

                  return (
                    <>
                      {/* Synthèse rapide */}
                      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                        <div style={{ flex: 1, background: '#0f172a', borderRadius: 8, padding: '8px 10px', border: '1px solid #1e293b', textAlign: 'center' }}>
                          <div style={{ fontSize: 18, fontWeight: 800, color: '#38bdf8' }}>{todayCount}</div>
                          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Aujourd'hui</div>
                        </div>
                        <div style={{ flex: 1, background: '#0f172a', borderRadius: 8, padding: '8px 10px', border: '1px solid #1e293b', textAlign: 'center' }}>
                          <div style={{ fontSize: 18, fontWeight: 800, color: '#38bdf8' }}>{monthCount}</div>
                          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Ce mois</div>
                        </div>
                        <div style={{ flex: 1, background: '#0f172a', borderRadius: 8, padding: '8px 10px', border: '1px solid #1e293b', textAlign: 'center' }}>
                          <div style={{ fontSize: 18, fontWeight: 800, color: '#38bdf8' }}>{totalFlights}</div>
                          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Total</div>
                        </div>
                      </div>
                      {/* Liste des vols */}
                      {history.flights.map(f => {
                        const ftLabel = flightTypes.find(ft => ft.id === f.flight_type_id)?.label || f.flight_type_id || 'Vol'
                        return (
                          <div key={f.booking_id} style={{ background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 8, padding: '10px 12px', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 13 }}>
                                {fmtDate(f.date)}{f.time ? ` · ${fmtTime(f.time)}` : ''}
                              </div>
                              <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                                {ftLabel}{f.count > 1 ? ` × ${f.count}` : ''}{f.media_pack ? ' · 📸' : ''}
                              </div>
                              {f.booking_ref && (
                                <div style={{ color: '#475569', fontSize: 11, marginTop: 1 }}>Réf. {f.booking_ref}</div>
                              )}
                            </div>
                            <div style={{ fontSize: 22, color: '#38bdf8' }}>✈</div>
                          </div>
                        )
                      })}
                    </>
                  )
                })()}

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

          {/* Actions selon le type */}
          {detailColleague.is_direct ? (
            /* Pilote direct : rang (si fixe) + bascule fixe/indépendant + supprimer */
            <>
              {/* Rank controls — only for fixed pilots */}
              {detailColleague.is_fixed && (() => {
                const fixedSorted = colleagues
                  .filter(c => c.is_direct && c.is_fixed)
                  .sort((a, b) => (a.fixed_order || 99) - (b.fixed_order || 99))
                  .map((c, i) => ({ ...c, fixed_order: c.fixed_order ?? (i + 1) }))
                const myIdx = fixedSorted.findIndex(c => c.id === detailColleague.id)
                const myOrder = myIdx >= 0 ? fixedSorted[myIdx].fixed_order : (detailColleague.fixed_order ?? 1)
                const isFirst = myIdx === 0
                const isLast = myIdx === fixedSorted.length - 1
                return (
                  <div style={{ marginTop: 14, padding: '12px 14px', background: '#0f172a', borderRadius: 10, border: '1px solid #1e293b' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>
                      ⭐ Rang dans l'équipe
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button
                        onClick={() => handleMoveFixed(-1)}
                        disabled={isFirst}
                        style={{
                          padding: '8px 16px', borderRadius: 8, border: '1px solid #334155',
                          background: isFirst ? '#0f172a' : '#1e293b', color: isFirst ? '#334155' : '#94a3b8',
                          fontSize: 18, fontWeight: 700, cursor: isFirst ? 'default' : 'pointer', fontFamily: 'inherit',
                        }}
                      >↑</button>
                      <span style={{ flex: 1, textAlign: 'center', fontWeight: 700, color: '#fcd34d', fontSize: 18 }}>
                        N°{myOrder}
                      </span>
                      <button
                        onClick={() => handleMoveFixed(1)}
                        disabled={isLast}
                        style={{
                          padding: '8px 16px', borderRadius: 8, border: '1px solid #334155',
                          background: isLast ? '#0f172a' : '#1e293b', color: isLast ? '#334155' : '#94a3b8',
                          fontSize: 18, fontWeight: 700, cursor: isLast ? 'default' : 'pointer', fontFamily: 'inherit',
                        }}
                      >↓</button>
                    </div>
                  </div>
                )
              })()}
              {/* Planning link for fixed pilot */}
              {detailColleague.is_fixed && planningToken && (() => {
                const planningUrl = `${window.location.origin}/pilot-planning/${planningToken}`
                return (
                  <div style={{ marginTop: 14, padding: '12px', background: '#0f2027', border: '1px solid #1d4ed844', borderRadius: 10 }}>
                    <a
                      href={planningUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8, textDecoration: 'none', cursor: 'pointer' }}
                      title="Ouvrir le planning personnel"
                    >
                      📅 Planning personnel ↗
                    </a>
                    <div style={{ fontSize: 11, color: '#64748b', wordBreak: 'break-all', marginBottom: 8 }}>
                      {planningUrl}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => navigator.clipboard?.writeText(planningUrl).catch(() => {})}
                        style={{ flex: 1, padding: '8px', background: '#1e293b', color: '#93c5fd', border: '1px solid #1d4ed844', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        📋 Copier le lien
                      </button>
                      {detailColleague.phone && (
                        <button
                          onClick={async () => {
                            const msg = `Bonjour ${detailColleague.name}, voici votre lien planning : ${planningUrl}`
                            const { error } = await supabase.functions.invoke('send-sms', {
                              body: { to: detailColleague.phone, message: msg },
                            })
                            if (error) alert('Erreur envoi SMS : ' + error.message)
                            else alert('SMS envoyé !')
                          }}
                          style={{ flex: 1, padding: '8px', background: '#1e3a5f', color: '#93c5fd', border: '1px solid #1d4ed844', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          📱 Envoyer par SMS
                        </button>
                      )}
                    </div>
                  </div>
                )
              })()}

              <button
                onClick={handleToggleFixed}
                style={{
                  width: '100%', marginTop: 10, padding: '11px',
                  background: detailColleague.is_fixed ? '#1e293b' : '#451a0333',
                  color: detailColleague.is_fixed ? '#94a3b8' : '#fcd34d',
                  border: detailColleague.is_fixed ? '1px solid #334155' : '1px solid #92400e55',
                  borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {detailColleague.is_fixed
                  ? '👨‍✈️ Remettre en pilote indépendant'
                  : '⭐ Passer en pilote fixe'}
              </button>
              <button
                onClick={handleDeleteColleague}
                style={{ width: '100%', marginTop: 8, padding: '10px', background: '#7f1d1d33', color: '#fca5a5', border: '1px solid #7f1d1d55', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                🗑️ Supprimer ce pilote
              </button>
            </>
          ) : (
            /* Structure : lien d'accès + révoquer / réactiver + supprimer */
            <>
              <div style={{ marginTop: 14, padding: 12, background: '#0f2027', border: '1px solid #1d4ed844', borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                  🔗 Lien d'accès à mon planning
                </div>
                <div style={{ fontSize: 11, color: '#64748b', wordBreak: 'break-all', marginBottom: 8 }}>
                  {structureLink(detailColleague)}
                </div>
                {!detailColleague.invite_used && (
                  <div style={{ fontSize: 11, color: '#fbbf24', marginBottom: 8 }}>
                    ⏳ Lien d'invitation à usage unique : la structure y choisit son code secret.
                  </div>
                )}
                {!detailColleague.active && (
                  <div style={{ fontSize: 11, color: '#f87171', marginBottom: 8 }}>
                    🚫 Accès révoqué : « Renvoyer » le réactive.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button"
                    onClick={() => navigator.clipboard?.writeText(structureLink(detailColleague)).then(() => alert('Lien copié')).catch(() => {})}
                    style={{ flex: 1, padding: 8, background: '#1e293b', color: '#93c5fd', border: '1px solid #1d4ed844', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    📋 Copier
                  </button>
                  <button type="button" onClick={handleResendLink}
                    style={{ flex: 1, padding: 8, background: '#1e3a5f', color: '#93c5fd', border: '1px solid #1d4ed844', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    📤 Renvoyer le lien
                  </button>
                </div>
                {detailColleague.invite_used && (
                  <button type="button" onClick={handleResetInvite}
                    style={{ width: '100%', marginTop: 8, padding: 8, background: 'transparent', color: '#94a3b8', border: '1px dashed #334155', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                    🔑 Code oublié ? Nouvelle invitation
                  </button>
                )}
              </div>
              <button
                onClick={handleToggleActive}
                style={{ width: '100%', marginTop: 10, padding: '10px', background: detailColleague.active ? '#7f1d1d33' : '#14532d33', color: detailColleague.active ? '#fca5a5' : '#86efac', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {detailColleague.active ? 'Révoquer l\'accès' : 'Réactiver'}
              </button>
              <button
                onClick={handleDeleteColleague}
                style={{ width: '100%', marginTop: 8, padding: '10px', background: 'transparent', color: '#64748b', border: '1px solid #334155', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                🗑️ Supprimer cette structure
              </button>
            </>
          )}
        </ModalOverlay>
      )}

      {/* ── Modal : facture ───────────────────────────────────────────────── */}
      {/* ── Popup Gmail pour renvoi depuis historique ─────────────────────── */}
      {gmailPopup && (
        <ModalOverlay onClose={() => setGmailPopup(null)}>
          <h3 style={{ ...s.modalTitle, marginBottom: 14 }}>📧 Envoyer la facture</h3>
          <div style={{ background: '#1e293b', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 13, lineHeight: 1.7 }}>
            <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Étapes</p>
            <p style={{ margin: '2px 0' }}>1️⃣ Cliquez <strong>"Ouvrir Gmail"</strong> ci-dessous</p>
            <p style={{ margin: '2px 0' }}>2️⃣ Dans Gmail, cliquez le trombone 📎</p>
            <p style={{ margin: '2px 0' }}>3️⃣ Cherchez le PDF dans <strong>Téléchargements</strong></p>
            <p style={{ margin: '2px 0' }}>4️⃣ Envoyez le mail</p>
          </div>
          <a href={gmailPopup.url} target="_blank" rel="noopener noreferrer"
            style={{ ...s.btnGreen, background: '#c5221f', display: 'block', textAlign: 'center', textDecoration: 'none', padding: '12px 0', borderRadius: 8, fontSize: 15, fontWeight: 700 }}>
            📧 Ouvrir Gmail →
          </a>
          <button type="button" onClick={() => setGmailPopup(null)}
            style={{ ...s.btnGrey, width: '100%', marginTop: 10 }}>Fermer</button>
        </ModalOverlay>
      )}

      {invoiceColleague && (
        <ModalOverlay onClose={() => { setInvoiceColleague(null); setInvoiceGmailUrl(null) }}>
          <h3 style={{ ...s.modalTitle, marginBottom: 4 }}>🧾 Facture</h3>
          <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 12 }}>
            {invoiceColleague.name} · N° {invoiceNumber || '…'}
          </p>

          {invoiceGmailUrl ? (
            /* ── Écran succès : PDF téléchargé, lien Gmail à cliquer ── */
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, textAlign: 'center' }}>✅ PDF téléchargé !</p>
              <div style={{ background: '#1e293b', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 13, lineHeight: 1.7 }}>
                <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Étapes</p>
                <p style={{ margin: '2px 0' }}>1️⃣ Cliquez <strong>"Ouvrir Gmail"</strong> ci-dessous</p>
                <p style={{ margin: '2px 0' }}>2️⃣ Dans Gmail, cliquez le trombone 📎</p>
                <p style={{ margin: '2px 0' }}>3️⃣ Cherchez le PDF dans <strong>Téléchargements</strong></p>
                <p style={{ margin: '2px 0' }}>4️⃣ Envoyez le mail</p>
              </div>
              <a href={invoiceGmailUrl} target="_blank" rel="noopener noreferrer"
                style={{ ...s.btnGreen, background: '#c5221f', display: 'block', textAlign: 'center', textDecoration: 'none', padding: '12px 0', borderRadius: 8, fontSize: 15, fontWeight: 700 }}>
                📧 Ouvrir Gmail →
              </a>
              <button type="button" onClick={() => { setInvoiceColleague(null); setInvoiceGmailUrl(null) }}
                style={{ ...s.btnGrey, width: '100%', marginTop: 10 }}>Fermer</button>
            </div>
          ) : (
            /* ── Formulaire de saisie ── */
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

              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button type="submit" name="action" value="save" disabled={invoiceSaving} style={{ ...s.btnGreen, flex: 1 }}>{invoiceSaving ? 'Génération…' : '📥 Enregistrer'}</button>
                <button type="submit" name="action" value="send" disabled={invoiceSaving} style={{ ...s.btnGreen, background: '#0369a1', flex: 1 }}>📧 Envoyer</button>
              </div>
              <button type="button" onClick={() => setInvoiceColleague(null)} style={{ ...s.btnGrey, width: '100%', marginTop: 8 }}>Annuler</button>
            </form>
          )}
        </ModalOverlay>
      )}
    </>
  )
}

// ── Carte collègue réutilisable ───────────────────────────────────────────────
function ColleagueCard({ c, onOpen, badge }) {
  return (
    <button
      onClick={() => onOpen(c)}
      style={{
        width: '100%', textAlign: 'left',
        background: c.is_fixed ? '#1c1a0e' : '#1e293b',
        border: c.is_fixed ? '1px solid #78350f55' : '1px solid #334155',
        borderRadius: 10, padding: '12px 14px',
        marginBottom: 8, cursor: 'pointer', opacity: c.active ? 1 : 0.55,
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 700, color: c.is_fixed ? '#fcd34d' : '#f1f5f9', fontSize: 14, marginBottom: 3 }}>
            {badge && <span style={{ marginRight: 4 }}>{badge}</span>}
            {c.name || <em style={{ color: '#64748b' }}>Sans nom</em>}
          </div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            {c.is_direct
              ? (c.notes
                  ? <span style={{ fontStyle: 'italic', color: '#f59e0b' }}>📝 {c.notes.length > 40 ? c.notes.slice(0, 38) + '…' : c.notes}</span>
                  : (c.phone ? `📞 ${c.phone}` : (c.is_fixed ? '⭐ Pilote fixe' : '👨‍✈️ Pilote indépendant')))
              : (c.active
                  ? (c.invite_used ? '✅ Compte actif' : '⏳ Invitation non utilisée')
                  : '🚫 Accès révoqué')}
          </div>
        </div>
        <span style={{ color: '#475569', fontSize: 18 }}>›</span>
      </div>
    </button>
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
  btnInvite:      { width: '100%', padding: '11px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 16, fontFamily: 'inherit' },
  btnInviteSmall: { padding: '5px 12px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
}
