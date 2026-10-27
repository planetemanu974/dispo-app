/**
 * FlightClosure.jsx — Per-passenger post-flight closure panel.
 *
 * Replaces the old single-pilot / single-method closure section.
 * Designed for speed on mobile: big tap targets, minimal scroll,
 * every change is one tap.
 *
 * Flow:
 *  1. Passengers — adjust actual pilot + flight type if different from booking
 *  2. Paiement   — "Ensemble" (one method for all) or "Séparé" (one per pax)
 *  3. Factures   — per group: aucune / commune / individuelle
 *  4. Clôturer   — saves closure_data JSONB + old compat fields, generates PDFs
 *
 * Props:
 *  booking             — full booking object with passengers[] already loaded
 *  pilot               — { id, name } logged-in pilot
 *  colleagues          — [{id, name, is_direct, is_fixed, fixed_order}]
 *  flightTypes         — [{id, label, price_eur}]
 *  bookingAssignments  — [{colleague_id, status, colleagues:{name}}]
 *  onDone(patch)       — called with updated booking fields after save
 *  onCancel()          — called when user clicks "Annuler"
 */

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildInvoiceNumber, generateInvoice, invoiceFilename } from '../lib/invoice'

// ── Payment methods — no card (Capitaine ne prend pas la CB) ─────────────────
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

// ── Main component ────────────────────────────────────────────────────────────

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

  // ── Compute default pilot per passenger (same logic as passenger cards) ────
  function defaultPilotFor(index) {
    const sortedFixed = (colleagues || [])
      .filter(c => c.is_direct && c.is_fixed)
      .sort((a, b) => (a.fixed_order ?? 99) - (b.fixed_order ?? 99))
    const sortedFixedIds = new Set(sortedFixed.map(c => c.id))
    const acceptedFreelancers = (bookingAssignments || [])
      .filter(a => a.status === 'accepted' && !sortedFixedIds.has(a.colleague_id))
      .map(a => a.colleagues?.name)
      .filter(Boolean)
    if (index === 0) return sortedFixed[0]?.name || pilot.name
    return sortedFixed[index]?.name || acceptedFreelancers[index - sortedFixed.length] || pilot.name
  }

  // ── Per-passenger configuration ───────────────────────────────────────────
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

  // ── Payment mode ──────────────────────────────────────────────────────────
  const [payMode, setPayMode] = useState('together') // 'together' | 'separate'

  // Together — one method + invoice choice for the group
  const [groupMethod,  setGroupMethod]  = useState('')
  const [groupInvoice, setGroupInvoice] = useState('none') // 'none'|'single'|'each'

  // Separate — one method + invoice per passenger
  const [sepConfig, setSepConfig] = useState(() => {
    const cfg = {}
    passengers.forEach(p => { cfg[p.id] = { method: '', invoice: false } })
    return cfg
  })

  function updateSep(id, key, val) {
    setSepConfig(prev => ({ ...prev, [id]: { ...prev[id], [key]: val } }))
  }

  const [saving, setSaving] = useState(false)

  // ── Validation ────────────────────────────────────────────────────────────
  const isValid = payMode === 'together'
    ? !!groupMethod
    : passengers.every(p => !!sepConfig[p.id]?.method)

  // ── Prices ────────────────────────────────────────────────────────────────
  function priceOf(flightTypeId) {
    return Number(flightTypes.find(t => t.id === flightTypeId)?.price_eur) || 0
  }

  function totalEur() {
    return passengers.reduce((sum, p) => {
      const ft = paxConfig[p.id]?.actualFlightType || p.flight_type
      return sum + priceOf(ft)
    }, 0)
  }

  function ftLabel(id) {
    return flightTypes.find(t => t.id === id)?.label || id
  }

  // All pilots available for the selector (Capitaine + colleagues)
  const allPilotOptions = [
    { name: pilot.name, label: `✈️ ${pilot.name} (moi)` },
    ...(colleagues || []).map(c => ({ name: c.name, label: c.name })),
  ]

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!isValid) return
    setSaving(true)
    try {
      // 1. Build closure_data.passengers
      const closurePassengers = passengers.map(p => ({
        id:                 p.id,
        name:               paxDisplayName(p, passengers.indexOf(p)),
        actual_pilot:       paxConfig[p.id]?.actualPilot || pilot.name,
        actual_flight_type: paxConfig[p.id]?.actualFlightType || p.flight_type,
      }))

      // 2. Build payment groups
      let paymentGroups
      if (payMode === 'together') {
        paymentGroups = [{
          passenger_ids: passengers.map(p => p.id),
          method:        groupMethod,
          invoice:       groupInvoice,
          payer_name:    booking.contact_name || '',
        }]
      } else {
        paymentGroups = passengers.map(p => ({
          passenger_ids: [p.id],
          method:        sepConfig[p.id].method,
          invoice:       sepConfig[p.id].invoice ? 'single' : 'none',
          payer_name:    paxDisplayName(p, passengers.indexOf(p)),
        }))
      }

      // 3. Assign invoice numbers to groups that need them
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
        } else if (g.invoice === 'each') {
          g.invoice_numbers = g.passenger_ids.map(pid => ({
            passenger_id: pid,
            number:       buildInvoiceNumber(flightDate, nextSeq++),
          }))
        }
      }

      // 4. Persist to DB
      const primaryPilot  = closurePassengers[0]?.actual_pilot || pilot.name
      const primaryMethod = paymentGroups[0]?.method || ''
      const firstInvNum   = paymentGroups.find(g => g.invoice_number)?.invoice_number
        || paymentGroups.find(g => g.invoice_numbers)?.invoice_numbers?.[0]?.number
        || null

      const { error: dbErr } = await supabase.from('bookings').update({
        flew_pilot_name: primaryPilot,
        payment_method:  primaryMethod,
        invoice_type:    'custom',
        invoice_number:  firstInvNum,
        paid_at:         new Date().toISOString(),
        closure_data: { passengers: closurePassengers, payment_groups: paymentGroups },
      }).eq('id', booking.id)

      if (dbErr) throw dbErr

      // 5. Generate PDF invoices
      for (const g of paymentGroups) {
        if (g.invoice === 'single' && g.invoice_number) {
          const paxInGroup = passengers.filter(p => g.passenger_ids.includes(p.id))
          const lines = paxInGroup.map(p => {
            const ft = flightTypes.find(t => t.id === (paxConfig[p.id]?.actualFlightType || p.flight_type))
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

        } else if (g.invoice === 'each' && g.invoice_numbers) {
          for (const { passenger_id, number } of g.invoice_numbers) {
            const p  = passengers.find(px => px.id === passenger_id)
            if (!p) continue
            const ft = flightTypes.find(t => t.id === (paxConfig[p.id]?.actualFlightType || p.flight_type))
            const doc = generateInvoice({
              invoiceNumber: number,
              date:          flightDate,
              clientName:    paxDisplayName(p, passengers.indexOf(p)),
              lines: [{
                label:    ft ? `${ft.label} biplace` : 'Prestation biplace',
                priceEur: ft?.price_eur || 0,
              }],
            })
            doc.save(invoiceFilename(number))
          }
        }
      }

      // 6. Log activity
      await supabase.from('activity_log').insert({
        pilot_id:    pilot.id,
        action:      'booking_closed',
        entity_type: 'booking',
        entity_id:   booking.id,
        details: {
          booking_ref:    booking.booking_ref,
          contact_name:   booking.contact_name,
          pax_count:      passengers.length,
          payment_method: primaryMethod,
          invoice:        firstInvNum || 'none',
          pilot:          primaryPilot,
        },
      }).catch(() => {}) // non-fatal

      // 7. Notify parent
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
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const selStyle = (active, accentColor = '#38bdf8') => ({
    flex: 1,
    padding: '9px 4px',
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: 13,
    fontFamily: 'inherit',
    border: active ? `2px solid ${accentColor}` : '1px solid #334155',
    background: active ? `rgba(${hexToRgb(accentColor)},0.12)` : '#1e293b',
    color: active ? accentColor : '#94a3b8',
    transition: 'all .1s',
  })

  const payBtnStyle = (active) => ({
    flex: 1,
    padding: '10px 4px',
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: 12,
    fontFamily: 'inherit',
    border: active ? '2px solid #38bdf8' : '1px solid #334155',
    background: active ? 'rgba(56,189,248,0.12)' : '#1e293b',
    color: active ? '#38bdf8' : '#94a3b8',
  })

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
        🛬 Clôture du vol
      </div>

      {/* ── PASSAGERS ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.4px' }}>
          Passagers & pilotes
        </div>

        {passengers.map((p, i) => {
          const cfg       = paxConfig[p.id] || {}
          const actualFt  = cfg.actualFlightType || p.flight_type
          const changed   = actualFt !== p.flight_type
          const catLbl    = catLabel(p)

          return (
            <div key={p.id} style={{
              background: '#1e293b',
              borderRadius: 10,
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}>
              {/* Pax name + category */}
              <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: '#e2e8f0' }}>{paxDisplayName(p, i)}</span>
                {catLbl && <span style={{ fontSize: 11, color: '#64748b' }}>{catLbl}</span>}
                {changed && (
                  <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>
                    · type modifié ↗
                  </span>
                )}
              </div>

              {/* Selectors: pilot + flight type */}
              <div style={{ display: 'flex', gap: 6 }}>
                {/* Pilot */}
                <select
                  value={cfg.actualPilot || pilot.name}
                  onChange={e => updatePax(p.id, 'actualPilot', e.target.value)}
                  style={{
                    flex: 1,
                    background: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: 8,
                    padding: '8px 8px',
                    color: '#e2e8f0',
                    fontSize: 13,
                    fontFamily: 'inherit',
                  }}>
                  {allPilotOptions.map(pl => (
                    <option key={pl.name} value={pl.name}>{pl.label}</option>
                  ))}
                </select>

                {/* Flight type */}
                <select
                  value={actualFt}
                  onChange={e => updatePax(p.id, 'actualFlightType', e.target.value)}
                  style={{
                    flex: 1,
                    background: changed ? 'rgba(245,158,11,0.08)' : '#0f172a',
                    border: changed ? '1.5px solid #f59e0b' : '1px solid #334155',
                    borderRadius: 8,
                    padding: '8px 8px',
                    color: changed ? '#fcd34d' : '#e2e8f0',
                    fontSize: 13,
                    fontFamily: 'inherit',
                  }}>
                  {flightTypes.map(ft => (
                    <option key={ft.id} value={ft.id}>
                      ✈️ {ft.label} — {ft.price_eur}€
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── PAIEMENT ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.4px' }}>
          Règlement
        </div>

        {/* Mode toggle — only show if multiple passengers */}
        {passengers.length > 1 && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPayMode('together')} style={selStyle(payMode === 'together')}>
              👥 Ensemble
            </button>
            <button onClick={() => setPayMode('separate')} style={selStyle(payMode === 'separate')}>
              👤 Séparé
            </button>
          </div>
        )}

        {/* Together */}
        {payMode === 'together' && (
          <>
            {/* Payment methods */}
            <div style={{ display: 'flex', gap: 6 }}>
              {PAY_METHODS.map(pm => (
                <button key={pm.id} onClick={() => setGroupMethod(pm.id)} style={payBtnStyle(groupMethod === pm.id)}>
                  {pm.icon}<br />{pm.label}
                </button>
              ))}
            </div>

            {/* Invoice */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                {
                  id: 'none',
                  icon: '🚫',
                  label: 'Pas de facture',
                  sub: null,
                },
                {
                  id: 'single',
                  icon: '🧾',
                  label: 'Facture commune',
                  sub: `1 PDF · ${booking.contact_name || 'contact'}`,
                },
                {
                  id: 'each',
                  icon: '📄',
                  label: 'Facture individuelle',
                  sub: `${passengers.length} PDF · 1 par passager`,
                },
              ].map(inv => (
                <button key={inv.id} onClick={() => setGroupInvoice(inv.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    border: groupInvoice === inv.id ? '2px solid #38bdf8' : '1px solid #334155',
                    background: groupInvoice === inv.id ? 'rgba(56,189,248,0.08)' : '#1e293b',
                  }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{inv.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: groupInvoice === inv.id ? '#38bdf8' : '#e2e8f0' }}>
                      {inv.label}
                    </div>
                    {inv.sub && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>{inv.sub}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Separate — one card per passenger */}
        {payMode === 'separate' && passengers.map((p, i) => {
          const cfg = sepConfig[p.id] || {}
          return (
            <div key={p.id} style={{
              background: '#1e293b',
              borderRadius: 10,
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>
                {paxDisplayName(p, i)}
              </div>

              {/* Payment method */}
              <div style={{ display: 'flex', gap: 5 }}>
                {PAY_METHODS.map(pm => (
                  <button key={pm.id} onClick={() => updateSep(p.id, 'method', pm.id)}
                    style={{
                      flex: 1,
                      padding: '8px 4px',
                      borderRadius: 7,
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: 'inherit',
                      border: cfg.method === pm.id ? '2px solid #22c55e' : '1px solid #334155',
                      background: cfg.method === pm.id ? 'rgba(34,197,94,0.12)' : '#0f172a',
                      color: cfg.method === pm.id ? '#86efac' : '#94a3b8',
                    }}>
                    {pm.icon}<br />{pm.label}
                  </button>
                ))}
              </div>

              {/* Invoice toggle */}
              <div style={{ display: 'flex', gap: 5 }}>
                {[
                  { val: false, label: 'Sans facture' },
                  { val: true,  label: 'Avec facture' },
                ].map(opt => (
                  <button key={String(opt.val)} onClick={() => updateSep(p.id, 'invoice', opt.val)}
                    style={{
                      flex: 1,
                      padding: '7px 4px',
                      borderRadius: 7,
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: 'inherit',
                      border: cfg.invoice === opt.val ? '2px solid #a78bfa' : '1px solid #334155',
                      background: cfg.invoice === opt.val ? 'rgba(167,139,250,0.12)' : '#0f172a',
                      color: cfg.invoice === opt.val ? '#c4b5fd' : '#94a3b8',
                    }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── TOTAL ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '9px 12px',
        background: 'rgba(56,189,248,0.05)',
        borderRadius: 8,
        border: '1px solid rgba(56,189,248,0.15)',
      }}>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {passengers.length} vol{passengers.length > 1 ? 's' : ''}
        </span>
        <span style={{ fontSize: 16, fontWeight: 800, color: '#38bdf8' }}>
          {totalEur()} €
        </span>
      </div>

      {/* ── ACTIONS ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          disabled={saving || !isValid}
          onClick={handleSave}
          style={{
            flex: 2,
            padding: '12px',
            borderRadius: 10,
            border: 'none',
            cursor: saving || !isValid ? 'not-allowed' : 'pointer',
            background: saving || !isValid
              ? '#1e293b'
              : 'linear-gradient(135deg,#1d4ed8,#2563eb)',
            color: saving || !isValid ? '#475569' : 'white',
            fontWeight: 800,
            fontSize: 14,
            fontFamily: 'inherit',
          }}>
          {saving ? '⏳ Enregistrement…' : '✓ Clôturer le vol'}
        </button>
        <button onClick={onCancel}
          style={{
            flex: 1,
            padding: '12px',
            borderRadius: 10,
            border: '1px solid #334155',
            background: '#1e293b',
            color: '#94a3b8',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}>
          Annuler
        </button>
      </div>
    </div>
  )
}

// ── Minimal hex→rgb for rgba() in inline styles ────────────────────────────
function hexToRgb(hex) {
  const m = hex.replace('#', '').match(/.{2}/g)
  if (!m) return '56,189,248'
  return m.map(x => parseInt(x, 16)).join(',')
}
