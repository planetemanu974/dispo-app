/**
 * Comptabilite.jsx — Archive des paiements du moniteur.
 *
 * Affiche TOUS les règlements encaissés (avec ou sans facture).
 * Une ligne par groupe de paiement dans closure_data.payment_groups.
 * Le montant est calculé depuis flight_lines (vol + packs).
 *
 * Accessible depuis le menu principal.
 * Les données ne sont JAMAIS exposées publiquement — requête filtrée sur pilot_id.
 */

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { generateInvoice, invoiceFilename } from '../lib/invoice'

// ── Helpers ────────────────────────────────────────────────────────────────

/** YYYY-MM-DD → "jeu. 29 nov. 2026" */
function formatDate(dateStr) {
  if (!dateStr) return '—'
  // 'T00:00:00' force l'interprétation en heure locale (Réunion UTC+4)
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('fr-FR', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  })
}

/** YYYY-MM-DD → "DD/MM/YYYY" (pour les PDFs et titres) */
function formatDateShort(dateStr) {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

const METHOD_LABEL = { cash: 'Espèces', check: 'Chèque', wero: 'Wero', card: 'Carte' }
const METHOD_ICON  = { cash: '💶', check: '✅', wero: '📲', card: '💳' }

/** Calcule le total d'un groupe depuis ses flight_lines */
function groupTotal(flightLines = []) {
  return flightLines.reduce((sum, l) => sum + (l.price_eur || 0) * (l.count || 1), 0)
}

/** Date locale YYYY-MM-DD (sans décalage UTC) */
function localDateStr(d = new Date()) {
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// ── Composant ────────────────────────────────────────────────────────────────

export default function Comptabilite({ pilot, flightTypes }) {
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [filter, setFilter]     = useState('month') // 'all' | 'today' | 'month' | 'year'
  const [downloading, setDownloading] = useState(null)

  // ── Chargement ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!pilot?.id) return
    setLoading(true)
    setError(null)
    try {
      // On charge tous les vols clôturés (paid_at ou closure_data présents)
      const { data, error: dbErr } = await supabase
        .from('bookings')
        .select(`
          id, booking_ref, contact_name,
          paid_at,
          payment_method, invoice_number, invoice_type,
          closure_data,
          passengers,
          pilot_slots ( slot_date, slot_time )
        `)
        .eq('pilot_id', pilot.id)
        .or('paid_at.not.is.null,closure_data.not.is.null')
        .order('paid_at', { ascending: false, nullsFirst: false })
        .limit(300)

      if (dbErr) throw dbErr

      const result = []
      for (const b of data || []) {
        const bookingDate = b.pilot_slots?.slot_date
          || b.paid_at?.slice(0, 10)
          || localDateStr()

        if (b.closure_data?.payment_groups?.length) {
          // Nouveau format — un groupe = un règlement
          for (const g of b.closure_data.payment_groups) {
            const total = groupTotal(g.flight_lines)
            // Inclure même si total = 0 (cas test / gratuit)
            if (!g.method) continue // group sans méthode = non finalisé

            result.push({
              key:            `${b.id}__${g.id}`,
              booking_id:     b.id,
              booking_ref:    b.booking_ref,
              contact_name:   b.contact_name,
              date:           bookingDate,
              paid_at:        b.paid_at,
              payer_name:     g.payer_name || b.contact_name || '—',
              method:         g.method,
              flight_lines:   g.flight_lines || [],
              total_eur:      total,
              invoice_number: g.invoice_number || null,
              closure_data:   b.closure_data,
              source:         'new',
            })
          }
        } else if (b.invoice_number || b.payment_method) {
          // Ancien format — une seule entrée par réservation
          result.push({
            key:            b.id,
            booking_id:     b.id,
            booking_ref:    b.booking_ref,
            contact_name:   b.contact_name,
            date:           bookingDate,
            paid_at:        b.paid_at,
            payer_name:     b.contact_name || '—',
            method:         b.payment_method,
            flight_lines:   [],
            total_eur:      0,
            invoice_number: b.invoice_number || null,
            closure_data:   null,
            source:         'legacy',
          })
        }
      }
      setRows(result)
    } catch (e) {
      console.error('[Comptabilite] load error:', e)
      setError('Impossible de charger les paiements : ' + (e.message || e))
    } finally {
      setLoading(false)
    }
  }, [pilot?.id])

  useEffect(() => { load() }, [load])

  // ── Re-génération PDF ────────────────────────────────────────────────────
  async function handleDownload(row) {
    if (!row.invoice_number) return
    setDownloading(row.key)
    try {
      const PACK_IDS = new Set(['pack_photo', 'pack_photo_video'])
      let lines = []

      if (row.flight_lines?.length) {
        for (const line of row.flight_lines) {
          for (let i = 0; i < (line.count || 1); i++) {
            const isPack = PACK_IDS.has(line.flight_type_id)
            lines.push({
              label:    isPack ? line.label : `${line.label} biplace`,
              priceEur: line.price_eur || 0,
            })
          }
        }
      } else {
        lines = [{ label: 'Prestation biplace parapente', priceEur: 0 }]
      }

      const doc = generateInvoice({
        invoiceNumber: row.invoice_number,
        date:          row.date,
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

  // ── Filtrage ─────────────────────────────────────────────────────────────
  const today = localDateStr()
  const [curYear, curMonth] = [
    new Date().getFullYear(),
    new Date().getMonth(),
  ]

  function filteredRows() {
    if (filter === 'all') return rows
    return rows.filter(r => {
      const rowDate = (r.paid_at || r.date || today).slice(0, 10)
      const d = new Date(rowDate + 'T00:00:00')
      if (filter === 'today') return rowDate === today
      if (filter === 'year')  return d.getFullYear() === curYear
      if (filter === 'month') return d.getFullYear() === curYear && d.getMonth() === curMonth
      return true
    })
  }

  const filtered   = filteredRows()
  const totalPeriod = filtered.reduce((s, r) => s + (r.total_eur || 0), 0)
  const hasAmounts  = filtered.some(r => r.total_eur > 0)

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
  return (
    <div style={{
      background: '#0f172a',
      minHeight: '100vh',
      padding: '0 0 40px',
      color: '#e2e8f0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div style={{
        padding: '16px 16px 12px',
        background: '#1e293b',
        borderBottom: '1px solid #334155',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#e2e8f0' }}>
          🧾 Comptabilité
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
          {rows.length} règlement{rows.length !== 1 ? 's' : ''} enregistré{rows.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* ── Filtres ──────────────────────────────────────────────────────── */}
      <div style={{ padding: '12px 16px 8px', display: 'flex', gap: 6 }}>
        {[
          { id: 'today', label: "Aujourd'hui" },
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
            color: '#64748b', fontSize: 14, cursor: 'pointer',
          }}
          title="Actualiser">↻</button>
      </div>

      {/* ── Bandeau synthèse ─────────────────────────────────────────────── */}
      {filtered.length > 0 && (
        <div style={{
          margin: '0 16px 12px',
          padding: '10px 14px',
          background: 'rgba(56,189,248,0.05)',
          border: '1px solid rgba(56,189,248,0.12)',
          borderRadius: 8,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {filtered.length} règlement{filtered.length !== 1 ? 's' : ''}
            {filter === 'today' ? " aujourd'hui" : filter === 'month' ? ' ce mois' : filter === 'year' ? ' cette année' : ''}
          </span>
          {hasAmounts && (
            <span style={{ fontSize: 16, fontWeight: 800, color: '#38bdf8' }}>
              {totalPeriod} €
            </span>
          )}
        </div>
      )}

      {/* ── Contenu ──────────────────────────────────────────────────────── */}
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {loading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b', fontSize: 13 }}>
            ⏳ Chargement…
          </div>
        )}

        {error && (
          <div style={{
            padding: '12px', borderRadius: 8,
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#fca5a5', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b', fontSize: 13 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🧾</div>
            <div>Aucun paiement enregistré pour cette période.</div>
            <div style={{ fontSize: 11, marginTop: 6, color: '#475569' }}>
              Les règlements apparaissent ici après la clôture d'un vol.
            </div>
          </div>
        )}

        {!loading && filtered.map(row => (
          <div key={row.key} style={cardStyle}>

            {/* Ligne 1 : date + ref + bouton PDF */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
                  {formatDate(row.date)}
                </div>
                {row.booking_ref && (
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                    Réf. {row.booking_ref}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Montant */}
                {row.total_eur > 0 && (
                  <span style={{ fontSize: 15, fontWeight: 800, color: '#38bdf8' }}>
                    {row.total_eur} €
                  </span>
                )}
                {/* PDF — seulement si facture */}
                {row.invoice_number && (
                  <button
                    onClick={() => handleDownload(row)}
                    disabled={downloading === row.key}
                    style={{
                      padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
                      border: '1px solid #334155', background: '#0f172a',
                      color: downloading === row.key ? '#475569' : '#38bdf8',
                      fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                      whiteSpace: 'nowrap',
                    }}>
                    {downloading === row.key ? '⏳' : '⬇ PDF'}
                  </button>
                )}
              </div>
            </div>

            {/* Ligne 2 : payeur + méthode (+ numéro facture si dispo) */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{
                padding: '2px 8px', borderRadius: 20,
                background: 'rgba(56,189,248,0.06)',
                border: '1px solid rgba(56,189,248,0.15)',
                fontSize: 12, color: '#94a3b8',
              }}>
                👤 {row.payer_name}
              </span>

              {row.method && (
                <span style={{
                  padding: '2px 8px', borderRadius: 20,
                  background: '#1e293b',
                  border: '1px solid #334155',
                  fontSize: 12, color: '#64748b',
                }}>
                  {METHOD_ICON[row.method] || ''} {METHOD_LABEL[row.method] || row.method}
                </span>
              )}

              {row.invoice_number && (
                <span style={{
                  padding: '2px 8px', borderRadius: 20,
                  background: 'rgba(34,197,94,0.06)',
                  border: '1px solid rgba(34,197,94,0.15)',
                  fontSize: 11, color: '#86efac',
                }}>
                  🧾 {row.invoice_number}
                </span>
              )}
            </div>

            {/* Ligne 3 : détail des vols (optionnel, si flight_lines) */}
            {row.flight_lines?.length > 0 && (
              <div style={{
                borderTop: '1px solid #1e293b',
                paddingTop: 6,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}>
                {row.flight_lines.map((l, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: 11, color: '#64748b',
                  }}>
                    <span>{l.count > 1 ? `${l.count}×` : ''} {l.label}</span>
                    <span>{l.count * (l.price_eur || 0)} €</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
