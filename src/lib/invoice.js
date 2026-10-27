/**
 * invoice.js — PDF invoice generator for Planète Parapente
 *
 * Matches the exact layout of the reference invoice (facture_261026_1_colim974_5.pdf):
 *   • Issuer: Planète Parapente / Emmanuel SAGET, 44A rue du Général de Gaulle,
 *             97426 LES TROIS BASSINS, Tél 0692 20 09 61, SIRET 490 613 452 00047
 *   • Number format: DDMMYY/N  (e.g. 261027/1)
 *   • Date format:   DD/MM/YYYY
 *   • Line items:    Désignation | Prix unitaire HT | Montant HT
 *   • Footer:        "TVA non applicable — art. 293 B du CGI"
 *                    "TOTAL TTC : X,XX €"
 *                    "Merci pour votre confiance."
 *
 * Usage:
 *   import { buildInvoiceNumber, generateInvoice } from '../lib/invoice'
 *
 *   // Single invoice for a group (payer = contact)
 *   const doc = generateInvoice({
 *     invoiceNumber: '261027/1',
 *     date: '2026-10-27',         // YYYY-MM-DD
 *     clientName: 'Dupont Jean',
 *     lines: [
 *       { label: 'Vol découverte biplace', priceEur: 90 },
 *       { label: 'Vol découverte biplace', priceEur: 90 },
 *     ],
 *   })
 *   doc.save('facture_261027_1.pdf')
 */

import jsPDF from 'jspdf'

// ── Issuer constants ──────────────────────────────────────────────────────────
const ISSUER_NAME    = 'Planète Parapente'
const ISSUER_LINE2   = '44A rue du Général de Gaulle'
const ISSUER_LINE3   = '97426 LES TROIS BASSINS'
const ISSUER_TEL     = 'Tél : 0692 20 09 61'
const ISSUER_SIRET   = 'SIRET : 490 613 452 00047'

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Format a YYYY-MM-DD string as DD/MM/YYYY */
function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

/**
 * Build an invoice number in DDMMYY/N format.
 * @param {string} dateStr   YYYY-MM-DD
 * @param {number} seq       sequence number for the day (1-based)
 * @returns {string}  e.g. '261027/1'
 */
export function buildInvoiceNumber(dateStr, seq) {
  const [y, m, d] = dateStr.split('-')
  const yy = y.slice(-2)
  return `${d}${m}${yy}/${seq}`
}

// ── Price formatter ───────────────────────────────────────────────────────────

/** Format euros: "90,00 €" */
function fmtPrice(eur) {
  return Number(eur).toFixed(2).replace('.', ',') + ' €'
}

// ── Core generator ────────────────────────────────────────────────────────────

/**
 * Generate a single jsPDF invoice document.
 *
 * @param {object} opts
 * @param {string}   opts.invoiceNumber  e.g. '261027/1'
 * @param {string}   opts.date           YYYY-MM-DD flight date
 * @param {string}   opts.clientName     payer full name
 * @param {Array<{label: string, priceEur: number}>} opts.lines  line items
 * @returns {jsPDF}  doc — call .save() or .output() on it
 */
export function generateInvoice({ invoiceNumber, date, clientName, lines = [] }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

  const W = 210  // page width mm
  const MARGIN = 20
  const CONTENT_W = W - MARGIN * 2
  let y = MARGIN

  // ── Fonts ─────────────────────────────────────────────────────────────────
  doc.setFont('helvetica')

  // ── Header separator colour ───────────────────────────────────────────────
  const BLUE   = [30, 80, 180]   // section title accent
  const DARK   = [30, 30, 30]
  const GREY   = [120, 120, 120]
  const LGREY  = [220, 220, 220]

  // ─────────────────────────────────────────────────────────────────────────
  // ISSUER BLOCK (top-left)
  // ─────────────────────────────────────────────────────────────────────────
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...DARK)
  doc.text(ISSUER_NAME, MARGIN, y)

  y += 6
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GREY)
  doc.text(ISSUER_LINE2, MARGIN, y);  y += 5
  doc.text(ISSUER_LINE3, MARGIN, y);  y += 5
  doc.text(ISSUER_TEL,   MARGIN, y);  y += 5
  doc.text(ISSUER_SIRET, MARGIN, y)

  // ─────────────────────────────────────────────────────────────────────────
  // INVOICE TITLE + META (top-right)
  // ─────────────────────────────────────────────────────────────────────────
  const RX = W - MARGIN  // right edge

  // Reset y to same top for the right column
  let ry = MARGIN

  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...BLUE)
  doc.text('FACTURE', RX, ry, { align: 'right' })

  ry += 8
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GREY)
  doc.text(`N° ${invoiceNumber}`, RX, ry, { align: 'right' })

  ry += 5
  doc.text(`Date : ${fmtDate(date)}`, RX, ry, { align: 'right' })

  // ─────────────────────────────────────────────────────────────────────────
  // Horizontal rule
  // ─────────────────────────────────────────────────────────────────────────
  y = Math.max(y, ry) + 8
  doc.setDrawColor(...LGREY)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, y, W - MARGIN, y)
  y += 8

  // ─────────────────────────────────────────────────────────────────────────
  // CLIENT BLOCK
  // ─────────────────────────────────────────────────────────────────────────
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GREY)
  doc.text('FACTURÉ À', MARGIN, y)
  y += 5

  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...DARK)
  doc.text(clientName || '—', MARGIN, y)
  y += 10

  // ─────────────────────────────────────────────────────────────────────────
  // TABLE HEADER
  // ─────────────────────────────────────────────────────────────────────────
  const COL_LABEL_X  = MARGIN
  const COL_PRICE_X  = W - MARGIN - 30
  const COL_TOTAL_X  = W - MARGIN
  const ROW_H = 7

  // Header background
  doc.setFillColor(...BLUE)
  doc.rect(MARGIN, y - 4, CONTENT_W, ROW_H, 'F')

  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(255, 255, 255)
  doc.text('Désignation',        COL_LABEL_X + 2, y + 0.5)
  doc.text('Montant HT',         COL_TOTAL_X,     y + 0.5, { align: 'right' })

  y += ROW_H

  // ─────────────────────────────────────────────────────────────────────────
  // LINE ITEMS
  // ─────────────────────────────────────────────────────────────────────────
  let total = 0

  lines.forEach((line, idx) => {
    const bg = idx % 2 === 0 ? [248, 249, 250] : [255, 255, 255]
    doc.setFillColor(...bg)
    doc.rect(MARGIN, y - 4, CONTENT_W, ROW_H, 'F')

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...DARK)
    doc.text(line.label, COL_LABEL_X + 2, y + 0.5)

    const price = Number(line.priceEur) || 0
    total += price
    doc.text(fmtPrice(price), COL_TOTAL_X, y + 0.5, { align: 'right' })

    // light bottom border
    doc.setDrawColor(...LGREY)
    doc.setLineWidth(0.1)
    doc.line(MARGIN, y + 3, W - MARGIN, y + 3)

    y += ROW_H
  })

  // ─────────────────────────────────────────────────────────────────────────
  // TVA NOTE + TOTAL
  // ─────────────────────────────────────────────────────────────────────────
  y += 6

  doc.setFontSize(8)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(...GREY)
  doc.text('TVA non applicable — art. 293 B du CGI', MARGIN, y)

  y += 7

  // Total box
  const TOTAL_BOX_W = 60
  const TOTAL_BOX_X = W - MARGIN - TOTAL_BOX_W
  doc.setFillColor(...BLUE)
  doc.roundedRect(TOTAL_BOX_X, y - 5, TOTAL_BOX_W, 10, 2, 2, 'F')

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(255, 255, 255)
  doc.text('TOTAL TTC', TOTAL_BOX_X + 4, y + 1.5)
  doc.text(fmtPrice(total), W - MARGIN - 2, y + 1.5, { align: 'right' })

  // ─────────────────────────────────────────────────────────────────────────
  // FOOTER
  // ─────────────────────────────────────────────────────────────────────────
  const FOOTER_Y = 280
  doc.setDrawColor(...LGREY)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, FOOTER_Y - 4, W - MARGIN, FOOTER_Y - 4)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(...GREY)
  doc.text('Merci pour votre confiance.', W / 2, FOOTER_Y, { align: 'center' })

  return doc
}

// ── Convenience: generate and trigger browser download ────────────────────────

/**
 * Generate and immediately download a single-group invoice.
 *
 * @param {object} opts  same as generateInvoice
 * @param {string} filename  e.g. 'facture_261027_1.pdf'
 */
export function downloadInvoice(opts, filename) {
  const doc = generateInvoice(opts)
  doc.save(filename)
}

/**
 * Build filename from invoice number.
 * '261027/1' → 'facture_261027_1.pdf'
 */
export function invoiceFilename(invoiceNumber) {
  return 'facture_' + invoiceNumber.replace('/', '_') + '.pdf'
}
