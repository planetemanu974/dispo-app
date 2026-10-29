/**
 * FlightClosure.jsx — Clôture / modification des paiements d'un vol.
 *
 * Structure :
 *  1. VOLS DU JOUR — une ligne par vol effectué :
 *       pilote (dropdown) + type de vol + pack média
 *     Ces données alimentent la comptabilité par pilote.
 *
 *  2. PAIEMENTS — une carte par règlement :
 *       nom/prénom du payeur + quantité par type de vol + packs + méthode + facture
 *
 * Les deux sections sont stockées dans closure_data :
 *   { pilot_flights: [...], payment_groups: [...] }
 */

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { buildInvoiceNumber, generateInvoice, invoiceFilename } from '../lib/invoice'

// ── Packs média (fixes, hors flightTypes Supabase) ────────────────────────
const MEDIA_PACKS = [
  { id: 'pack_photo',       label: 'Pack photo',       price_eur: 10, icon: '📷' },
  { id: 'pack_photo_video', label: 'Pack photo+vidéo', price_eur: 20, icon: '🎬' },
]

// Packs pour le sélecteur de la section "Vols du jour"
const MEDIA_PACK_OPTIONS = [
  { id: 'none',              label: 'Aucun média' },
  { id: 'pack_photo',        label: '📷 Pack photo (+10€)' },
  { id: 'pack_photo_video',  label: '🎬 Pack photo+vidéo (+20€)' },
]

// ── Méthodes de paiement ───────────────────────────────────────────────────
const PAY_METHODS = [
  { id: 'cash',  icon: '💶', label: 'Espèces' },
  { id: 'check', icon: '✅', label: 'Chèque'  },
  { id: 'wero',  icon: '📲', label: 'Wero'    },
]

// ── Helpers ────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function newCard() {
  return {
    id:             uid(),
    nom:            '',
    prenom:         '',
    quantities:     {},   // { [flightTypeId | packId]: count }
    method:         '',
    invoice:        false,
    invoice_number: null,
  }
}

function newPilotFlight(pilotName = '') {
  return {
    id:             uid(),
    pilot_name:     pilotName,
    flight_type_id: '',
    media_pack:     'none',
    note:           '',   // free note (e.g. first name)
    email:          '',   // to send photos
  }
}

/** Reconstruit les cartes depuis closure_data existant */
function parseExistingGroups(closureData, flightTypes) {
  const groups = closureData?.payment_groups
  if (!groups?.length) return null

  // All known items = flight types + packs
  const allItems = [...flightTypes, ...MEDIA_PACKS]

  return groups.map(g => {
    const quantities = {}

    if (g.flight_lines?.length) {
      g.flight_lines.forEach(line => {
        if (line.count > 0) quantities[line.flight_type_id] = line.count
      })
    } else if (g.passenger_ids && closureData?.passengers) {
      const paxInGroup = closureData.passengers.filter(p =>
        g.passenger_ids.includes(p.id))
      paxInGroup.forEach(p => {
        if (p.actual_flight_type) {
          quantities[p.actual_flight_type] = (quantities[p.actual_flight_type] || 0) + 1
        }
      })
    }

    const parts  = (g.payer_name || '').trim().split(/\s+/)
    const nom    = parts[0] || ''
    const prenom = parts.slice(1).join(' ')

    return {
      id:             g.id || uid(),
      nom,
      prenom,
      quantities,
      method:         g.method || '',
      invoice:        g.invoice === 'single',
      invoice_number: g.invoice_number || null,
    }
  })
}

/** Reconstruit les vols du jour depuis closure_data existant */
function parseExistingPilotFlights(closureData) {
  const pf = closureData?.pilot_flights
  if (!pf?.length) return null
  return pf.map(entry => ({
    id:             entry.id || uid(),
    pilot_name:     entry.pilot_name || '',
    flight_type_id: entry.flight_type_id || '',
    media_pack:     entry.media_pack || 'none',
    note:           entry.note || '',
    email:          entry.email || '',
  }))
}

/** Calcule le sous-total d'une carte (vols + packs) */
function cardTotal(card, flightTypes) {
  const allItems = [...flightTypes, ...MEDIA_PACKS]
  return Object.entries(card.quantities).reduce((sum, [ftId, count]) => {
    const price = Number(allItems.find(t => t.id === ftId)?.price_eur) || 0
    return sum + price * count
  }, 0)
}

/** Vrai si la carte a au moins un vol ou pack sélectionné */
function hasFlights(card) {
  return Object.values(card.quantities).some(v => v > 0)
}

// ── Composant principal ────────────────────────────────────────────────────

export default function FlightClosure({
  booking,
  pilot,
  flightTypes,
  pilots,      // string[] : [pilote principal, ...collègues du jour]
  onDone,
  onCancel,
}) {
  const flightDate = booking.pilot_slots?.slot_date
    || new Date().toISOString().slice(0, 10)

  // Liste des noms de pilotes disponibles (au moins le pilote lui-même)
  const pilotNames = pilots?.length
    ? pilots
    : [pilot?.name || 'Capitaine']

  // ── État : vols du jour ────────────────────────────────────────────────
  const [pilotFlights, setPilotFlights] = useState(() => {
    const existing = parseExistingPilotFlights(booking.closure_data)
    if (existing?.length) return existing
    // Pré-remplir une ligne par pilote (toi + tous les collègues)
    return pilotNames.map(name => newPilotFlight(name))
  })

  // ── État : cartes de paiement ──────────────────────────────────────────
  const [cards, setCards] = useState(() => {
    const existing = parseExistingGroups(booking.closure_data, flightTypes)
    return existing?.length ? existing : [newCard()]
  })

  const [saving, setSaving] = useState(false)

  // ── Mutations — vols du jour ───────────────────────────────────────────

  function updatePilotFlight(id, key, val) {
    setPilotFlights(prev =>
      prev.map(pf => pf.id === id ? { ...pf, [key]: val } : pf))
  }

  function addPilotFlight() {
    setPilotFlights(prev => [...prev, newPilotFlight(pilotNames[0] || '')])
  }

  function removePilotFlight(id) {
    if (pilotFlights.length === 1) return
    setPilotFlights(prev => prev.filter(pf => pf.id !== id))
  }

  // ── Mutations — cartes de paiement ────────────────────────────────────

  function updateCard(id, key, val) {
    setCards(prev => prev.map(c => c.id === id ? { ...c, [key]: val } : c))
  }

  function setQuantity(cardId, ftId, count) {
    setCards(prev => prev.map(c => {
      if (c.id !== cardId) return c
      const q = { ...c.quantities }
      if (count === 0) delete q[ftId]
      else q[ftId] = count
      return { ...c, quantities: q }
    }))
  }

  function addCard() {
    setCards(prev => [...prev, newCard()])
  }

  function removeCard(id) {
    if (cards.length === 1) return
    setCards(prev => prev.filter(c => c.id !== id))
  }

  // ── Validation ────────────────────────────────────────────────────────
  const validCards = cards.filter(c => hasFlights(c) && c.method)
  const canSave    = validCards.length > 0
  const grandTotal = cards.reduce((s, c) => s + cardTotal(c, flightTypes), 0)

  // ── Sauvegarde ────────────────────────────────────────────────────────

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    try {
      // Light e-mail validation (optional field)
      const badEmail = pilotFlights.find(pf => pf.email && pf.email.trim() && !/^\S+@\S+\.\S+$/.test(pf.email.trim()))
      if (badEmail) {
        alert('Adresse e-mail invalide : ' + badEmail.email)
        setSaving(false)
        return
      }

      const allItems = [...flightTypes, ...MEDIA_PACKS]

      // Construire les groupes de paiement
      const paymentGroups = cards
        .filter(c => hasFlights(c) && c.method)
        .map(c => {
          const flight_lines = Object.entries(c.quantities)
            .filter(([, count]) => count > 0)
            .map(([ftId, count]) => {
              const ft = allItems.find(t => t.id === ftId)
              return {
                flight_type_id: ftId,
                label:          ft?.label || ftId,
                count,
                price_eur:      ft?.price_eur || 0,
              }
            })

          const payerName = [c.nom, c.prenom].filter(Boolean).join(' ') || '—'
          return {
            id:             c.id,
            payer_name:     payerName,
            method:         c.method,
            invoice:        c.invoice ? 'single' : 'none',
            flight_lines,
            invoice_number: c.invoice_number,
          }
        })

      // Attribuer les numéros de facture manquants
      const dayPrefix = buildInvoiceNumber(flightDate, 0).replace('/0', '')
      const { data: todayInvoices } = await supabase
        .from('bookings')
        .select('invoice_number')
        .like('invoice_number', `${dayPrefix}/%`)
        .not('invoice_number', 'is', null)
      let nextSeq = (todayInvoices?.length || 0) + 1

      for (const g of paymentGroups) {
        if (g.invoice === 'single' && !g.invoice_number) {
          g.invoice_number = buildInvoiceNumber(flightDate, nextSeq++)
        }
      }

      // Vols du jour (validation légère : garder même si incomplet)
      const savedPilotFlights = pilotFlights
        .filter(pf => pf.pilot_name || pf.flight_type_id)
        .map(pf => ({
          id:             pf.id,
          pilot_name:     pf.pilot_name,
          flight_type_id: pf.flight_type_id,
          media_pack:     pf.media_pack,
          note:           (pf.note || '').trim(),
          email:          (pf.email || '').trim(),
        }))

      // Persistance
      const primaryMethod = paymentGroups[0]?.method || ''
      const firstInvNum   = paymentGroups.find(g => g.invoice_number)?.invoice_number || null

      const { error: dbErr } = await supabase.from('bookings').update({
        payment_method: primaryMethod,
        invoice_type:   'custom',
        invoice_number: firstInvNum,
        paid_at:        new Date().toISOString(),
        closure_data:   {
          pilot_flights:  savedPilotFlights,
          payment_groups: paymentGroups,
        },
      }).eq('id', booking.id)

      if (dbErr) throw dbErr

      // Génération des PDFs pour les nouvelles factures
      for (const g of paymentGroups) {
        if (g.invoice === 'single' && g.invoice_number) {
          const wasExisting = (booking.closure_data?.payment_groups || [])
            .find(old => old.id === g.id && old.invoice_number === g.invoice_number)
          if (!wasExisting) {
            const lines = g.flight_lines.flatMap(line =>
              Array(line.count).fill({
                label:    `${line.label}`,
                priceEur: line.price_eur,
              })
            )
            const doc = generateInvoice({
              invoiceNumber: g.invoice_number,
              date:          flightDate,
              clientName:    g.payer_name,
              lines,
            })
            doc.save(invoiceFilename(g.invoice_number))
          }
        }
      }

      // Log activité (non-bloquant)
      try {
        await supabase.from('activity_log').insert({
          pilot_id:    pilot.id,
          action:      'booking_payment_saved',
          entity_type: 'booking',
          entity_id:   booking.id,
          details: {
            booking_ref:   booking.booking_ref,
            groups:        paymentGroups.length,
            pilot_flights: savedPilotFlights.length,
            pilot:         pilot.name,
          },
        })
      } catch (_) {}

      // Mettre à jour les cartes avec les invoice_number attribués
      setCards(prev => prev.map(c => {
        const saved = paymentGroups.find(g => g.id === c.id)
        return saved ? { ...c, invoice_number: saved.invoice_number } : c
      }))

      onDone({
        payment_method: primaryMethod,
        invoice_type:   'custom',
        invoice_number: firstInvNum,
        paid_at:        new Date().toISOString(),
        closure_data:   {
          pilot_flights:  savedPilotFlights,
          payment_groups: paymentGroups,
        },
      })

    } catch (err) {
      console.error('[FlightClosure] save error:', err)
      alert('Erreur lors de l\'enregistrement : ' + (err.message || err))
    } finally {
      setSaving(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{
      background: '#0f172a',
      border: '1px solid #1e293b',
      borderRadius: 12,
      padding: '14px 14px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }}>

      {/* ── SECTION 1 : VOLS DU JOUR ──────────────────────────────────── */}
      <div style={{
        background: '#0c1a2e',
        border: '1px solid #1e3a5f',
        borderRadius: 10,
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}>
        {/* Titre section */}
        <div style={{
          fontSize: 11, fontWeight: 800, color: '#7dd3fc',
          textTransform: 'uppercase', letterSpacing: '.6px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>🧑‍✈️ Vols du jour</span>
          <span style={{ fontSize: 10, color: '#475569', fontWeight: 400, textTransform: 'none' }}>
            {pilotFlights.length} vol{pilotFlights.length > 1 ? 's' : ''}
          </span>
        </div>

        {/* Lignes de vols */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {pilotFlights.map((pf, idx) => (
            <PilotFlightRow
              key={pf.id}
              pf={pf}
              idx={idx}
              pilotNames={pilotNames}
              flightTypes={flightTypes}
              canRemove={pilotFlights.length > 1}
              onChange={(key, val) => updatePilotFlight(pf.id, key, val)}
              onRemove={() => removePilotFlight(pf.id)}
            />
          ))}
        </div>

        {/* Ajouter un vol */}
        <button
          onClick={addPilotFlight}
          style={{
            padding: '8px', borderRadius: 8, cursor: 'pointer',
            border: '1.5px dashed #1e3a5f', background: 'transparent',
            color: '#475569', fontSize: 12, fontWeight: 700,
            fontFamily: 'inherit',
          }}>
          + Ajouter un vol
        </button>
      </div>

      {/* Séparateur */}
      <div style={{
        fontSize: 11, fontWeight: 800, color: '#38bdf8',
        textTransform: 'uppercase', letterSpacing: '.6px',
      }}>
        💳 Paiements
      </div>

      {/* ── SECTION 2 : CARTES DE PAIEMENT ───────────────────────────── */}
      {cards.map((card, cardIndex) => (
        <PaymentCard
          key={card.id}
          card={card}
          cardIndex={cardIndex}
          flightTypes={flightTypes}
          canRemove={cards.length > 1}
          onNom={v    => updateCard(card.id, 'nom', v)}
          onPrenom={v => updateCard(card.id, 'prenom', v)}
          onQuantity={(ftId, count) => setQuantity(card.id, ftId, count)}
          onMethod={v  => updateCard(card.id, 'method', v)}
          onInvoice={v => updateCard(card.id, 'invoice', v)}
          onRemove={() => removeCard(card.id)}
          subtotal={cardTotal(card, flightTypes)}
        />
      ))}

      {/* Ajouter un paiement */}
      <button
        onClick={addCard}
        style={{
          padding: '10px', borderRadius: 10, cursor: 'pointer',
          border: '1.5px dashed #334155', background: 'transparent',
          color: '#64748b', fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
        }}>
        + Ajouter un paiement
      </button>

      {/* ── TOTAL GÉNÉRAL ─────────────────────────────────────────────── */}
      {cards.length > 1 && grandTotal > 0 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '9px 12px',
          background: 'rgba(56,189,248,0.05)',
          border: '1px solid rgba(56,189,248,0.15)',
          borderRadius: 8,
        }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {cards.filter(c => hasFlights(c)).length} règlement{cards.filter(c => hasFlights(c)).length > 1 ? 's' : ''}
          </span>
          <span style={{ fontSize: 16, fontWeight: 800, color: '#38bdf8' }}>
            Total : {grandTotal} €
          </span>
        </div>
      )}

      {/* ── ACTIONS ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          disabled={saving || !canSave}
          onClick={handleSave}
          style={{
            flex: 2, padding: '12px', borderRadius: 10, border: 'none',
            cursor: saving || !canSave ? 'not-allowed' : 'pointer',
            background: saving || !canSave
              ? '#1e293b'
              : 'linear-gradient(135deg,#1d4ed8,#2563eb)',
            color:  saving || !canSave ? '#475569' : 'white',
            fontWeight: 800, fontSize: 14, fontFamily: 'inherit',
          }}>
          {saving ? '⏳ Enregistrement…' : '✓ Enregistrer'}
        </button>
        <button onClick={onCancel}
          style={{
            flex: 1, padding: '12px', borderRadius: 10,
            border: '1px solid #334155', background: '#1e293b',
            color: '#94a3b8', fontWeight: 600, fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
          Fermer
        </button>
      </div>
    </div>
  )
}

// ── Ligne d'un vol du jour (pilote + type + pack) — layout compact ────────
//
// Chaque ligne = une rangée sur mobile :
//   [Pilote ▾]  [Type de vol ▾]  [Pack ▾]  [✕]

function PilotFlightRow({ pf, idx, pilotNames, flightTypes, canRemove, onChange, onRemove }) {
  const hasType = !!pf.flight_type_id
  const hasPack = pf.media_pack !== 'none'

  // Mode "Autre" : actif si le nom actuel n'est pas dans la liste connue
  const isCustomName = pf.pilot_name !== '' && !pilotNames.includes(pf.pilot_name)
  const [customMode, setCustomMode] = useState(isCustomName)

  // Sync si pilotNames change après le montage (cas rare)
  useEffect(() => {
    if (customMode && pilotNames.includes(pf.pilot_name)) setCustomMode(false)
  }, [pilotNames]) // eslint-disable-line

  const selectBase = {
    background: '#1e293b', border: '1px solid #334155',
    borderRadius: 7, padding: '9px 6px', fontFamily: 'inherit',
    cursor: 'pointer', minWidth: 0,
  }

  function handlePilotSelect(e) {
    if (e.target.value === '__autre__') {
      // Basculer sur le champ texte libre, vider le nom
      setCustomMode(true)
      onChange('pilot_name', '')
    } else {
      onChange('pilot_name', e.target.value)
    }
  }

  function handleCustomBack() {
    setCustomMode(false)
    onChange('pilot_name', pilotNames[0] || '')
  }

  const noteInputStyle = {
    background: '#1e293b', border: '1px solid #334155', borderRadius: 7,
    padding: '7px 8px', fontFamily: 'inherit', fontSize: 12,
    color: '#e2e8f0', minWidth: 0, flex: 1,
  }

  return (
    <div style={{ borderBottom: '1px solid #1e293b', padding: '4px 0' }}>
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 5,
    }}>
      {/* Numéro */}
      <span style={{ fontSize: 11, color: '#334155', fontWeight: 700, minWidth: 16, textAlign: 'right', flexShrink: 0 }}>
        {idx + 1}
      </span>

      {/* Pilote : dropdown OU champ texte libre (mode "Autre") */}
      {customMode ? (
        <div style={{ flex: 1.2, display: 'flex', gap: 3, minWidth: 0 }}>
          {/* Champ texte libre pour un pilote non listé */}
          <input
            autoFocus
            type="text"
            value={pf.pilot_name}
            onChange={e => onChange('pilot_name', e.target.value)}
            placeholder="Prénom du pilote…"
            style={{
              flex: 1,
              background: 'rgba(251,191,36,0.06)',
              border: '1px solid rgba(251,191,36,0.35)',
              borderRadius: 7, padding: '9px 7px',
              fontFamily: 'inherit', fontSize: 13,
              color: '#fbbf24', minWidth: 0,
            }}
          />
          {/* Retour vers la liste */}
          <button
            onClick={handleCustomBack}
            title="Revenir à la liste"
            style={{
              background: 'none', border: '1px solid #334155',
              borderRadius: 7, padding: '6px 7px',
              cursor: 'pointer', color: '#475569', fontSize: 13, flexShrink: 0,
            }}>
            ←
          </button>
        </div>
      ) : (
        <select
          value={pf.pilot_name}
          onChange={handlePilotSelect}
          style={{
            ...selectBase,
            flex: 1.2,
            fontSize: 13,
            color: pf.pilot_name ? '#e2e8f0' : '#64748b',
          }}>
          <option value="">— Pilote —</option>
          {pilotNames.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
          {/* Option pour saisir un pilote hors liste */}
          <option value="__autre__">✏️ Autre…</option>
        </select>
      )}

      {/* Dropdown type de vol */}
      <select
        value={pf.flight_type_id}
        onChange={e => onChange('flight_type_id', e.target.value)}
        style={{
          ...selectBase,
          flex: 1.2,
          fontSize: 13,
          color:      hasType ? '#7dd3fc' : '#64748b',
          background: hasType ? 'rgba(125,211,252,0.07)' : '#1e293b',
          border:     hasType ? '1px solid rgba(125,211,252,0.25)' : '1px solid #334155',
        }}>
        <option value="">— Type —</option>
        {flightTypes.map(ft => (
          <option key={ft.id} value={ft.id}>{ft.label}</option>
        ))}
      </select>

      {/* Dropdown pack média */}
      <select
        value={pf.media_pack}
        onChange={e => onChange('media_pack', e.target.value)}
        style={{
          ...selectBase,
          flex: 1,
          fontSize: 12,
          color:      hasPack ? '#fbbf24' : '#475569',
          background: hasPack ? 'rgba(251,191,36,0.07)' : '#1e293b',
          border:     hasPack ? '1px solid rgba(251,191,36,0.25)' : '1px solid #334155',
        }}>
        <option value="none">Aucun</option>
        <option value="pack_photo">📷 Photo +10€</option>
        <option value="pack_photo_video">🎬 Vidéo +20€</option>
      </select>

      {/* Supprimer */}
      {canRemove ? (
        <button onClick={onRemove}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#334155', fontSize: 14, lineHeight: 1,
            padding: '4px', flexShrink: 0,
          }}
          title="Supprimer ce vol">
          ✕
        </button>
      ) : (
        <span style={{ width: 22, flexShrink: 0 }} />
      )}
    </div>
    {/* Note + e-mail (to send photos) */}
    <div style={{ display: 'flex', gap: 5, marginTop: 4, paddingLeft: 21, paddingRight: 22 }}>
      <input type="text" value={pf.note || ''} placeholder="📝 Prénom / note"
        onChange={e => onChange('note', e.target.value)} style={noteInputStyle} />
      <input type="email" inputMode="email" autoCapitalize="none" value={pf.email || ''}
        placeholder="✉️ E-mail (photos)"
        onChange={e => onChange('email', e.target.value)} style={{ ...noteInputStyle, flex: 1.3 }} />
    </div>
    </div>
  )
}

// ── Carte de paiement ──────────────────────────────────────────────────────

function PaymentCard({
  card, cardIndex, flightTypes,
  canRemove,
  onNom, onPrenom, onQuantity, onMethod, onInvoice, onRemove,
  subtotal,
}) {
  const hasAny = hasFlights(card)

  return (
    <div style={{
      background: '#1e293b',
      borderRadius: 10,
      padding: '12px 12px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      border: card.method && hasAny
        ? '1px solid rgba(34,197,94,0.25)'
        : '1px solid #334155',
    }}>
      {/* Titre + supprimer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.4px' }}>
          Règlement {cardIndex + 1}
        </span>
        {canRemove && (
          <button onClick={onRemove}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
            title="Supprimer ce règlement">
            🗑
          </button>
        )}
      </div>

      {/* Nom / Prénom */}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text" value={card.nom} onChange={e => onNom(e.target.value)}
          placeholder="Nom"
          style={inputStyle} />
        <input
          type="text" value={card.prenom} onChange={e => onPrenom(e.target.value)}
          placeholder="Prénom"
          style={inputStyle} />
      </div>

      {/* Types de vol + quantités */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {flightTypes.map(ft => (
          <FlightTypeRow
            key={ft.id}
            ft={ft}
            count={card.quantities[ft.id] || 0}
            onChange={count => onQuantity(ft.id, count)}
          />
        ))}
      </div>

      {/* Packs média — séparateur visuel */}
      <div style={{ borderTop: '1px solid #334155', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 10, color: '#475569', fontWeight: 600, letterSpacing: '.3px' }}>
          PACKS MÉDIA
        </div>
        {MEDIA_PACKS.map(pack => (
          <FlightTypeRow
            key={pack.id}
            ft={pack}
            count={card.quantities[pack.id] || 0}
            onChange={count => onQuantity(pack.id, count)}
            accent="#fbbf24"
          />
        ))}
      </div>

      {/* Méthode de paiement */}
      <div style={{ display: 'flex', gap: 5 }}>
        {PAY_METHODS.map(pm => (
          <button key={pm.id}
            onClick={() => onMethod(pm.id)}
            style={{
              flex: 1, padding: '9px 4px', borderRadius: 8, cursor: 'pointer',
              fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
              border:      card.method === pm.id ? '2px solid #22c55e' : '1px solid #334155',
              background:  card.method === pm.id ? 'rgba(34,197,94,0.12)' : '#0f172a',
              color:       card.method === pm.id ? '#86efac' : '#94a3b8',
            }}>
            {pm.icon}<br />{pm.label}
          </button>
        ))}
      </div>

      {/* Facture */}
      <div style={{ display: 'flex', gap: 5 }}>
        <button onClick={() => onInvoice(false)}
          style={invoiceBtnStyle(!card.invoice)}>
          🚫 Sans facture
        </button>
        <button onClick={() => onInvoice(true)}
          style={invoiceBtnStyle(card.invoice)}>
          🧾 Avec facture
        </button>
      </div>

      {/* Numéro de facture déjà attribué */}
      {card.invoice_number && (
        <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right' }}>
          📄 {card.invoice_number}
        </div>
      )}

      {/* Sous-total */}
      {subtotal > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 15, fontWeight: 800, color: '#38bdf8' }}>
          {subtotal} €
        </div>
      )}
    </div>
  )
}

// ── Ligne type de vol + quantité ───────────────────────────────────────────

function FlightTypeRow({ ft, count, onChange, accent = '#38bdf8' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {/* Label + icône éventuelle */}
      <span style={{
        flex: 1, fontSize: 13, color: count > 0 ? '#e2e8f0' : '#64748b',
        fontWeight: count > 0 ? 700 : 400,
      }}>
        {ft.icon && <span style={{ marginRight: 4 }}>{ft.icon}</span>}
        {ft.label}
        {ft.price_eur && count === 0 && (
          <span style={{ fontSize: 11, color: '#475569', marginLeft: 4 }}>{ft.price_eur}€</span>
        )}
        {count > 0 && (
          <span style={{ fontSize: 11, color: accent, marginLeft: 4 }}>
            × {count} = {count * ft.price_eur}€
          </span>
        )}
      </span>

      {/* Sélecteur 0–4 */}
      <div style={{ display: 'flex', gap: 3 }}>
        {[0, 1, 2, 3, 4].map(n => (
          <button key={n}
            onClick={() => onChange(n)}
            style={{
              width: 30, height: 30, borderRadius: 6,
              border: count === n
                ? n === 0 ? '2px solid #475569' : `2px solid ${accent}`
                : '1px solid #334155',
              background: count === n
                ? n === 0 ? '#1e293b' : `rgba(${accent === '#fbbf24' ? '251,191,36' : '56,189,248'},0.15)`
                : '#0f172a',
              color: count === n
                ? n === 0 ? '#475569' : accent
                : '#475569',
              fontSize: 13, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
              lineHeight: 1,
            }}>
            {n === 0 ? '—' : n}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Styles réutilisés ──────────────────────────────────────────────────────

const inputStyle = {
  flex: 1, background: '#0f172a', border: '1px solid #334155',
  borderRadius: 8, padding: '8px 10px', color: '#e2e8f0',
  fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box',
  minWidth: 0,
}

function invoiceBtnStyle(active) {
  return {
    flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer',
    fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
    border:     active ? '2px solid #a78bfa' : '1px solid #334155',
    background: active ? 'rgba(167,139,250,0.12)' : '#0f172a',
    color:      active ? '#c4b5fd' : '#94a3b8',
  }
}
