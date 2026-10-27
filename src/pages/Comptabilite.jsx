/**
 * Comptabilite.jsx — Archive des factures du moniteur.
 *
 * Liste toutes les réservations clôturées ayant généré au moins une facture,
 * et permet de re-télécharger les PDFs à partir des données stockées
 * dans closure_data (JSONB) ou dans les anciens champs invoice_number.
 *
 * Accessible depuis le menu principal (aux côtés de Planning, Collègues, Messages).
 * Les données ne sont JAMAIS exposées publiquement — requête filtrée sur pilot_id.
 */

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { generateInvoice, invoiceFilename } from '../lib/invoice'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function methodLabel(method) {
  const map = { cash: 'Espèces', check: 'Chèque', wero: 'Wero', card: 'Carte' }
  return map[method] || method || '—'
}

// ─── Composant ────────────────────────────────────────────────────────────────

export default function Comptabilite({ pilot, flightTypes }) {
  const [invoices, setInvoices]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [filter, setFilter]       = useState('all') // 'all' | 'month' | 'year'
  const [downloading, setDownloading] = useState(null) // invoice_number being regenerated

  // ── Chargement des réservations avec factures ──────────────────────────────
  const load = useCallback(async () => {
    if (!pilot?.id) return
    setLoading(true)
    setError(null)
    try {
      // On charge toutes les réservations du pilote qui ont au moins une facture.
      // Soit via closure_data (nouveau format), soit via invoice_number (ancien format).
      const { data, error: dbErr } = await supabase
        .from('bookings')
        .select(`
          id, booking_ref, contact_name, contact_phone,
          flight_date, paid_at,
          payment_method, invoice_number, invoice_type,
          closure_data,
          passengers,
          pilot_slots ( slot_date )
        `)
        .eq('pilot_id', pilot.id)
        .or('invoice_number.not.is.null,closure_data.not.is.null')
        .order('paid_at', { ascending: false })
        .limit(200)

      if (dbErr) throw dbErr

      // Aplatir en lignes de factures (une par invoice_number dans closure_data)
      const rows = []
      for (const b of data || []) {
        const bookingDate = b.pilot_slots?.slot_date || b.flight_date || b.paid_at?.slice(0, 10)

        if (b.closure_data?.payment_groups?.length) {
          // Nouveau format : un ou plusieurs groupes de paiement
          for (const g of b.closure_data.payment_groups) {
            if (g.invoice_number) {
              rows.push({
                key:            g.invoice_number,
                booking_id:     b.id,
                booking_ref:    b.booking_ref,
                contact_name:   b.contact_name,
                date:           bookingDate,
                paid_at:        b.paid_at,
                payer_name:     g.payer_name || b.contact_name || '—',
                method:         g.method,
                invoice_number: g.invoice_number,
                passenger_ids:  g.passenger_ids || [],
                passengers:     b.passengers || [],
                closure_data:   b.closure_data,
                source:         'new',
              })
            }
          }
        } else if (b.invoice_number) {
          // Ancien format : une seule facture par réservation
          rows.push({
            key:            b.invoice_number,
            booking_id:     b.id,
            booking_ref:    b.booking_ref,
            contact_name:   b.contact_name,
            date:           bookingDate,
            paid_at:        b.paid_at,
            payer_name:     b.contact_name || '—',
            method:         b.payment_method,
            invoice_number: b.invoice_number,
            passenger_ids:  (b.passengers || []).map(p => p.id),
            passengers:     b.passengers || [],
            closure_data:   null,
            source:         'legacy',
          })
        }
      }
      setInvoices(rows)
    } catch (e) {
      console.error('[Comptabilite] load error:', e)
      setError('Impossible de charger les factures.')
    } finally {
      setLoading(false)
    }
  }, [pilot?.id])

  useEffect(() => { load() }, [load])

  // ── Re-génération / téléchargement d'un PDF ───────────────────────────────
  async function handleDownload(row) {
    setDownloading(row.invoice_number)
    try {
      // Reconstituons les lignes de la facture
      const lines = []

      if (row.source === 'new' && row.closure_data?.passengers) {
        const paxInGroup = row.closure_data.passengers.filter(p =>
          row.passenger_ids.includes(p.id))
        for (const p of paxInGroup) {
          const ft = (flightTypes || []).find(t => t.id === p.actual_flight_type)
          lines.push({
            label:    ft ? `${ft.label} biplace` : 'Prestation biplace',
            priceEur: ft?.price_eur || 0,
          })
        }
      } else {
        // Ancien format ou pas de closure_data : une ligne générique
        const paxCount = row.passengers?.length || 1
        for (let i = 0; i < paxCount; i++) {
          lines.push({ label: 'Prestation biplace parapente', priceEur: 0 })
        }
      }

      const doc = generateInvoice({
        invoiceNumber: row.invoice_number,
        date:          row.date || new Date().toISOString().slice(0, 10),
        clientName:    row.payer_name,
        lines,
      })
      doc.save(invoiceFilename(row.invoice_number))
    } catch (e) {
      console.error('[Comptabilite] download error:', e)
      alert('Erreur lors de la génération du PDF : ' + (e.message || e))
    } finally {
      setDownloading(null)
    }
  }

  // ── Filtrage par période ──────────────────────────────────────────────────
  function filteredInvoices() {
    if (filter === 'all') return invoices
    const now   = new Date()
    const year  = now.getFullYear()
    const month = now.getMonth()
    return invoices.filter(inv => {
      const d = new Date(inv.paid_at || inv.date)
      if (filter === 'year')  return d.getFullYear() === year
      if (filter === 'month') return d.getFullYear() === year && d.getMonth() === month
      return true
    })
  }

  // ── Total de la période ───────────────────────────────────────────────────
  function periodTotal(rows) {
    // On ne stocke pas le montant total dans invoice, mais on peut compter le nombre
    return rows.length
  }

  const filtered = filteredInvoices()

  // ── Styles ────────────────────────────────────────────────────────────────

  const cardStyle = {
    background: '#1e293b',
    borderRadius: 10,
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    border: '1px solid #334155',
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{
      background: '#0f172a',
      minHeight: '100vh',
      padding: '0 0 40px',
      color: '#e2e8f0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 16px 12px',
        background: '#1e293b',
        borderBottom: '1px solid #334155',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#e2e8f0' }}>
          🧾 Comptabilité
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
          {invoices.length} facture{invoices.length !== 1 ? 's' : ''} enregistrée{invoices.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Filtres */}
      <div style={{ padding: '12px 16px 8px', display: 'flex', gap: 6 }}>
        {[
          { id: 'month', label: 'Ce mois' },
          { id: 'year',  label: 'Cette année' },
          { id: 'all',   label: 'Tout' },
        ].map(f => (
          <button key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
              fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
              border:     filter === f.id ? '2px solid #38bdf8' : '1px solid #334155',
              background: filter === f.id ? 'rgba(56,189,248,0.08)' : '#1e293b',
              color:      filter === f.id ? '#38bdf8' : '#64748b',
            }}>
            {f.label}
          </button>
        ))}
        <button onClick={load}
          style={{
            marginLeft: 'auto', padding: '6px 10px', borderRadius: 20,
            border: '1px solid #334155', background: '#1e293b',
            color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
          }}
          title="Actualiser">
          ↻
        </button>
      </div>

      {/* Compteur période */}
      {filtered.length > 0 && (
        <div style={{
          margin: '0 16px 12px',
          padding: '8px 12px',
          background: 'rgba(56,189,248,0.05)',
          border: '1px solid rgba(56,189,248,0.12)',
          borderRadius: 8,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {filtered.length} facture{filtered.length !== 1 ? 's' : ''}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8' }}>
            {filter === 'month' ? 'Ce mois' : filter === 'year' ? 'Cette année' : 'Total'}
          </span>
        </div>
      )}

      {/* Contenu */}
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {loading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b', fontSize: 13 }}>
            ⏳ Chargement…
          </div>
        )}

        {error && (
          <div style={{
            padding: '12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '60px 20px',
            color: '#64748b', fontSize: 13,
          }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🧾</div>
            <div>Aucune facture pour cette période.</div>
            <div style={{ fontSize: 11, marginTop: 6, color: '#475569' }}>
              Les factures apparaissent ici après la clôture d'un vol
              avec l'option "Avec facture".
            </div>
          </div>
        )}

        {!loading && filtered.map(inv => (
          <div key={inv.key} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              {/* Infos facture */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0' }}>
                  {inv.invoice_number}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  {formatDate(inv.date)}
                  {inv.booking_ref && (
                    <span style={{ marginLeft: 6, color: '#475569' }}>· {inv.booking_ref}</span>
                  )}
                </div>
              </div>

              {/* Bouton télécharger */}
              <button
                onClick={() => handleDownload(inv)}
                disabled={downloading === inv.invoice_number}
                style={{
                  padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
                  border: '1px solid #334155', background: '#0f172a',
                  color: downloading === inv.invoice_number ? '#475569' : '#38bdf8',
                  fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}>
                {downloading === inv.invoice_number ? '⏳' : '⬇ PDF'}
              </button>
            </div>

            {/* Payeur + méthode */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{
                padding: '2px 8px', borderRadius: 20,
                background: 'rgba(56,189,248,0.06)',
                border: '1px solid rgba(56,189,248,0.15)',
                fontSize: 12, color: '#94a3b8',
              }}>
                👤 {inv.payer_name}
              </span>
              <span style={{
                padding: '2px 8px', borderRadius: 20,
                background: '#1e293b',
                border: '1px solid #334155',
                fontSize: 12, color: '#64748b',
              }}>
                {methodLabel(inv.method)}
              </span>
              {inv.passenger_ids.length > 1 && (
                <span style={{
                  padding: '2px 8px', borderRadius: 20,
                  background: '#1e293b',
                  border: '1px solid #334155',
                  fontSize: 12, color: '#64748b',
                }}>
                  {inv.passenger_ids.length} pax
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
