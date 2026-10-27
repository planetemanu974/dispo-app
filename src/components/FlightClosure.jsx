/**
 * FlightClosure.jsx — Clôture / modification des paiements d'un vol.
 *
 * Logique :
 *  - Chaque "règlement" est une carte libre : nom + prénom du payeur,
 *    quantité par type de vol (0–4 par type), méthode, facture.
 *  - Pas de lien avec les passagers de la réservation : le pilote saisit
 *    directement ce qui s'est passé sur le terrain.
 *  - "Ajouter un paiement" crée une carte supplémentaire.
 *  - La sauvegarde est additive : on peut rouvrir et ajouter un 4e
 *    paiement si la dernière personne atterrit plus tard.
 *  - Les numéros de facture déjà attribués sont conservés lors des
 *    ré-enregistrements ultérieurs (pas de doublon).
 */

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildInvoiceNumber, generateInvoice, invoiceFilename } from '../lib/invoice'

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
    quantities:     {},   // { [flightTypeId]: count }
    method:         '',
    invoice:        false,
    invoice_number: null, // gardé si déjà généré
  }
}

/** Reconstruit les cartes depuis closure_data existant */
function parseExistingGroups(closureData, flightTypes) {
  const groups = closureData?.payment_groups
  if (!groups?.length) return null

  return groups.map(g => {
    const quantities = {}

    if (g.flight_lines?.length) {
      // Nouveau format (flight_lines)
      g.flight_lines.forEach(line => {
        if (line.count > 0) quantities[line.flight_type_id] = line.count
      })
    } else if (g.passenger_ids && closureData?.passengers) {
      // Ancien format : compter les passagers par type de vol
      const paxInGroup = closureData.passengers.filter(p =>
        g.passenger_ids.includes(p.id))
      paxInGroup.forEach(p => {
        if (p.actual_flight_type) {
          quantities[p.actual_flight_type] = (quantities[p.actual_flight_type] || 0) + 1
        }
      })
    }

    // Décomposer le nom du payeur
    const parts = (g.payer_name || '').trim().split(/\s+/)
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

/** Calcule le sous-total d'une carte */
function cardTotal(card, flightTypes) {
  return Object.entries(card.quantities).reduce((sum, [ftId, count]) => {
    const price = Number(flightTypes.find(t => t.id === ftId)?.price_eur) || 0
    return sum + price * count
  }, 0)
}

/** Vrai si la carte a au moins un vol */
function hasFlights(card) {
  return Object.values(card.quantities).some(v => v > 0)
}

// ── Composant ──────────────────────────────────────────────────────────────

export default function FlightClosure({
  booking,
  pilot,
  flightTypes,
  onDone,
  onCancel,
}) {
  const flightDate = booking.pilot_slots?.slot_date
    || new Date().toISOString().slice(0, 10)

  // Cartes de paiement — pré-remplies depuis closure_data si disponible
  const [cards, setCards] = useState(() => {
    const existing = parseExistingGroups(booking.closure_data, flightTypes)
    return existing?.length ? existing : [newCard()]
  })

  const [saving, setSaving] = useState(false)

  // ── Mutations ─────────────────────────────────────────────────────────────

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
    if (cards.length === 1) return // garder au moins une carte
    setCards(prev => prev.filter(c => c.id !== id))
  }

  // ── Validation ────────────────────────────────────────────────────────────
  // Au moins une carte avec des vols et une méthode
  const validCards = cards.filter(c => hasFlights(c) && c.method)
  const canSave    = validCards.length > 0

  const grandTotal = cards.reduce((s, c) => s + cardTotal(c, flightTypes), 0)

  // ── Sauvegarde ────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    try {
      // Construire les groupes de paiement
      const paymentGroups = cards
        .filter(c => hasFlights(c) && c.method)
        .map(c => {
          const flight_lines = Object.entries(c.quantities)
            .filter(([, count]) => count > 0)
            .map(([ftId, count]) => {
              const ft = flightTypes.find(t => t.id === ftId)
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
            invoice_number: c.invoice_number, // conserver l'existant
          }
        })

      // Attribuer des numéros de facture aux nouvelles demandes
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

      // Persistance
      const primaryMethod = paymentGroups[0]?.method || ''
      const firstInvNum   = paymentGroups.find(g => g.invoice_number)?.invoice_number || null

      const { error: dbErr } = await supabase.from('bookings').update({
        payment_method: primaryMethod,
        invoice_type:   'custom',
        invoice_number: firstInvNum,
        paid_at:        new Date().toISOString(),
        closure_data:   { payment_groups: paymentGroups },
      }).eq('id', booking.id)

      if (dbErr) throw dbErr

      // Génération des PDFs pour les nouvelles factures
      for (const g of paymentGroups) {
        if (g.invoice === 'single' && g.invoice_number) {
          // Ne re-générer que si c'est nouveau (pas encore dans les cartes initiales)
          const wasExisting = (booking.closure_data?.payment_groups || [])
            .find(old => old.id === g.id && old.invoice_number === g.invoice_number)
          if (!wasExisting) {
            const lines = g.flight_lines.flatMap(line =>
              Array(line.count).fill({
                label:    `${line.label} biplace`,
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
            pilot:         pilot.name,
          },
        })
      } catch (_) {}

      // Mettre à jour les cartes avec les nouveaux invoice_number
      setCards(prev => prev.map(c => {
        const saved = paymentGroups.find(g => g.id === c.id)
        return saved ? { ...c, invoice_number: saved.invoice_number } : c
      }))

      onDone({
        payment_method: primaryMethod,
        invoice_type:   'custom',
        invoice_number: firstInvNum,
        paid_at:        new Date().toISOString(),
        closure_data:   { payment_groups: paymentGroups },
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
      {/* Header */}
      <div style={{ fontSize: 12, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '.6px' }}>
        🛬 Paiements du vol
      </div>

      {/* ── CARTES DE PAIEMENT ─────────────────────────────────────────── */}
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
          {saving ? '⏳ Enregistrement…' : '✓ Enregistrer les paiements'}
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

function FlightTypeRow({ ft, count, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {/* Label du type */}
      <span style={{
        flex: 1, fontSize: 13, color: count > 0 ? '#e2e8f0' : '#64748b',
        fontWeight: count > 0 ? 700 : 400,
      }}>
        {ft.label}
        {ft.price_eur && count === 0 && (
          <span style={{ fontSize: 11, color: '#475569', marginLeft: 4 }}>{ft.price_eur}€</span>
        )}
        {count > 0 && (
          <span style={{ fontSize: 11, color: '#38bdf8', marginLeft: 4 }}>
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
                ? n === 0 ? '2px solid #475569' : '2px solid #38bdf8'
                : '1px solid #334155',
              background: count === n
                ? n === 0 ? '#1e293b' : 'rgba(56,189,248,0.15)'
                : '#0f172a',
              color: count === n
                ? n === 0 ? '#475569' : '#7dd3fc'
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
