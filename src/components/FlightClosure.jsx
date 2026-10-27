/**
 * FlightClosure.jsx — Clôture de vol par passager.
 *
 * SECTION PASSAGERS : ajuster pilote réel + type de vol par passager.
 * SECTION RÈGLEMENT : groupes de paiement flexibles.
 *   - Par défaut : un groupe par passager (payer = nom du passager).
 *   - L'utilisateur peut fusionner des passagers dans un même groupe
 *     en cliquant "+ <Nom>" sur la carte d'un groupe.
 *   - Chaque groupe : nom du payeur (éditable) · Espèces/Chèque/Wero
 *     · Sans facture / Avec facture · sous-total.
 *   - Les PDFs se téléchargent immédiatement à la clôture.
 */

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildInvoiceNumber, generateInvoice, invoiceFilename } from '../lib/invoice'

// ── Modes de paiement (pas de CB) ─────────────────────────────────────────────
const PAY_METHODS = [
  { id: 'cash',  icon: '💶', label: 'Espèces' },
  { id: 'check', icon: '✅', label: 'Chèque'  },
  { id: 'wero',  icon: '📲', label: 'Wero'    },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function paxDisplayName(p, index) {
  const full = [p.first_name, p.last_name].filter(Boolean).join(' ')
  return full || `Passager ${index + 1}`
}

function catLabel(p) {
  if (p.age != null && p.age < 14) return '< 14 ans'
  const w = Number(p.weight_kg)
  if (!w) return ''
  if (w <= 60)  return '≤ 60 kg'
  if (w <= 75)  return '61–75 kg'
  if (w <= 100) return '76–100 kg'
  return '> 100 kg'
}

// ── Composant ────────────────────────────────────────────────────────────────

export default function FlightClosure({
  booking,
  pilot,
  colleagues,
  flightTypes,
  bookingAssignments,
  onDone,
  onCancel,
}) {
  const passengers  = booking.passengers || []
  const flightDate  = booking.pilot_slots?.slot_date
    || new Date().toISOString().slice(0, 10)

  // ── Pilote par défaut par passager ────────────────────────────────────────
  function defaultPilotFor(index) {
    const sortedFixed = (colleagues || [])
      .filter(c => c.is_direct && c.is_fixed)
      .sort((a, b) => (a.fixed_order ?? 99) - (b.fixed_order ?? 99))
    const fixedIds = new Set(sortedFixed.map(c => c.id))
    const freelancers = (bookingAssignments || [])
      .filter(a => a.status === 'accepted' && !fixedIds.has(a.colleague_id))
      .map(a => a.colleagues?.name).filter(Boolean)
    if (index === 0) return sortedFixed[0]?.name || pilot.name
    return sortedFixed[index]?.name
      || freelancers[index - sortedFixed.length]
      || pilot.name
  }

  // ── Config par passager (pilote + type de vol) ────────────────────────────
  const [paxConfig, setPaxConfig] = useState(() => {
    const cfg = {}
    passengers.forEach((p, i) => {
      cfg[p.id] = {
        actualPilot:      defaultPilotFor(i),
        actualFlightType: p.flight_type,
      }
    })
    return cfg
  })

  function updatePax(id, key, val) {
    setPaxConfig(prev => ({ ...prev, [id]: { ...prev[id], [key]: val } }))
  }

  // ── Groupes de paiement ───────────────────────────────────────────────────
  // paxAssignment[paxId] = id du passager "chef de groupe"
  // Initialement chaque passager est son propre chef de groupe.
  const [paxAssignment, setPaxAssignment] = useState(() => {
    const a = {}
    passengers.forEach(p => { a[p.id] = p.id })
    return a
  })

  // payConfig[chefId] = { payerName, method, invoice }
  const [payConfig, setPayConfig] = useState(() => {
    const c = {}
    passengers.forEach((p, i) => {
      c[p.id] = {
        payerName: paxDisplayName(p, i),
        method:    '',
        invoice:   false,
      }
    })
    return c
  })

  // Chefs de groupe actifs = passagers qui sont leur propre chef
  const groupLeaders = passengers.filter(p => paxAssignment[p.id] === p.id)

  function groupMembers(leaderId) {
    return passengers.filter(p => paxAssignment[p.id] === leaderId)
  }

  function addToGroup(paxId, leaderId) {
    setPaxAssignment(prev => ({ ...prev, [paxId]: leaderId }))
  }

  function removeFromGroup(paxId) {
    // Redevient chef de son propre groupe
    setPaxAssignment(prev => ({ ...prev, [paxId]: paxId }))
  }

  function updatePayConfig(leaderId, key, val) {
    setPayConfig(prev => ({ ...prev, [leaderId]: { ...prev[leaderId], [key]: val } }))
  }

  // ── Prix ──────────────────────────────────────────────────────────────────
  function priceOf(ftId) {
    return Number(flightTypes.find(t => t.id === ftId)?.price_eur) || 0
  }

  function groupTotal(leaderId) {
    return groupMembers(leaderId).reduce((s, p) => {
      return s + priceOf(paxConfig[p.id]?.actualFlightType || p.flight_type)
    }, 0)
  }

  function totalEur() {
    return passengers.reduce((s, p) =>
      s + priceOf(paxConfig[p.id]?.actualFlightType || p.flight_type), 0)
  }

  // ── Validation ────────────────────────────────────────────────────────────
  const isValid = groupLeaders.every(p => !!payConfig[p.id]?.method)

  const [saving, setSaving] = useState(false)

  // Tous les pilotes disponibles
  const allPilotOptions = [
    { name: pilot.name, label: `✈️ ${pilot.name} (moi)` },
    ...(colleagues || []).map(c => ({ name: c.name, label: c.name })),
  ]

  // ── Sauvegarde ────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!isValid) return
    setSaving(true)
    try {
      // 1. Passagers
      const closurePassengers = passengers.map(p => ({
        id:                 p.id,
        name:               paxDisplayName(p, passengers.indexOf(p)),
        actual_pilot:       paxConfig[p.id]?.actualPilot || pilot.name,
        actual_flight_type: paxConfig[p.id]?.actualFlightType || p.flight_type,
      }))

      // 2. Groupes de paiement
      const paymentGroups = groupLeaders.map(leader => {
        const members = groupMembers(leader.id)
        const cfg     = payConfig[leader.id]
        return {
          passenger_ids: members.map(m => m.id),
          method:        cfg.method,
          invoice:       cfg.invoice ? 'single' : 'none',
          payer_name:    cfg.payerName,
        }
      })

      // 3. Numéros de factures
      const dayPrefix = buildInvoiceNumber(flightDate, 0).replace('/0', '')
      const { data: todayInvoices } = await supabase
        .from('bookings')
        .select('invoice_number')
        .like('invoice_number', `${dayPrefix}/%`)
        .not('invoice_number', 'is', null)
      let nextSeq = (todayInvoices?.length || 0) + 1

      for (const g of paymentGroups) {
        if (g.invoice === 'single') {
          g.invoice_number = buildInvoiceNumber(flightDate, nextSeq++)
        }
      }

      // 4. Persistance DB
      const primaryPilot  = closurePassengers[0]?.actual_pilot || pilot.name
      const primaryMethod = paymentGroups[0]?.method || ''
      const firstInvNum   = paymentGroups.find(g => g.invoice_number)?.invoice_number || null

      const { error: dbErr } = await supabase.from('bookings').update({
        flew_pilot_name: primaryPilot,
        payment_method:  primaryMethod,
        invoice_type:    'custom',
        invoice_number:  firstInvNum,
        paid_at:         new Date().toISOString(),
        closure_data:    { passengers: closurePassengers, payment_groups: paymentGroups },
      }).eq('id', booking.id)

      if (dbErr) throw dbErr

      // 5. PDFs
      for (const g of paymentGroups) {
        if (g.invoice === 'single' && g.invoice_number) {
          const paxInGroup = passengers.filter(p => g.passenger_ids.includes(p.id))
          const lines = paxInGroup.map(p => {
            const ft = flightTypes.find(t =>
              t.id === (paxConfig[p.id]?.actualFlightType || p.flight_type))
            return {
              label:    ft ? `${ft.label} biplace` : 'Prestation biplace',
              priceEur: ft?.price_eur || 0,
            }
          })
          const doc = generateInvoice({
            invoiceNumber: g.invoice_number,
            date:          flightDate,
            clientName:    g.payer_name || booking.contact_name || '—',
            lines,
          })
          doc.save(invoiceFilename(g.invoice_number))
        }
      }

      // 6. Log
      try {
        await supabase.from('activity_log').insert({
          pilot_id:    pilot.id,
          action:      'booking_closed',
          entity_type: 'booking',
          entity_id:   booking.id,
          details: {
            booking_ref:   booking.booking_ref,
            contact_name:  booking.contact_name,
            pax_count:     passengers.length,
            groups:        paymentGroups.length,
            pilot:         primaryPilot,
          },
        })
      } catch (_) {}

      // 7. Notifier le parent
      onDone({
        flew_pilot_name: primaryPilot,
        payment_method:  primaryMethod,
        invoice_type:    'custom',
        invoice_number:  firstInvNum,
        paid_at:         new Date().toISOString(),
        closure_data:    { passengers: closurePassengers, payment_groups: paymentGroups },
      })

    } catch (err) {
      console.error('[FlightClosure] save error:', err)
      alert('Erreur lors de la clôture : ' + (err.message || err))
    } finally {
      setSaving(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Styles inline (réutilisés)
  // ─────────────────────────────────────────────────────────────────────────

  const sectionLabel = {
    fontSize: 11, fontWeight: 700, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6,
  }

  const cardStyle = {
    background: '#1e293b',
    borderRadius: 10,
    padding: '11px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  }

  function methodBtnStyle(active) {
    return {
      flex: 1, padding: '9px 4px', borderRadius: 8, cursor: 'pointer',
      fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
      border:      active ? '2px solid #22c55e' : '1px solid #334155',
      background:  active ? 'rgba(34,197,94,0.12)' : '#0f172a',
      color:       active ? '#86efac' : '#94a3b8',
    }
  }

  function invoiceBtnStyle(active) {
    return {
      flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer',
      fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
      border:      active ? '2px solid #a78bfa' : '1px solid #334155',
      background:  active ? 'rgba(167,139,250,0.12)' : '#0f172a',
      color:       active ? '#c4b5fd' : '#94a3b8',
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
      gap: 16,
    }}>
      {/* Header */}
      <div style={{ fontSize: 12, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '.6px' }}>
        🛬 Clôture du vol
      </div>

      {/* ── SECTION PASSAGERS ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={sectionLabel}>Passagers &amp; pilotes</div>

        {passengers.map((p, i) => {
          const cfg      = paxConfig[p.id] || {}
          const actualFt = cfg.actualFlightType || p.flight_type
          const changed  = actualFt !== p.flight_type

          return (
            <div key={p.id} style={cardStyle}>
              <div style={{ fontSize: 13, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: '#e2e8f0' }}>{paxDisplayName(p, i)}</span>
                {catLabel(p) && <span style={{ fontSize: 11, color: '#64748b' }}>{catLabel(p)}</span>}
                {changed && <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>· type modifié ↗</span>}
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                {/* Pilote */}
                <select
                  value={cfg.actualPilot || pilot.name}
                  onChange={e => updatePax(p.id, 'actualPilot', e.target.value)}
                  style={{
                    flex: 1, background: '#0f172a', border: '1px solid #334155',
                    borderRadius: 8, padding: '7px 8px', color: '#e2e8f0',
                    fontSize: 13, fontFamily: 'inherit',
                  }}>
                  {allPilotOptions.map(pl => (
                    <option key={pl.name} value={pl.name}>{pl.label}</option>
                  ))}
                </select>

                {/* Type de vol */}
                <select
                  value={actualFt}
                  onChange={e => updatePax(p.id, 'actualFlightType', e.target.value)}
                  style={{
                    flex: 1,
                    background: changed ? 'rgba(245,158,11,0.08)' : '#0f172a',
                    border:     changed ? '1.5px solid #f59e0b' : '1px solid #334155',
                    borderRadius: 8, padding: '7px 8px',
                    color:      changed ? '#fcd34d' : '#e2e8f0',
                    fontSize: 13, fontFamily: 'inherit',
                  }}>
                  {flightTypes.map(ft => (
                    <option key={ft.id} value={ft.id}>✈️ {ft.label} — {ft.price_eur}€</option>
                  ))}
                </select>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── SECTION RÈGLEMENT ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={sectionLabel}>Règlement · {groupLeaders.length} règlement{groupLeaders.length > 1 ? 's' : ''}</div>

        {groupLeaders.map(leader => {
          const members     = groupMembers(leader.id)
          const cfg         = payConfig[leader.id] || {}
          // Autres chefs de groupe qui pourraient rejoindre ce groupe
          const otherLeaders = groupLeaders.filter(l => l.id !== leader.id)
          const subtotal    = groupTotal(leader.id)

          return (
            <div key={leader.id} style={{
              ...cardStyle,
              border: cfg.method
                ? '1px solid rgba(34,197,94,0.25)'
                : '1px solid #334155',
            }}>
              {/* Nom du payeur */}
              <input
                type="text"
                value={cfg.payerName || ''}
                onChange={e => updatePayConfig(leader.id, 'payerName', e.target.value)}
                placeholder="Nom du payeur"
                style={{
                  background: '#0f172a', border: '1px solid #334155', borderRadius: 8,
                  padding: '8px 10px', color: '#e2e8f0', fontSize: 14, fontWeight: 700,
                  fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
                }}
              />

              {/* Passagers couverts + bouton retirer */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {members.map(m => {
                  const ft = flightTypes.find(t =>
                    t.id === (paxConfig[m.id]?.actualFlightType || m.flight_type))
                  const isPrimary = m.id === leader.id
                  return (
                    <div key={m.id} style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      background: 'rgba(56,189,248,0.08)',
                      border: '1px solid rgba(56,189,248,0.2)',
                      borderRadius: 20, padding: '3px 8px',
                      fontSize: 12, color: '#e2e8f0',
                    }}>
                      <span>{paxDisplayName(m, passengers.indexOf(m))}</span>
                      <span style={{ color: '#64748b' }}>· {ft?.label} {ft?.price_eur}€</span>
                      {!isPrimary && (
                        <button
                          onClick={() => removeFromGroup(m.id)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: '#64748b', fontSize: 13, padding: '0 0 0 2px',
                            lineHeight: 1,
                          }}
                          title="Retirer de ce groupe">
                          ✕
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Ajouter d'autres passagers dans ce groupe */}
              {otherLeaders.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Ajouter :</span>
                  {otherLeaders.map(other => (
                    <button key={other.id}
                      onClick={() => addToGroup(other.id, leader.id)}
                      style={{
                        padding: '3px 8px', borderRadius: 20, cursor: 'pointer',
                        fontSize: 12, fontFamily: 'inherit',
                        border: '1px dashed #475569',
                        background: 'transparent', color: '#94a3b8',
                      }}>
                      + {paxDisplayName(other, passengers.indexOf(other))}
                    </button>
                  ))}
                </div>
              )}

              {/* Mode de paiement */}
              <div style={{ display: 'flex', gap: 5 }}>
                {PAY_METHODS.map(pm => (
                  <button key={pm.id}
                    onClick={() => updatePayConfig(leader.id, 'method', pm.id)}
                    style={methodBtnStyle(cfg.method === pm.id)}>
                    {pm.icon}<br />{pm.label}
                  </button>
                ))}
              </div>

              {/* Facture */}
              <div style={{ display: 'flex', gap: 5 }}>
                <button
                  onClick={() => updatePayConfig(leader.id, 'invoice', false)}
                  style={invoiceBtnStyle(!cfg.invoice)}>
                  🚫 Sans facture
                </button>
                <button
                  onClick={() => updatePayConfig(leader.id, 'invoice', true)}
                  style={invoiceBtnStyle(cfg.invoice)}>
                  🧾 Avec facture
                </button>
              </div>

              {/* Sous-total */}
              <div style={{
                display: 'flex', justifyContent: 'flex-end',
                fontSize: 15, fontWeight: 800, color: '#38bdf8',
              }}>
                {subtotal} €
              </div>
            </div>
          )
        })}
      </div>

      {/* ── TOTAL GÉNÉRAL ────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '9px 12px',
        background: 'rgba(56,189,248,0.05)',
        border: '1px solid rgba(56,189,248,0.15)',
        borderRadius: 8,
      }}>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {passengers.length} vol{passengers.length > 1 ? 's' : ''} · {groupLeaders.length} règlement{groupLeaders.length > 1 ? 's' : ''}
        </span>
        <span style={{ fontSize: 16, fontWeight: 800, color: '#38bdf8' }}>
          {totalEur()} €
        </span>
      </div>

      {/* ── ACTIONS ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          disabled={saving || !isValid}
          onClick={handleSave}
          style={{
            flex: 2, padding: '12px', borderRadius: 10, border: 'none',
            cursor: saving || !isValid ? 'not-allowed' : 'pointer',
            background: saving || !isValid
              ? '#1e293b'
              : 'linear-gradient(135deg,#1d4ed8,#2563eb)',
            color:  saving || !isValid ? '#475569' : 'white',
            fontWeight: 800, fontSize: 14, fontFamily: 'inherit',
          }}>
          {saving ? '⏳ Enregistrement…' : '✓ Clôturer le vol'}
        </button>
        <button onClick={onCancel}
          style={{
            flex: 1, padding: '12px', borderRadius: 10,
            border: '1px solid #334155', background: '#1e293b',
            color: '#94a3b8', fontWeight: 600, fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
          Annuler
        </button>
      </div>
    </div>
  )
}
