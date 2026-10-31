/**
 * voucherPdf.js — gift voucher ("bon cadeau") PDF generator, A5 landscape.
 * Four designs drawn with vector shapes only (no image assets): child, adult, colleague, birthday.
 *
 *   const doc = generateVoucher({ design, code, flight_label, media_pack, to_name, from_name,
 *                                 message, desired_date, expires_at })
 *   doc.save(voucherFilename(v))
 */
import jsPDF from 'jspdf'
import QRCode from 'qrcode'

export const VOUCHER_DESIGNS = [
  { id: 'child',     label: 'Enfant',        emoji: '🧒', colors: ['#38bdf8', '#fde047'] },
  { id: 'adult',     label: 'Adulte',        emoji: '🏔️', colors: ['#0f172a', '#f97316'] },
  { id: 'colleague', label: 'Collègue',      emoji: '🤝', colors: ['#0f766e', '#e2e8f0'] },
  { id: 'birthday',  label: 'Anniversaire',  emoji: '🎂', colors: ['#7c3aed', '#f472b6'] },
]

const PACK_TEXT = { none: '', photo: 'avec pack photos', photo_video: 'avec pack photos + vidéo' }

const W = 210, H = 148

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const fill = (d, h) => d.setFillColor(...hex(h))
const stroke = (d, h) => d.setDrawColor(...hex(h))
const text = (d, h) => d.setTextColor(...hex(h))

// Small paraglider: canopy arc + lines + pilot dot
function glider(d, x, y, s, canopy, line) {
  fill(d, canopy)
  d.ellipse(x, y, 16 * s, 4.5 * s, 'F')
  stroke(d, line); d.setLineWidth(0.25 * s)
  d.line(x - 12 * s, y + 2 * s, x, y + 14 * s)
  d.line(x + 12 * s, y + 2 * s, x, y + 14 * s)
  d.line(x, y + 4 * s, x, y + 14 * s)
  fill(d, line); d.circle(x, y + 15.5 * s, 1.6 * s, 'F')
}

function cloud(d, x, y, s, col) {
  fill(d, col)
  d.circle(x, y, 4 * s, 'F'); d.circle(x + 5 * s, y - 2 * s, 5 * s, 'F')
  d.circle(x + 10 * s, y, 4 * s, 'F'); d.rect(x, y, 10 * s, 4 * s, 'F')
}

function paintBackground(d, design) {
  if (design === 'child') {
    fill(d, '#bae6fd'); d.rect(0, 0, W, H, 'F')
    fill(d, '#fde047'); d.circle(185, 22, 13, 'F')
    cloud(d, 20, 28, 1.2, '#ffffff'); cloud(d, 110, 18, 1, '#ffffff'); cloud(d, 150, 60, 0.9, '#ffffff')
    fill(d, '#86efac'); d.ellipse(40, H + 6, 90, 22, 'F')
    fill(d, '#4ade80'); d.ellipse(170, H + 10, 80, 24, 'F')
    glider(d, 160, 45, 1.4, '#f97316', '#334155')
    glider(d, 30, 70, 0.9, '#ec4899', '#334155')
  } else if (design === 'adult') {
    fill(d, '#0f172a'); d.rect(0, 0, W, H, 'F')
    fill(d, '#1e293b'); d.triangle(0, H, 60, 85, 125, H, 'F')
    fill(d, '#334155'); d.triangle(70, H, 150, 70, W, H, 'F')
    fill(d, '#f97316'); d.rect(0, 0, W, 3, 'F'); d.rect(0, H - 3, W, 3, 'F')
    fill(d, '#fb923c'); d.circle(172, 38, 10, 'F')
    glider(d, 150, 30, 1.3, '#f97316', '#e2e8f0')
  } else if (design === 'colleague') {
    fill(d, '#f1f5f9'); d.rect(0, 0, W, H, 'F')
    fill(d, '#0f766e'); d.rect(0, 0, 58, H, 'F')
    fill(d, '#14b8a6'); d.triangle(0, H, 58, H, 58, 90, 'F')
    stroke(d, '#99f6e4'); d.setLineWidth(0.6)
    d.circle(29, 40, 14); d.circle(29, 40, 22)
    glider(d, 29, 36, 0.9, '#ffffff', '#99f6e4')
  } else {
    fill(d, '#faf5ff'); d.rect(0, 0, W, H, 'F')
    fill(d, '#7c3aed'); d.rect(0, 0, W, 14, 'F'); d.rect(0, H - 14, W, 14, 'F')
    // confetti
    const cols = ['#f472b6', '#facc15', '#38bdf8', '#34d399', '#fb923c']
    for (let i = 0; i < 46; i++) {
      fill(d, cols[i % cols.length])
      const x = (i * 37.3) % W, y = 16 + ((i * 53.7) % (H - 32))
      if (i % 3 === 0) d.circle(x, y, 1.4, 'F'); else d.rect(x, y, 2.6, 1.2, 'F')
    }
    // balloons
    ;[['#f472b6', 22], ['#facc15', 34], ['#38bdf8', 46]].forEach(([c, x], i) => {
      fill(d, c); d.ellipse(x, 38 + i * 4, 6, 7.5, 'F')
      stroke(d, '#64748b'); d.setLineWidth(0.25); d.line(x, 45.5 + i * 4, 34, 70)
    })
    glider(d, 172, 40, 1.2, '#7c3aed', '#475569')
  }
}

const THEME = {
  child:     { title: '#0c4a6e', text: '#0f172a', accent: '#ea580c', panel: '#ffffff' },
  adult:     { title: '#f97316', text: '#e2e8f0', accent: '#f97316', panel: null },
  colleague: { title: '#0f766e', text: '#0f172a', accent: '#0f766e', panel: null },
  birthday:  { title: '#7c3aed', text: '#1e1b4b', accent: '#db2777', panel: null },
}

const fmtDate = (iso) => {
  if (!iso) return ''
  const dt = new Date(iso)
  return dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** URL encoded in the QR code: opened by the pilot, it shows the voucher status. */
export const voucherCheckUrl = (code) => `${window.location.origin}/bon-cadeau/verif?c=${encodeURIComponent(code)}`

export async function generateVoucher(v) {
  const design = v.design || 'adult'
  const th = THEME[design]
  const d = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a5' })
  paintBackground(d, design)

  // Text block: right of the colour band for "colleague", centred otherwise
  const x0 = design === 'colleague' ? 72 : 20
  const maxW = design === 'colleague' ? 125 : 170
  const cx = x0 + maxW / 2
  const align = { align: 'center' }

  // White panel behind the text on the busy illustrated designs
  if (design === 'child' || design === 'birthday') {
    fill(d, '#ffffff'); d.roundedRect(x0 - 4, 44, maxW + 8, 70, 4, 4, 'F')
  }

  d.setFont('helvetica', 'bold'); d.setFontSize(design === 'colleague' ? 26 : 30)
  text(d, th.title)
  d.text('BON CADEAU', cx, design === 'colleague' ? 28 : 30, align)

  const sub = design === 'birthday' ? 'Joyeux anniversaire !' : design === 'child' ? 'Un vol pour les petits aventuriers' : 'Vol en parapente biplace'
  d.setFont('helvetica', 'normal'); d.setFontSize(12); text(d, th.text)
  d.text(sub, cx, design === 'colleague' ? 36 : 38, align)

  // Flight line
  let y = 56
  d.setFont('helvetica', 'bold'); d.setFontSize(17); text(d, th.accent)
  d.text(`Vol ${v.flight_label}`, cx, y, align)
  const pack = PACK_TEXT[v.media_pack] || ''
  if (pack) { d.setFont('helvetica', 'normal'); d.setFontSize(10); text(d, th.text); d.text(pack, cx, y + 6, align); y += 6 }
  d.setFont('helvetica', 'normal'); d.setFontSize(10); text(d, th.text)
  d.text('Saint-Leu, La Réunion — décollage des Colimaçons, atterrissage plage de Saint-Leu', cx, y + 7, { align: 'center', maxWidth: maxW })

  // Dedication
  y += 17
  d.setFontSize(12)
  if (v.to_name) { d.setFont('helvetica', 'bold'); d.text(`Pour : ${v.to_name}`, cx, y, align); y += 6 }
  if (v.from_name) { d.setFont('helvetica', 'normal'); d.text(`De la part de : ${v.from_name}`, cx, y, align); y += 6 }
  if (v.message) {
    d.setFont('helvetica', 'italic'); d.setFontSize(10)
    const lines = d.splitTextToSize(`« ${v.message} »`, maxW - 10).slice(0, 3)
    d.text(lines, cx, y + 1, align)
  }

  // Footer: code + validity + booking hint
  d.setFont('helvetica', 'bold'); d.setFontSize(13); text(d, th.accent)
  d.text(`Code : ${v.code}`, cx, 117, align)
  d.setFont('helvetica', 'normal'); d.setFontSize(8.5); text(d, th.text)
  const valid = v.expires_at ? `Valable jusqu'au ${fmtDate(v.expires_at)}. ` : 'Valable 6 mois. '
  const desired = v.desired_date ? `Date de vol souhaitée : ${fmtDate(v.desired_date)}. ` : ''
  d.text(`${valid}${desired}`, cx, 123, { align: 'center', maxWidth: maxW })
  d.text('Réservez sur dispo-app-pi.vercel.app/reservation ou appelez-nous, en indiquant votre code. Présentez ce bon (QR code) le jour du vol.', cx, 128, { align: 'center', maxWidth: maxW })
  d.setFont('helvetica', 'bold'); text(d, th.title)
  d.text('Planète Parapente — Saint-Leu', cx, design === 'adult' ? 137 : 135, align)
  // QR code (bottom-right): scanned by the pilot on the day of the flight
  const qr = await QRCode.toDataURL(voucherCheckUrl(v.code), { margin: 1, width: 300 })
  fill(d, '#ffffff'); d.roundedRect(W - 38, H - 38, 30, 30, 2, 2, 'F')
  d.addImage(qr, 'PNG', W - 36, H - 36, 26, 26)
  return d
}

export const voucherFilename = (v) => `bon-cadeau-${v.code}.pdf`
