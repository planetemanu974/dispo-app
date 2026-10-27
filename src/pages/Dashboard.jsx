import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSlotsForDate } from '../utils/rules'
import ColleaguePanel from './ColleaguePanel'
import Settings from './Settings'
import History from './History'
import Comptabilite from './Comptabilite'
import AssignColleague from '../components/AssignColleague'
import FlightClosure from '../components/FlightClosure'
import { useSettings } from '../contexts/SettingsContext'
import { buildInvoiceNumber, downloadInvoice, invoiceFilename } from '../lib/invoice'

// ── Format a Date object as YYYY-MM-DD using LOCAL time (not UTC)
// Fixes timezone bug: toISOString() returns UTC, which shifts the date
// by -1 day in UTC+4 (La Réunion) when the local time is before midnight UTC.
function toLocalDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const TODAY = toLocalDateStr(new Date())

// ── Helper: generate array of YYYY-MM-DD for N days from a start date
function getDayRange(startDate, count) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(startDate + 'T00:00:00')
    d.setDate(d.getDate() + i)
    return toLocalDateStr(d)
  })
}

// ── Helper: get Monday of the week containing dateStr
function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay() // 0=Sun
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return toLocalDateStr(d)
}

// ── sendSMS: calls the Supabase Edge Function ──────────────────────────────
// ── logActivity ──────────────────────────────────────────────────────────────
// Records every meaningful pilot action in the activity_log table.
// action:      string key, e.g. 'booking_created'
// entityType:  'booking' | 'slot'
// entityId:    uuid of the affected row (or null)
// details:     free-form object stored as jsonb (booking_ref, contact_name, …)
async function logActivity(pilotId, action, entityType, entityId, details = {}) {
  try {
    await supabase.from('activity_log').insert({
      pilot_id:    pilotId,
      action,
      entity_type: entityType,
      entity_id:   entityId || null,
      details,
    })
  } catch (err) {
    // Log failure is non-fatal — never block the main action
    console.warn('[logActivity] could not write log:', err)
  }
}

async function sendSMS(to, message) {
  try {
    const { data, error } = await supabase.functions.invoke('send-sms', {
      body: { to, message },
    })
    if (error) console.error('SMS error:', error)
    return { data, error }
  } catch (err) {
    console.error('SMS exception:', err)
    return { error: err }
  }
}

// ── Day column labels
const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const WEEK_DAYS_COUNT = 7  // show full week Mon–Sun

// ── Calendar grid constants (Google Calendar style)
const HOUR_HEIGHT  = 56   // px per hour
const GRID_START_H = 8    // axis starts at 08:00
const GRID_END_H   = 16   // axis ends at 16:00 (last slot 14:30 ends at 15:45)
const SLOT_DURATION_MIN = 75  // default slot duration in minutes

// Grid hours array: [8, 9, 10, 11, 12, 13, 14, 15]
const GRID_HOURS = Array.from(
  { length: GRID_END_H - GRID_START_H + 1 },
  (_, i) => GRID_START_H + i
)

// Convert "HH:MM:SS" → minutes from midnight
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

// CSS top offset (px) for a given time string
function slotTop(timeStr) {
  const minutes = timeToMinutes(timeStr)
  return ((minutes - GRID_START_H * 60) / 60) * HOUR_HEIGHT
}

// CSS height (px) for a duration in minutes
function slotHeightPx(durationMin = SLOT_DURATION_MIN) {
  return (durationMin / 60) * HOUR_HEIGHT
}

// Format end time string given start time + duration
function slotEndTime(timeStr, durationMin = SLOT_DURATION_MIN) {
  const total = timeToMinutes(timeStr) + durationMin
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// ── DPD Logo SVG component ─────────────────────────────────────────────────
function DpdLogo({ size = 32, color = '#1e293b' }) {
  // Two interlocked D letters — the DispoPasDispo logo
  return (
    <svg width={size} height={size * 0.55} viewBox="0 0 200 110" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Left D (open left) */}
      <path d="M70 10 L30 10 Q8 10 8 55 Q8 100 30 100 L70 100 L70 80 L35 80 Q28 80 28 55 Q28 30 35 30 L70 30 Z" fill={color} />
      {/* Right D (open right) */}
      <path d="M130 10 L170 10 Q192 10 192 55 Q192 100 170 100 L130 100 L130 80 L165 80 Q172 80 172 55 Q172 30 165 30 L130 30 Z" fill={color} />
      {/* Interlocking bridge */}
      <rect x="65" y="42" width="70" height="26" rx="13" fill={color} />
    </svg>
  )
}

// ── Menu link item ─────────────────────────────────────────────────────────
function MenuLink({ icon, label, onClick, disabled, extra }) {
  return (
    <div>
      <button
        onClick={disabled ? undefined : onClick}
        style={{
          width: '100%', display:'flex', alignItems:'center', gap:12,
          padding: '12px 16px', background:'none', border:'none',
          color: disabled ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.85)',
          fontSize: '0.95rem', fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
          textAlign:'left', transition:'background 0.15s',
        }}
        onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
        <span style={{ fontSize:'1.1rem', width:24, textAlign:'center' }}>{icon}</span>
        <span>{label}</span>
        {disabled && <span style={{ marginLeft:'auto', fontSize:'0.7rem', background:'rgba(255,255,255,0.1)', borderRadius:4, padding:'2px 6px' }}>Bientôt</span>}
        {extra && <span style={{ marginLeft:'auto', background:'#22c55e', color:'#fff', borderRadius:10, padding:'1px 7px', fontSize:'0.75rem', fontWeight:700, minWidth:20, textAlign:'center' }}>{extra}</span>}
      </button>
    </div>
  )
}

export default function Dashboard({ pilot }) {
  // Dynamic settings — flight types, slots, school info
  const { settings } = useSettings()
  const flightTypes = settings.flight_types

  const [viewMode, setViewMode]               = useState('week')   // 'week' | 'day'
  const [weekStart, setWeekStart]             = useState(() => getWeekStart(TODAY))
  const [weekData, setWeekData]               = useState({})       // { [date]: { slots, bookings } }
  const [weekLoading, setWeekLoading]         = useState(false)
  // Fixed pilot unavailability for current week (loaded in loadWeek)
  const [fixedUnavailability, setFixedUnavailability] = useState([])
  // Slot clicked in week view for toggle-availability mini-modal
  const [slotToggleTarget, setSlotToggleTarget]       = useState(null) // slot object | null
  const [selectMode, setSelectMode]                   = useState(false)          // bulk-select mode
  const [selectedSlotIds, setSelectedSlotIds]         = useState(new Set())      // Set<slot.id>

  // Day view state
  const [selectedDate, setSelectedDate]       = useState(null)
  const [slots, setSlots]                     = useState([])
  const [bookings, setBookings]               = useState([])
  const [pendingAll, setPendingAll]           = useState([])
  const [loading, setLoading]                 = useState(true)
  const [selectedBooking, setSelectedBooking] = useState(null)
  const [selectedSlotBookings, setSelectedSlotBookings] = useState([]) // all bookings for a clicked slot (multi-pax)
  const [bookingAssignments, setBookingAssignments] = useState([]) // assignments for selected booking
  const [editMode, setEditMode]               = useState(false)
  const [editData, setEditData]               = useState(null)
  const [editSlots, setEditSlots]             = useState([])

  // New booking modal state
  const [newBookingSlot, setNewBookingSlot]   = useState(null)   // { slot, date } | null
  const [nbForm, setNbForm]                   = useState(null)   // form data
  const [nbSaving, setNbSaving]               = useState(false)

  // Side menu drawer state
  const [menuOpen, setMenuOpen]               = useState(false)
  const [colleaguePanelOpen, setColleaguePanelOpen] = useState(false)
  const [colleagueRequestSlot, setColleagueRequestSlot] = useState(null) // { date, time, bookingId? } — set when opened from "Pas de pilote"
  const [fixedPilotPicker, setFixedPilotPicker] = useState(null) // { bookingId, slotLabel, date, time } — quick picker for fixed pilots
  const [showSettings, setShowSettings]       = useState(false)
  const [showHistory, setShowHistory]         = useState(false)
  const [showComptabilite, setShowComptabilite] = useState(false)
  const [showAssign, setShowAssign]           = useState(false) // AssignColleague drawer

  // Colleague messages (unread)
  const [messages, setMessages]       = useState([])
  const [showMessages, setShowMessages] = useState(false)
  const unreadCount = messages.filter(m => !m.read_at).length

  // Colleague list for pilot dropdown in closure section
  const [colleagues, setColleagues] = useState([])

  // Post-flight closure form state
  const [showClosure, setShowClosure] = useState(false)
  const [closureData, setClosureData] = useState({ pilotName: 'Capitaine', paymentMethod: '', invoiceType: 'none' })
  const [closureSaving, setClosureSaving] = useState(false)

  // Pilot report overlay
  const [showPilotReport, setShowPilotReport] = useState(false)
  const [reportMonth, setReportMonth] = useState(() => toLocalDateStr(new Date()).slice(0, 7)) // YYYY-MM
  const [reportData, setReportData] = useState([])
  const [reportLoading, setReportLoading] = useState(false)

  // PWA update detection — fires when a new service worker takes control
  const [updateReady, setUpdateReady] = useState(false)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      setUpdateReady(true)
    })
  }, [])

  // 14-day planning strip state
  const [planning, setPlanning]               = useState({})
  const [planningLoading, setPlanningLoading] = useState(false)

  // ── INIT: runs once on mount ───────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const { data: slotData } = await supabase
        .from('pilot_slots')
        .select('id, slot_date, slot_time')
        .eq('pilot_id', pilot.id)
        .gte('slot_date', TODAY)

      let startDate = TODAY

      if (slotData && slotData.length > 0) {
        const slotIds = slotData.map(s => s.id)
        const slotMap = Object.fromEntries(slotData.map(s => [s.id, s]))

        const { data: pending } = await supabase
          .from('bookings')
          .select('*, passengers(*)')
          .in('pilot_slot_id', slotIds)
          .eq('status', 'pending')
          .order('created_at', { ascending: true })

        if (pending && pending.length > 0) {
          const enriched = pending.map(b => ({
            ...b,
            pilot_slots: slotMap[b.pilot_slot_id],
          }))
          setPendingAll(enriched)

          const earliest = enriched
            .map(b => b.pilot_slots?.slot_date)
            .filter(Boolean)
            .sort()[0]
          if (earliest) startDate = earliest
        }
      }

      setSelectedDate(startDate)
      setWeekStart(getWeekStart(startDate))
      await loadWeek(getWeekStart(startDate))
      await loadDay(startDate)
      loadPlanning(startDate)

      // Load colleague messages (all, most recent first)
      const { data: msgs } = await supabase
        .from('colleague_messages')
        .select('*')
        .eq('pilot_id', pilot.id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (msgs) setMessages(msgs)

      // Load colleagues for pilot dropdown in closure section
      const { data: cols } = await supabase
        .from('colleagues')
        .select('id, name, is_direct, is_fixed, fixed_order, created_at')
        .eq('pilot_id', pilot.id)
        .order('name')
      if (cols) {
        // Normalize fixed_order for fixed pilots that still have NULL (promoted before migration 016).
        // Sort by existing non-null ranks first, then assign next ranks to nulls in DB order.
        const fixedCols = cols.filter(c => c.is_direct && c.is_fixed)
        const hasNulls = fixedCols.some(c => c.fixed_order === null)
        if (hasNulls) {
          // Sort: non-null ranks first, then nulls in creation order (oldest = lowest rank)
          const sorted = [...fixedCols].sort((a, b) => {
            const ao = a.fixed_order ?? 99
            const bo = b.fixed_order ?? 99
            if (ao !== bo) return ao - bo
            return new Date(a.created_at) - new Date(b.created_at)
          })
          let nextRank = sorted.reduce((m, c) => c.fixed_order ? Math.max(m, c.fixed_order) : m, 0) + 1
          for (const c of sorted) {
            if (c.fixed_order === null) {
              await supabase.from('colleagues')
                .update({ fixed_order: nextRank })
                .eq('id', c.id)
                .eq('pilot_id', pilot.id)
              c.fixed_order = nextRank++
            }
          }
          // Merge normalized values back into cols
          const updated = cols.map(c => {
            const norm = sorted.find(s => s.id === c.id)
            return norm ? { ...c, fixed_order: norm.fixed_order } : c
          })
          setColleagues(updated)
        } else {
          setColleagues(cols)
        }
      }
    }

    init()
  }, [pilot.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mark colleague messages as read ───────────────────────────────────────
  async function markMessagesRead() {
    const unread = messages.filter(m => !m.read_at).map(m => m.id)
    if (unread.length === 0) return
    await supabase
      .from('colleague_messages')
      .update({ read_at: new Date().toISOString() })
      .in('id', unread)
    setMessages(prev => prev.map(m => unread.includes(m.id) ? { ...m, read_at: new Date().toISOString() } : m))
  }

  // ── Load week when weekStart changes ──────────────────────────────────────
  useEffect(() => {
    if (!weekStart) return
    loadWeek(weekStart)
  }, [weekStart]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reload day view when date changes ─────────────────────────────────────
  useEffect(() => {
    if (selectedDate === null) return
    if (viewMode === 'day') {
      loadDay(selectedDate)
      loadPlanning(selectedDate)
    }
  }, [selectedDate, viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch assignments when a booking is selected ───────────────────────────
  // Also auto-assigns fixed pilots when paxCount > 1 and no accepted assignment exists yet.
  useEffect(() => {
    if (!selectedBooking) { setBookingAssignments([]); return }

    async function fetchAndAutoAssign() {
      const { data: existing } = await supabase
        .from('booking_assignments')
        .select('*, colleagues(name, phone)')
        .eq('booking_id', selectedBooking.id)
        .order('created_at')

      const existingAssignments = existing || []
      const paxCount = selectedBooking.passengers?.length || 1

      // Fixed pilots sorted by rank (N°1 = main pilot, N°2..N = colleagues)
      const fixedPilots = colleagues
        .filter(c => c.is_direct && c.is_fixed)
        .sort((a, b) => (a.fixed_order ?? 99) - (b.fixed_order ?? 99))

      if (paxCount > 1 && fixedPilots.length >= 2) {
        // Pilots N°2..N fly passengers 2..N — build the expected colleague list
        const expectedColleagues = fixedPilots.slice(1, paxCount) // N°2, N°3, ...

        // Check if accepted assignments already match expected list (same ids, same order)
        const accepted = existingAssignments
          .filter(a => a.status === 'accepted')
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

        const alreadyCorrect = accepted.length === expectedColleagues.length &&
          accepted.every((a, i) => a.colleague_id === expectedColleagues[i].id)

        if (!alreadyCorrect) {
          // Delete all accepted assignments and recreate in correct rank order
          const toDelete = existingAssignments.filter(a => a.status === 'accepted')
          if (toDelete.length > 0) {
            await supabase.from('booking_assignments')
              .delete()
              .in('id', toDelete.map(a => a.id))
          }
          await Promise.all(expectedColleagues.map(fp =>
            supabase.from('booking_assignments').insert({
              booking_id:   selectedBooking.id,
              colleague_id: fp.id,
              pilot_id:     pilot.id,
              status:       'accepted',
            })
          ))
          const { data: refreshed } = await supabase
            .from('booking_assignments')
            .select('*, colleagues(name, phone)')
            .eq('booking_id', selectedBooking.id)
            .order('created_at')
          setBookingAssignments(refreshed || [])
          loadWeek(weekStart)
          return
        }
      }

      setBookingAssignments(existingAssignments)
    }

    fetchAndAutoAssign()
  }, [selectedBooking?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── loadWeek ───────────────────────────────────────────────────────────────
  async function loadWeek(start) {
    setWeekLoading(true)
    const days = getDayRange(start, WEEK_DAYS_COUNT)

    await Promise.all(days.map(d => ensureSlots(d)))

    const { data: slotsData } = await supabase
      .from('pilot_slots').select('*')
      .eq('pilot_id', pilot.id)
      .gte('slot_date', days[0])
      .lte('slot_date', days[days.length - 1])
      .order('slot_time')

    const slotIds = (slotsData || []).map(s => s.id)
    let bookingsData = []
    if (slotIds.length > 0) {
      const { data } = await supabase
        .from('bookings')
        .select('*, passengers(*), pilot_slots(id, slot_date, slot_time, is_available)')
        .in('pilot_slot_id', slotIds)
        .in('status', ['pending', 'confirmed'])
        .order('created_at')
      bookingsData = data || []
    }

    // Fetch colleague assignments (all statuses) for slot colour indicators
    const bookingIds = bookingsData.map(b => b.id)
    let pendingAssignmentBookingIds  = new Set()  // orange — waiting for reply
    let refusedAssignmentBookingIds  = new Set()  // red    — refused, no replacement
    let acceptedAssignmentBookingIds = new Set()  // green  — at least one confirmed
    const acceptedColleagueByBooking = {}         // bookingId → first accepted colleague name (for badge)
    const acceptedAssignmentCountByBooking = {}   // bookingId → total accepted count
    // colleagueIdsByBooking: bookingId → Set<colleague_id> (accepted assignments only)
    // Used by the pilots grid to show blue "booked" cells
    const colleagueIdsByBooking = {}
    if (bookingIds.length > 0) {
      const { data: assignData } = await supabase
        .from('booking_assignments')
        .select('booking_id, status, colleague_id, colleagues(name)')
        .in('booking_id', bookingIds)
      ;(assignData || []).forEach(a => {
        if (a.status === 'pending')  pendingAssignmentBookingIds.add(a.booking_id)
        if (a.status === 'refused')  refusedAssignmentBookingIds.add(a.booking_id)
        if (a.status === 'accepted') {
          acceptedAssignmentBookingIds.add(a.booking_id)
          if (!acceptedColleagueByBooking[a.booking_id])
            acceptedColleagueByBooking[a.booking_id] = a.colleagues?.name || '—'
          acceptedAssignmentCountByBooking[a.booking_id] =
            (acceptedAssignmentCountByBooking[a.booking_id] || 0) + 1
        }
        // Track which colleagues are assigned (any non-refused status) for the pilots grid
        if (a.status !== 'refused' && a.colleague_id) {
          if (!colleagueIdsByBooking[a.booking_id])
            colleagueIdsByBooking[a.booking_id] = new Set()
          colleagueIdsByBooking[a.booking_id].add(a.colleague_id)
        }
      })
      // A booking with "refused" but also "pending" stays orange (replacement in progress)
      refusedAssignmentBookingIds.forEach(id => {
        if (pendingAssignmentBookingIds.has(id) || acceptedAssignmentBookingIds.has(id))
          refusedAssignmentBookingIds.delete(id)
      })
    }

    // Organise by date
    const byDate = {}
    days.forEach(d => { byDate[d] = { slots: [], bookings: [] } })
    ;(slotsData || []).forEach(s => {
      if (byDate[s.slot_date]) byDate[s.slot_date].slots.push(s)
    })
    bookingsData.forEach(b => {
      const d = b.pilot_slots?.slot_date
      if (d && byDate[d]) byDate[d].bookings.push(b)
    })

    // Attach assignment flags + accepted colleague name to each booking
    Object.values(byDate).forEach(({ bookings }) => {
      bookings.forEach(b => {
        b._hasPendingAssignment    = pendingAssignmentBookingIds.has(b.id)
        b._hasRefusedAssignment    = refusedAssignmentBookingIds.has(b.id)
        b._hasAcceptedAssignment   = acceptedAssignmentBookingIds.has(b.id)
        b._acceptedColleagueName   = acceptedColleagueByBooking[b.id] || null
        b._acceptedAssignmentCount = acceptedAssignmentCountByBooking[b.id] || 0
        // Set of colleague IDs (pending or accepted) assigned to this booking
        b._assignedColleagueIds    = colleagueIdsByBooking[b.id] || new Set()
      })
    })

    // Load fixed pilot unavailability for this week
    const { data: unavailData } = await supabase
      .from('fixed_pilot_unavailability')
      .select('id, colleague_id, start_date, end_date, slot_time')
      .eq('pilot_id', pilot.id)
      .lte('start_date', days[days.length - 1])
      .gte('end_date', days[0])
    setFixedUnavailability(unavailData || [])

    setWeekData(byDate)
    setWeekLoading(false)
  }

  // ── loadDay ────────────────────────────────────────────────────────────────
  async function loadDay(date, silent = false) {
    if (!silent) setLoading(true)
    await ensureSlots(date)

    const { data: slotsData } = await supabase
      .from('pilot_slots').select('*')
      .eq('pilot_id', pilot.id).eq('slot_date', date).order('slot_time')

    const slotIds = (slotsData || []).map(s => s.id)
    let bookingsData = []
    if (slotIds.length > 0) {
      const { data } = await supabase
        .from('bookings').select('*, passengers(*), pilot_slots(id, slot_date, slot_time, is_available)')
        .in('pilot_slot_id', slotIds)
        .in('status', ['pending', 'confirmed'])
        .order('created_at')
      bookingsData = data || []
    }

    setSlots(slotsData || [])
    setBookings(bookingsData)
    setLoading(false)
  }

  // ── isColleagueUnavailable ────────────────────────────────────────────────
  // Returns true if the fixed colleague has an unavailability entry covering
  // the given date and optional slot_time (null = full-day check only).
  function isColleagueUnavailable(colleagueId, dateStr, slotTime) {
    return fixedUnavailability.some(u => {
      if (u.colleague_id !== colleagueId) return false
      if (u.start_date > dateStr || u.end_date < dateStr) return false
      if (u.slot_time === null) return true  // full-day covers any slot
      // Specific slot check — match HH:MM prefix
      return slotTime && u.slot_time.slice(0, 5) === slotTime.slice(0, 5)
    })
  }

  // ── togglePilotAvailability ───────────────────────────────────────────────
  // Called from the pilots planning view when the user clicks a slot cell.
  // Toggles the absence entry for a given colleague/date/slotTime.
  // Uses optimistic update: UI changes instantly, Supabase call runs async.
  async function togglePilotAvailability(colleagueId, dateStr, slotTimeHHMM) {
    // Find entries that cover this specific slot
    const matching = fixedUnavailability.filter(u => {
      if (u.colleague_id !== colleagueId) return false
      if (u.start_date > dateStr || u.end_date < dateStr) return false
      if (u.slot_time === null) return true                           // full-day covers any slot
      return u.slot_time.slice(0, 5) === slotTimeHHMM
    })

    if (matching.length > 0) {
      // ── Currently ABSENT → make PRESENT: delete matching entries ──────────
      const idsToDelete = matching.map(e => e.id)
      // Optimistic update
      setFixedUnavailability(prev => prev.filter(u => !idsToDelete.includes(u.id)))
      const { error } = await supabase
        .from('fixed_pilot_unavailability')
        .delete()
        .in('id', idsToDelete)
      if (error) {
        console.error('togglePilotAvailability delete error:', error)
        loadWeek(weekStart)  // revert on error
      }
    } else {
      // ── Currently PRESENT → make ABSENT: insert new entry ─────────────────
      // pilot_id is required by the table (RLS policy: pilot_id = auth.uid())
      const newEntry = {
        pilot_id:     pilot.id,
        colleague_id: colleagueId,
        start_date:   dateStr,
        end_date:     dateStr,
        slot_time:    slotTimeHHMM + ':00'
      }
      const tempId = 'temp_' + Date.now()
      // Optimistic update with temporary id
      setFixedUnavailability(prev => [...prev, { ...newEntry, id: tempId }])
      const { data, error } = await supabase
        .from('fixed_pilot_unavailability')
        .insert(newEntry)
        .select()
        .single()
      if (error) {
        console.error('togglePilotAvailability insert error:', error)
        setFixedUnavailability(prev => prev.filter(u => u.id !== tempId))
        loadWeek(weekStart)  // revert on error
      } else {
        // Replace temp id with real id from database
        setFixedUnavailability(prev => prev.map(u => u.id === tempId ? data : u))
      }
    }
  }

  // ── loadPlanning ──────────────────────────────────────────────────────────
  async function loadPlanning(fromDate) {
    setPlanningLoading(true)
    const days = getDayRange(fromDate, 14)
    const [dayStart, dayEnd] = [days[0], days[days.length - 1]]

    await Promise.all(days.map(d => ensureSlots(d)))

    const { data: slotData } = await supabase
      .from('pilot_slots').select('id, slot_date')
      .eq('pilot_id', pilot.id)
      .gte('slot_date', dayStart).lte('slot_date', dayEnd)

    if (!slotData || slotData.length === 0) { setPlanningLoading(false); return }

    const slotIds = slotData.map(s => s.id)
    const slotMap = Object.fromEntries(slotData.map(s => [s.id, s.slot_date]))

    const { data: bkData } = await supabase
      .from('bookings').select('id, pilot_slot_id, status')
      .in('pilot_slot_id', slotIds).in('status', ['pending', 'confirmed'])

    const summary = {}
    days.forEach(d => { summary[d] = { pending: 0, confirmed: 0 } })
    ;(bkData || []).forEach(b => {
      const d = slotMap[b.pilot_slot_id]
      if (!d || !summary[d]) return
      if (b.status === 'pending')   summary[d].pending   += 1
      if (b.status === 'confirmed') summary[d].confirmed += 1
    })

    setPlanning(summary)
    setPlanningLoading(false)
  }

  // ── ensureSlots ────────────────────────────────────────────────────────────
  async function ensureSlots(date) {
    const times = getSlotsForDate(new Date(date))
    const inserts = times.map(t => ({
      pilot_id: pilot.id, slot_date: date, slot_time: t,
      is_available: true, booked_count: 0, capacity: 4,
    }))
    await supabase.from('pilot_slots')
      .upsert(inserts, { onConflict: 'pilot_id,slot_date,slot_time', ignoreDuplicates: true })
  }

  // ── toggleAvailability ────────────────────────────────────────────────────
  async function toggleAvailability(slot) {
    const newAvail = !slot.is_available
    await supabase.from('pilot_slots')
      .update({ is_available: newAvail }).eq('id', slot.id)
    logActivity(pilot.id, 'slot_toggled', 'slot', slot.id, {
      slot_date:    slot.slot_date,
      slot_time:    slot.slot_time,
      is_available: newAvail,
    })
    loadDay(selectedDate)
    loadWeek(weekStart)
  }

  // ── applyBulkAvailability ─────────────────────────────────────────────────
  // Sets is_available on all selectedSlotIds in one Supabase call, then exits select mode.
  async function applyBulkAvailability(isAvailable) {
    const ids = [...selectedSlotIds]
    if (ids.length === 0) return
    await supabase.from('pilot_slots')
      .update({ is_available: isAvailable })
      .in('id', ids)
    logActivity(pilot.id, 'bulk_slot_toggle', 'slot', null, {
      slot_ids: ids, is_available: isAvailable, count: ids.length
    })
    setSelectedSlotIds(new Set())
    setSelectMode(false)
    loadWeek(weekStart)
  }

  // ── deleteBulkSlots ───────────────────────────────────────────────────────
  // Permanently removes selected slots from pilot_slots.
  // Warns if any have active bookings; user must confirm before proceeding.
  async function deleteBulkSlots() {
    const ids = [...selectedSlotIds]
    if (ids.length === 0) return

    // Check for active bookings on selected slots
    const { data: activeBks } = await supabase
      .from('bookings')
      .select('id, pilot_slot_id')
      .in('pilot_slot_id', ids)
      .in('status', ['pending', 'confirmed'])

    if (activeBks && activeBks.length > 0) {
      const ok = window.confirm(
        `⚠️ ${activeBks.length} réservation(s) active(s) sont liées à ces créneaux.\n\nSupprimer quand même ? Les réservations seront aussi supprimées.`
      )
      if (!ok) return
    } else {
      const ok = window.confirm(
        `Supprimer définitivement ${ids.length} créneau(x) sélectionné(s) ?`
      )
      if (!ok) return
    }

    await supabase.from('pilot_slots').delete().in('id', ids)
    logActivity(pilot.id, 'bulk_slot_delete', 'slot', null, {
      slot_ids: ids, count: ids.length
    })
    setSelectedSlotIds(new Set())
    setSelectMode(false)
    loadWeek(weekStart)
  }

  // ── handleBooking ─────────────────────────────────────────────────────────
  async function handleBooking(bookingId, action) {
    await supabase.from('bookings').update({ status: action }).eq('id', bookingId)
    setSelectedBooking(prev => prev ? { ...prev, status: action } : null)

    // Audit log
    const logAction = action === 'confirmed' ? 'booking_confirmed'
                    : action === 'refused'   ? 'booking_refused'
                    : `booking_${action}`
    logActivity(pilot.id, logAction, 'booking', bookingId, {
      booking_ref:   selectedBooking?.booking_ref,
      contact_name:  selectedBooking?.contact_name,
      contact_phone: selectedBooking?.contact_phone,
      slot_date:     selectedBooking?.pilot_slots?.slot_date,
      slot_time:     selectedBooking?.pilot_slots?.slot_time,
      pax_count:     selectedBooking?.passengers?.length || 0,
    })

    if (action === 'confirmed' && selectedBooking?.contact_phone) {
      const slotDate = selectedBooking.pilot_slots?.slot_date || selectedDate
      const slotTime = selectedBooking.pilot_slots?.slot_time?.slice(0, 5) || ''
      const dateLabel = new Date(slotDate + 'T00:00:00').toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long'
      })
      const paxCount = selectedBooking.passengers?.length || 1
      const paxLabel = paxCount > 1 ? `${paxCount} personnes` : '1 personne'
      const confirmMsg =
        `Bonjour, votre vol parapente est confirme pour le ${dateLabel} a ${slotTime} pour ${paxLabel}. ` +
        `RDV plage a cote de Kelonia, navette Planete Parapente. ` +
        `Chaussures fermees obligatoires. Paiement especes/cheque. ` +
        `Manu 0692719749`
      await sendSMS(selectedBooking.contact_phone, confirmMsg)
    }

    const { data: slotData } = await supabase
      .from('pilot_slots').select('id, slot_date, slot_time')
      .eq('pilot_id', pilot.id).gte('slot_date', TODAY)

    if (slotData && slotData.length > 0) {
      const slotIds = slotData.map(s => s.id)
      const slotMap = Object.fromEntries(slotData.map(s => [s.id, s]))
      const { data: pending } = await supabase
        .from('bookings').select('*, passengers(*)')
        .in('pilot_slot_id', slotIds).eq('status', 'pending')
        .order('created_at', { ascending: true })
      const enriched = (pending || []).map(b => ({ ...b, pilot_slots: slotMap[b.pilot_slot_id] }))
      setPendingAll(enriched)
    } else {
      setPendingAll([])
    }

    loadDay(selectedDate, true)
    loadPlanning(selectedDate)
    loadWeek(weekStart)
  }

  // ── openNewBooking ────────────────────────────────────────────────────────
  function openNewBooking(slot, date) {
    if (!slot.is_available) return   // can't book an unavailable slot
    setNewBookingSlot({ slot, date })
    const emptyPax = (cat, vol) => ({ firstName: '', lastName: '', cat: cat || 'under75', vol: vol || flightTypes[0]?.id || 'discovery' })
    setNbForm({
      contactFirstName: '',
      contactLastName:  '',
      contactPhone:     '',
      totalCount:       1,   // total persons
      childCount:       0,   // marmailles (< 14 ans)
      discoveryCount:   1,   // vols découverte
      performanceCount: 0,   // vols performance
      notes:            '',
      passengers: [emptyPax()],
    })
  }

  // ── submitNewBooking ──────────────────────────────────────────────────────
  async function submitNewBooking() {
    if (!nbForm || !newBookingSlot) return
    const contactName = `${nbForm.contactFirstName.trim()} ${nbForm.contactLastName.trim()}`.trim()
    if (!contactName) { alert('Nom du contact requis'); return }
    if (!nbForm.contactPhone.trim()) { alert('Téléphone requis'); return }
        // Block bookings on past slots
    const slotDateTime = new Date(`${newBookingSlot.slot.slot_date}T${newBookingSlot.slot.slot_time}`)
    if (slotDateTime < new Date()) { alert('Ce créneau est déjà passé.'); return } 
    setNbSaving(true)

    const ref = 'MAN-' + Date.now().toString(36).toUpperCase().slice(-6)

    const { data: bk, error: bkErr } = await supabase.from('bookings').insert({
      pilot_slot_id: newBookingSlot.slot.id,
      contact_name:  contactName,
      contact_phone: nbForm.contactPhone.trim(),
      notes:         nbForm.notes.trim() || null,
      status:        'confirmed',
      source:        'manual',
      booking_ref:   ref,
    }).select().single()

    if (bkErr || !bk) { alert('Erreur lors de la création'); setNbSaving(false); return }

    // Insert passengers — always insert at least the first row
    for (const p of nbForm.passengers) {
      const isFirstRow = nbForm.passengers.indexOf(p) === 0
      const { weight_kg, age, parental_auth } = catToDb(p.cat)
      const { error: paxErr } = await supabase.from('passengers').insert({
        booking_id:    bk.id,
        first_name:    p.firstName.trim() || '',
        last_name:     p.lastName.trim()  || '',
        weight_kg,
        age,
        flight_type:   p.vol,
        price_eur:     flightTypes.find(f => f.id === p.vol)?.price_eur ?? 90,
        parental_auth,
      })
      if (paxErr) {
        console.error('[submitNewBooking] passenger insert error:', paxErr)
        alert(`Erreur lors de l'enregistrement du passager : ${paxErr.message}`)
      }
    }

    // ── Multi-slot: blocks_slots depends on flight type, not on passenger name ──
    const maxBlocks = nbForm.passengers.reduce((max, p) => {
      const ft = flightTypes.find(f => f.id === p.vol)
      return Math.max(max, ft?.blocks_slots ?? 1)
    }, 1)

    if (maxBlocks > 1) {
      // Fetch next (maxBlocks - 1) pilot slots on same day after selected slot
      const slotDate = newBookingSlot.slot.slot_date || newBookingSlot.date
      const { data: nextSlots, error: nextErr } = await supabase
        .from('pilot_slots')
        .select('id, slot_time')
        .eq('pilot_id', pilot.id)
        .eq('slot_date', slotDate)
        .gt('slot_time', newBookingSlot.slot.slot_time)
        .order('slot_time', { ascending: true })
        .limit(maxBlocks - 1)

      console.log('[multi-slot] maxBlocks:', maxBlocks, 'slotDate:', slotDate,
        'slot_time:', newBookingSlot.slot.slot_time, 'nextSlots:', nextSlots, 'err:', nextErr)

      if (!nextSlots || nextSlots.length < maxBlocks - 1) {
        alert(`⚠️ Ce vol nécessite ${maxBlocks} créneaux consécutifs, mais le créneau suivant n'existe pas dans ton planning. Crée d'abord tous les créneaux nécessaires pour cette journée.`)
      } else {
        for (let i = 0; i < nextSlots.length; i++) {
          const extraSlot = nextSlots[i]
          const { data: extraBk } = await supabase.from('bookings').insert({
            pilot_slot_id: extraSlot.id,
            contact_name:  contactName,
            contact_phone: nbForm.contactPhone.trim(),
            notes:         `Lié à ${ref} — créneau ${i + 2}/${maxBlocks}`,
            status:        'confirmed',
            source:        'manual',
            booking_ref:   ref + '-' + (i + 2),
          }).select().single()

          if (extraBk) {
            for (const p of nbForm.passengers) {
              const { weight_kg: xWkg, age: xAge, parental_auth: xPA } = catToDb(p.cat)
              const { error: xPaxErr } = await supabase.from('passengers').insert({
                booking_id:    extraBk.id,
                first_name:    p.firstName.trim() || '',
                last_name:     p.lastName.trim()  || '',
                weight_kg:     xWkg,
                age:           xAge,
                flight_type:   p.vol,
                price_eur:     flightTypes.find(f => f.id === p.vol)?.price_eur ?? 90,
                parental_auth: xPA,
              })
              if (xPaxErr) {
                console.error('[multi-slot] extra passenger insert error:', xPaxErr)
                alert(`Erreur passager créneau lié : ${xPaxErr.message}`)
              }
            }
          }
        }
      }
    }

    // ── Send confirmation SMS to client ──────────────────────────────────────
    if (nbForm.contactPhone.trim()) {
      const slotDate = newBookingSlot.slot.slot_date || newBookingSlot.date
      const slotTime = newBookingSlot.slot.slot_time?.slice(0, 5) || ''
      const dateLabel = new Date(slotDate + 'T00:00:00').toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long'
      })
      const paxLabel  = nbForm.passengers.length > 1 ? `${nbForm.passengers.length} personnes` : '1 personne'
      const smsMsg =
        `Bonjour, votre vol parapente est confirme pour le ${dateLabel} a ${slotTime} pour ${paxLabel}. ` +
        `RDV plage a cote de Kelonia, navette Planete Parapente. ` +
        `Chaussures fermees obligatoires. Paiement especes/cheque. ` +
        `Manu 0692719749`
      const { error: smsErr } = await sendSMS(nbForm.contactPhone.trim(), smsMsg)
      if (smsErr) {
        // Mark the booking so the pilot can see it in the detail view
        await supabase.from('bookings').update({
          notes: (nbForm.notes.trim() ? nbForm.notes.trim() + '\n' : '') + '⚠️ SMS non envoyé (vérifier le numéro)',
        }).eq('id', bk.id)
        // Audit log the SMS failure
        logActivity(pilot.id, 'sms_failed', 'booking', bk.id, {
          booking_ref:   ref,
          contact_phone: nbForm.contactPhone.trim(),
          note:          'SMS non envoyé — numéro invalide ou problème réseau',
        })
        alert(
          `⚠️ Réservation créée, mais le SMS n'a pas pu être envoyé au client.\n` +
          `Numéro : ${nbForm.contactPhone.trim()}\n` +
          `Vérifiez le numéro et recontactez le client si nécessaire.`
        )
      }
    }

    // Audit log — booking created manually
    logActivity(pilot.id, 'booking_created', 'booking', bk.id, {
      booking_ref:   ref,
      contact_name:  contactName,
      contact_phone: nbForm.contactPhone.trim(),
      slot_date:     newBookingSlot.slot.slot_date || newBookingSlot.date,
      slot_time:     newBookingSlot.slot.slot_time,
      pax_count:     nbForm.passengers.length,
    })

    const savedDate = newBookingSlot.date
    setNbSaving(false)
    setNewBookingSlot(null)
    setNbForm(null)
    loadDay(savedDate, true)
    loadWeek(weekStart)
    loadPlanning(savedDate)
  }

  // ── derived ───────────────────────────────────────────────────────────────
  const bookingsBySlot = bookings.reduce((acc, b) => {
    acc[b.pilot_slot_id] = acc[b.pilot_slot_id] || []
    acc[b.pilot_slot_id].push(b)
    return acc
  }, {})

  const pendingByDate = pendingAll.reduce((acc, b) => {
    const d = b.pilot_slots?.slot_date
    if (!d) return acc
    acc[d] = acc[d] || []
    acc[d].push(b)
    return acc
  }, {})

  const flightTypeLabel = id => flightTypes.find(f => f.id === id)?.label ?? id

  // Weight category helpers (used in booking form + passenger detail display)
  const WEIGHT_CATS = [
    { id: 'under75',  label: '< 75 kg'   },
    { id: 'under14',  label: '< 14 ans'  },
    { id: '75to100',  label: '75-100 kg' },
  ]
  const catLabel = (weightKg, age) => {
    if (age > 0 && age < 15)   return '< 14 ans'
    if (weightKg >= 75)        return '75-100 kg'
    return '< 75 kg'
  }
  // Map category id → DB values for weight_kg, age, parental_auth
  const catToDb = (cat) => {
    if (cat === 'under14')  return { weight_kg: 0,  age: 12, parental_auth: true  }
    if (cat === '75to100')  return { weight_kg: 85, age: 30, parental_auth: false }
    return                         { weight_kg: 65, age: 30, parental_auth: false } // under75
  }

  // ── handleCancel ──────────────────────────────────────────────────────────
  async function handleCancel(bookingId) {
    if (!window.confirm('Annuler cette reservation ?')) return
    await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)
    logActivity(pilot.id, 'booking_cancelled', 'booking', bookingId, {
      booking_ref:   selectedBooking?.booking_ref,
      contact_name:  selectedBooking?.contact_name,
      contact_phone: selectedBooking?.contact_phone,
      slot_date:     selectedBooking?.pilot_slots?.slot_date,
      slot_time:     selectedBooking?.pilot_slots?.slot_time,
    })
    setSelectedBooking(null); setEditMode(false)
    const { data: slotData } = await supabase
      .from('pilot_slots').select('id, slot_date, slot_time')
      .eq('pilot_id', pilot.id).gte('slot_date', TODAY)
    if (slotData && slotData.length > 0) {
      const slotIds = slotData.map(s => s.id)
      const slotMap = Object.fromEntries(slotData.map(s => [s.id, s]))
      const { data: pending } = await supabase
        .from('bookings').select('*, passengers(*)')
        .in('pilot_slot_id', slotIds).eq('status', 'pending')
        .order('created_at', { ascending: true })
      setPendingAll((pending || []).map(b => ({ ...b, pilot_slots: slotMap[b.pilot_slot_id] })))
    } else {
      setPendingAll([])
    }
    loadDay(selectedDate)
    loadPlanning(selectedDate)
    loadWeek(weekStart)
  }

  // ── handleClosure ────────────────────────────────────────────────────────────
  // Records pilot, payment, and optionally generates invoice PDF(s).
  async function handleClosure() {
    if (!closureData.paymentMethod) { alert('Choisissez un mode de paiement.'); return }
    setClosureSaving(true)
    try {
      const flightDate = selectedBooking.pilot_slots?.slot_date || toLocalDateStr(new Date())

      // ── Invoice number calculation ─────────────────────────────────────────
      // Count bookings already invoiced today to get sequence number.
      let invoiceNum = null
      if (closureData.invoiceType !== 'none') {
        const dayPrefix = buildInvoiceNumber(flightDate, 0).replace('/0', '') // DDMMYY
        // bookings has no pilot_id column — filter via pilot_slot_id list
        // (RLS also restricts to the pilot's own data)
        const { data: todayInvoices } = await supabase
          .from('bookings')
          .select('invoice_number')
          .like('invoice_number', `${dayPrefix}/%`)
          .not('invoice_number', 'is', null)
        const nextSeq = (todayInvoices?.length || 0) + 1
        invoiceNum = buildInvoiceNumber(flightDate, nextSeq)
      }

      // ── Persist closure data ───────────────────────────────────────────────
      await supabase
        .from('bookings')
        .update({
          flew_pilot_name: closureData.pilotName,
          payment_method:  closureData.paymentMethod,
          invoice_type:    closureData.invoiceType,
          invoice_number:  invoiceNum,
          paid_at:         new Date().toISOString(),
        })
        .eq('id', selectedBooking.id)

      // ── Generate invoice PDF(s) ────────────────────────────────────────────
      const passengers = selectedBooking.passengers || []

      if (closureData.invoiceType === 'single') {
        // One PDF for the whole group — payer = contact
        const lines = passengers.map(p => {
          const ft = flightTypes.find(t => t.id === p.flight_type)
          return {
            label:    ft ? `${ft.label} biplace` : 'Prestation biplace',
            priceEur: ft?.price_eur || 0,
          }
        })
        downloadInvoice(
          { invoiceNumber: invoiceNum, date: flightDate, clientName: selectedBooking.contact_name || '—', lines },
          invoiceFilename(invoiceNum)
        )

      } else if (closureData.invoiceType === 'individual') {
        // One PDF per passenger — each gets their own number (seq continues)
        const dayPrefix = buildInvoiceNumber(flightDate, 0).replace('/0', '')
        const { data: existingNow } = await supabase
          .from('bookings')
          .select('invoice_number')
          .like('invoice_number', `${dayPrefix}/%`)
          .not('invoice_number', 'is', null)
        let baseSeq = (existingNow?.length || 0) // we already wrote the booking above

        passengers.forEach((p, idx) => {
          const seq = baseSeq + idx + 1
          const num = buildInvoiceNumber(flightDate, seq)
          const ft  = flightTypes.find(t => t.id === p.flight_type)
          const clientName = [p.first_name, p.last_name].filter(Boolean).join(' ') || selectedBooking.contact_name || `Passager ${idx + 1}`
          downloadInvoice(
            {
              invoiceNumber: num,
              date:          flightDate,
              clientName,
              lines: [{ label: ft ? `${ft.label} biplace` : 'Prestation biplace', priceEur: ft?.price_eur || 0 }],
            },
            invoiceFilename(num)
          )
        })
      }

      // ── Update local state ─────────────────────────────────────────────────
      setSelectedBooking(prev => ({
        ...prev,
        flew_pilot_name: closureData.pilotName,
        payment_method:  closureData.paymentMethod,
        invoice_type:    closureData.invoiceType,
        invoice_number:  invoiceNum,
        paid_at:         new Date().toISOString(),
      }))
      setShowClosure(false)
      loadDay(selectedDate)
      loadWeek(weekStart)

    } catch (err) {
      console.error('[handleClosure]', err)
      alert('Erreur lors de la clôture : ' + err.message)
    } finally {
      setClosureSaving(false)
    }
  }

  // ── loadPilotReport ────────────────────────────────────────────────────────
  async function loadPilotReport(month) {
    setReportLoading(true)
    try {
      // month = 'YYYY-MM'
      const from = `${month}-01`
      const to   = `${month}-31`
      // bookings has no pilot_id — filter via non-null flew_pilot_name + date range
      // RLS restricts rows to the logged-in pilot's slots automatically
      const { data } = await supabase
        .from('bookings')
        .select('flew_pilot_name, payment_method, invoice_type, paid_at, pilot_slots(slot_date, slot_time), passengers(*)')
        .not('flew_pilot_name', 'is', null)
        .gte('paid_at', from)
        .lte('paid_at', to)
        .order('paid_at', { ascending: true })
      setReportData(data || [])
    } catch (err) {
      console.error('[loadPilotReport]', err)
    } finally {
      setReportLoading(false)
    }
  }

  // ── loadEditSlots ─────────────────────────────────────────────────────────
  async function loadEditSlots(date) {
    await ensureSlots(date)
    const { data } = await supabase
      .from('pilot_slots').select('*')
      .eq('pilot_id', pilot.id).eq('slot_date', date).order('slot_time')
    setEditSlots(data || [])
  }

  // ── enterEditMode ─────────────────────────────────────────────────────────
  function enterEditMode() {
    const slotDate = selectedBooking.pilot_slots?.slot_date || selectedDate
    setEditData({
      contact_name:  selectedBooking.contact_name  || '',
      contact_phone: selectedBooking.contact_phone || '',
      notes:         selectedBooking.notes         || '',
      slot_date:     slotDate,
      pilot_slot_id: selectedBooking.pilot_slot_id || '',
      passengers: (selectedBooking.passengers || []).map(p => ({ ...p })),
    })
    loadEditSlots(slotDate)
    setEditMode(true)
  }

  // ── handleSaveEdit ────────────────────────────────────────────────────────
  async function handleSaveEdit() {
    // Capture changes before saving for the audit log
    const oldPhone = selectedBooking.contact_phone
    const newPhone = editData.contact_phone
    const phoneChanged = oldPhone !== newPhone

    await supabase.from('bookings').update({
      contact_name:  editData.contact_name,
      contact_phone: editData.contact_phone,
      notes:         editData.notes?.trim() || null,
      pilot_slot_id: editData.pilot_slot_id,
    }).eq('id', selectedBooking.id)

    logActivity(pilot.id, 'booking_edited', 'booking', selectedBooking.id, {
      booking_ref:   selectedBooking.booking_ref,
      contact_name:  editData.contact_name,
      contact_phone: newPhone,
      slot_date:     editData.slot_date,
      ...(phoneChanged ? { old_phone: oldPhone, new_phone: newPhone } : {}),
    })

    const originalIds = (selectedBooking.passengers || []).map(p => p.id)
    const keptIds     = editData.passengers.filter(p => p.id).map(p => p.id)
    const removedIds  = originalIds.filter(id => !keptIds.includes(id))
    if (removedIds.length > 0) {
      await supabase.from('passengers').delete().in('id', removedIds)
    }

    for (const p of editData.passengers) {
      if (p.id) {
        await supabase.from('passengers').update({
          first_name: p.first_name, last_name: p.last_name,
          weight_kg:  parseInt(p.weight_kg), age: parseInt(p.age),
          flight_type: p.flight_type,
        }).eq('id', p.id)
      } else {
        await supabase.from('passengers').insert({
          booking_id:  selectedBooking.id,
          first_name:  p.first_name, last_name: p.last_name,
          weight_kg:   parseInt(p.weight_kg), age: parseInt(p.age),
          flight_type: p.flight_type, price_eur: 0,
        })
      }
    }

    const [{ data: updated }, { data: newSlot }] = await Promise.all([
      supabase.from('bookings').select('*, passengers(*)')
        .eq('id', selectedBooking.id).single(),
      supabase.from('pilot_slots').select('slot_date, slot_time')
        .eq('id', editData.pilot_slot_id).single(),
    ])
    setSelectedBooking({ ...updated, pilot_slots: newSlot })
    setEditMode(false)
    const newDate = editData.slot_date
    if (newDate && newDate !== selectedDate) {
      setSelectedDate(newDate)
      setWeekStart(getWeekStart(newDate))
    } else {
      loadDay(selectedDate, true)
      loadPlanning(selectedDate)
      loadWeek(weekStart)
    }
  }

  function changeDate(delta) {
    const d = new Date((selectedDate || TODAY) + 'T00:00:00')
    d.setDate(d.getDate() + delta)
    setSelectedDate(toLocalDateStr(d))
  }

  function changeWeek(delta) {
    // Always jump by 7 days to stay Monday-anchored
    const d = new Date(weekStart + 'T00:00:00')
    d.setDate(d.getDate() + delta * 7)
    setWeekStart(toLocalDateStr(d))
  }

  // 14-day strip: always anchored to TODAY
  const planningDays = getDayRange(TODAY, 14)

  function formatDayLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00')
    return {
      day: d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''),
      num: d.getDate(),
    }
  }

  // ── Week view helpers ─────────────────────────────────────────────────────

  // Get the status colour class for a slot in the week view
  function slotWeekStatus(slot, bookingsForSlot) {
    const active = bookingsForSlot.filter(b => b.status === 'pending' || b.status === 'confirmed')
    if (active.some(b => b.status === 'pending'))   return 'week-slot--pending'
    if (active.some(b => b.status === 'confirmed')) return 'week-slot--confirmed'
    if (!slot.is_available)                          return 'week-slot--unavailable'
    return 'week-slot--free'
  }

  // Label shown inside a week slot block
  function slotWeekLabel(slot, bookingsForSlot) {
    const active = bookingsForSlot.filter(b => b.status === 'pending' || b.status === 'confirmed')
    if (active.length === 0) return { name: null, pax: null }
    // Show first booking's client name + total pax
    const first    = active[0]
    const totalPax = active.reduce((n, b) => n + (b.passengers?.length || 0), 0)
    // Short name for week view — first word only, no "Pour" prefix
    const rawName  = first.contact_name || ''
    const name     = rawName.split(' ')[0] || rawName
    return { name, pax: totalPax }
  }

  const weekDays = getDayRange(weekStart, WEEK_DAYS_COUNT)

  // Week range label: "20 – 24 oct. 2026"
  function weekRangeLabel() {
    const start = new Date(weekStart + 'T00:00:00')
    const end   = new Date(weekStart + 'T00:00:00')
    end.setDate(end.getDate() + WEEK_DAYS_COUNT - 1)
    const opts = { day: 'numeric' }
    const optsEnd = { day: 'numeric', month: 'short', year: 'numeric' }
    return `${start.toLocaleDateString('fr-FR', opts)} – ${end.toLocaleDateString('fr-FR', optsEnd)}`
  }

  if (selectedDate === null) return <p className="loading">Chargement...</p>

  return (
    <div className="dashboard">

      {/* ── Side menu overlay ── */}
      {menuOpen && (
        <div onClick={() => setMenuOpen(false)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:200 }} />
      )}

      {/* ── Side menu drawer ── */}
      <div style={{
        position:'fixed', top:0, left:0, bottom:0, width:260,
        background:'#1e293b', color:'white', zIndex:201,
        transform: menuOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition:'transform 0.25s ease',
        display:'flex', flexDirection:'column',
        boxShadow: menuOpen ? '6px 0 32px rgba(0,0,0,0.5)' : 'none',
      }}>
        {/* Logo + fermer */}
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 16px 12px', borderBottom:'1px solid rgba(255,255,255,0.1)' }}>
          <img src="/logo.png" alt="Logo" style={{ height:32, filter:'invert(1)' }} />
          <span style={{ flex:1, fontSize:'0.95rem', fontWeight:700, letterSpacing:'0.03em', color:'#e2e8f0' }}>DISPO / PAS DISPO</span>
          <button onClick={() => setMenuOpen(false)} style={{ background:'none', border:'none', color:'#94a3b8', fontSize:20, cursor:'pointer' }}>✕</button>
        </div>
        <div style={{ padding:'8px 16px 10px', fontSize:'0.8rem', color:'#64748b', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
          🪂 {pilot.name}
        </div>

        <nav style={{ flex:1, paddingTop:6 }}>
          <MenuLink icon="📅" label="Planning"      onClick={() => setMenuOpen(false)} />
          <MenuLink icon="👥" label="Collègues"     onClick={() => { setMenuOpen(false); setColleaguePanelOpen(true) }} />
          <MenuLink icon="💬" label="Messages"      onClick={() => { setMenuOpen(false); setShowMessages(true); markMessagesRead() }} extra={unreadCount > 0 ? unreadCount : null} />
          <div style={{ margin:'6px 16px', height:1, background:'rgba(255,255,255,0.07)' }} />
          <MenuLink icon="💰" label="Rapport pilotes" onClick={() => { setMenuOpen(false); setShowPilotReport(true); loadPilotReport(reportMonth) }} />
          <MenuLink icon="📋" label="Historique"    onClick={() => { setMenuOpen(false); setShowHistory(true) }} />
          <MenuLink icon="🧾" label="Comptabilité"  onClick={() => { setMenuOpen(false); setShowComptabilite(true) }} />
          <MenuLink icon="☁️" label="Météo"         disabled />
        </nav>

        <div style={{ padding:'0 16px 16px', display:'flex', flexDirection:'column', gap:8 }}>
          {/* Bouton mise à jour — visible uniquement quand une nouvelle version est prête */}
          {updateReady && (
            <button
              onClick={() => window.location.reload()}
              style={{ width:'100%', padding:'10px', background:'rgba(234,179,8,0.15)', border:'1px solid rgba(234,179,8,0.4)', borderRadius:8, color:'#fde047', fontSize:'0.88rem', cursor:'pointer', fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}
            >
              🔄 Mettre à jour l'app
            </button>
          )}
          <button onClick={() => supabase.auth.signOut()}
            style={{ width:'100%', padding:'10px', background:'rgba(239,68,68,0.15)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:8, color:'#fca5a5', fontSize:'0.88rem', cursor:'pointer', fontWeight:600 }}>
            Déconnexion
          </button>
        </div>
      </div>

      {/* ── Header ── logo (= menu) à gauche, toggle vue au centre */}
      <header style={{ display:'flex', alignItems:'center', padding:'6px 12px', borderBottom:'1px solid #1e293b', background:'#000', position:'sticky', top:0, zIndex:10, gap:10 }}>
        {/* Bouton logo → ouvre le menu (badge jaune si mise à jour dispo) */}
        <button onClick={() => setMenuOpen(true)}
          style={{ background:'none', border:'none', cursor:'pointer', padding:2, flexShrink:0, position:'relative' }}>
          <img src="/logo-icon.png" alt="Menu" style={{ height:36, display:'block' }} />
          {updateReady && (
            <span style={{ position:'absolute', top:0, right:0, width:10, height:10, background:'#eab308', borderRadius:'50%', border:'2px solid white' }} />
          )}
        </button>

        {/* Toggle Semaine / Jour / Pilotes — prend l'espace restant */}
        <div style={{ display:'flex', gap:5, flex:1, justifyContent:'center' }}>
          <button
            style={{ flex:1, maxWidth:95, padding:'7px 6px', fontSize:'0.78rem', border:'none', borderRadius:8, cursor:'pointer', fontWeight:700, fontFamily:'inherit', background: viewMode==='week' ? '#fff' : '#222', color: viewMode==='week' ? '#000' : '#94a3b8', transition:'background 0.15s, color 0.15s' }}
            onClick={() => setViewMode('week')}>
            📅 Semaine
          </button>
          <button
            style={{ flex:1, maxWidth:95, padding:'7px 6px', fontSize:'0.78rem', border:'none', borderRadius:8, cursor:'pointer', fontWeight:700, fontFamily:'inherit', background: viewMode==='day' ? '#fff' : '#222', color: viewMode==='day' ? '#000' : '#94a3b8', transition:'background 0.15s, color 0.15s' }}
            onClick={() => { setViewMode('day'); loadDay(selectedDate); loadPlanning(selectedDate) }}>
            📋 Jour
          </button>
          <button
            style={{ flex:1, maxWidth:95, padding:'7px 6px', fontSize:'0.78rem', border:'none', borderRadius:8, cursor:'pointer', fontWeight:700, fontFamily:'inherit', background: viewMode==='pilots' ? '#fff' : '#222', color: viewMode==='pilots' ? '#000' : '#94a3b8', transition:'background 0.15s, color 0.15s' }}
            onClick={() => setViewMode('pilots')}>
            🧑‍✈️ Pilotes
          </button>
        </div>

        {/* Bouton Paramètres */}
        <button
          onClick={() => setShowSettings(true)}
          style={{ background:'none', border:'none', cursor:'pointer', padding:'4px 6px', flexShrink:0, fontSize:22, lineHeight:1 }}
          aria-label="Paramètres"
          title="Paramètres"
        >⚙️</button>
      </header>

      {/* Page Paramètres — overlay plein écran */}
      {showSettings && (
        <div style={{ position:'fixed', inset:0, zIndex:200, overflowY:'auto' }}>
          <Settings onBack={() => setShowSettings(false)} pilot={pilot} />
        </div>
      )}

      {/* Page Historique — overlay plein écran */}
      {showHistory && (
        <div style={{ position:'fixed', inset:0, zIndex:200, overflowY:'auto' }}>
          <History pilot={pilot} onBack={() => setShowHistory(false)} />
        </div>
      )}

      {/* ── Comptabilité — overlay plein écran ────────────────────────────────── */}
      {showComptabilite && (
        <div style={{ position:'fixed', inset:0, zIndex:200, overflowY:'auto' }}>
          <div style={{ maxWidth:480, margin:'0 auto', padding:'0 0 40px', position:'relative' }}>
            <button
              onClick={() => setShowComptabilite(false)}
              style={{
                position:'sticky', top:0, zIndex:10,
                display:'flex', alignItems:'center', gap:6,
                background:'#1e293b', border:'none', borderBottom:'1px solid #334155',
                color:'#94a3b8', fontSize:14, cursor:'pointer', padding:'14px 16px',
                width:'100%', fontFamily:'inherit',
              }}>
              ← Retour
            </button>
            <Comptabilite pilot={pilot} flightTypes={flightTypes} />
          </div>
        </div>
      )}

      {/* Messages des collègues — overlay plein écran */}
      {showMessages && (
        <div style={{ position:'fixed', inset:0, zIndex:200, background:'#0f172a', overflowY:'auto' }}>
          <div style={{ maxWidth:480, margin:'0 auto', padding:'0 0 40px' }}>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', gap:12, padding:'16px 16px 12px', borderBottom:'1px solid #1e293b', position:'sticky', top:0, background:'#0f172a', zIndex:1 }}>
              <button onClick={() => setShowMessages(false)} style={{ background:'none', border:'none', color:'#94a3b8', fontSize:22, cursor:'pointer', padding:'0 4px', lineHeight:1 }}>←</button>
              <h2 style={{ flex:1, margin:0, fontSize:16, fontWeight:800, color:'#f1f5f9' }}>Messages des collègues</h2>
              {unreadCount > 0 && <span style={{ background:'#22c55e', color:'#fff', borderRadius:10, padding:'2px 8px', fontSize:12, fontWeight:700 }}>{unreadCount} non lu{unreadCount > 1 ? 's' : ''}</span>}
            </div>
            {/* Liste */}
            {messages.length === 0 ? (
              <p style={{ color:'#475569', textAlign:'center', marginTop:60, fontSize:14 }}>Aucun message pour l'instant.</p>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
                {messages.map(msg => {
                  const d = new Date(msg.created_at)
                  const dateStr = d.toLocaleDateString('fr-FR', { weekday:'short', day:'numeric', month:'short' })
                  const timeStr = d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' })
                  return (
                    <div key={msg.id} style={{
                      padding:'14px 16px',
                      borderBottom:'1px solid #1e293b',
                      background: msg.read_at ? 'transparent' : 'rgba(34,197,94,0.05)',
                    }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                        <span style={{ fontWeight:700, fontSize:14, color:'#e2e8f0' }}>{msg.colleague_name}</span>
                        <span style={{ fontSize:11, color:'#475569' }}>{dateStr} · {timeStr}</span>
                      </div>
                      <p style={{ margin:0, fontSize:14, color: msg.read_at ? '#94a3b8' : '#cbd5e1', lineHeight:1.5 }}>{msg.body}</p>
                      {!msg.read_at && <span style={{ display:'inline-block', marginTop:6, fontSize:10, color:'#22c55e', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase' }}>● Nouveau</span>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Rapport pilotes — overlay plein écran ────────────────────────────── */}
      {showPilotReport && (
        <div style={{ position:'fixed', inset:0, zIndex:200, background:'#0f172a', overflowY:'auto' }}>
          <div style={{ maxWidth:480, margin:'0 auto', padding:'0 0 60px' }}>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', gap:12, padding:'16px 16px 12px', borderBottom:'1px solid #1e293b', position:'sticky', top:0, background:'#0f172a', zIndex:1 }}>
              <button onClick={() => setShowPilotReport(false)} style={{ background:'none', border:'none', color:'#94a3b8', fontSize:22, cursor:'pointer', padding:'0 4px', lineHeight:1 }}>←</button>
              <h2 style={{ flex:1, margin:0, fontSize:16, fontWeight:800, color:'#f1f5f9' }}>Rapport pilotes</h2>
            </div>

            {/* Month picker */}
            <div style={{ padding:'12px 16px', display:'flex', alignItems:'center', gap:10, borderBottom:'1px solid #1e293b' }}>
              <label style={{ fontSize:12, color:'#64748b', fontWeight:700, textTransform:'uppercase', letterSpacing:'.5px' }}>Mois</label>
              <input type="month" value={reportMonth}
                style={{ flex:1, background:'#1e293b', border:'1px solid #334155', borderRadius:8, padding:'6px 10px', color:'#e2e8f0', fontSize:14 }}
                onChange={e => { setReportMonth(e.target.value); loadPilotReport(e.target.value) }} />
            </div>

            {reportLoading && <p style={{ color:'#475569', textAlign:'center', marginTop:40, fontSize:14 }}>Chargement…</p>}

            {!reportLoading && reportData.length === 0 && (
              <p style={{ color:'#475569', textAlign:'center', marginTop:60, fontSize:14 }}>Aucun vol clôturé ce mois.</p>
            )}

            {!reportLoading && reportData.length > 0 && (() => {
              // Group by pilot name
              const byPilot = {}
              reportData.forEach(bk => {
                const name = bk.flew_pilot_name || '—'
                if (!byPilot[name]) byPilot[name] = []
                byPilot[name].push(bk)
              })
              const pilotNames = Object.keys(byPilot).sort()

              return (
                <div style={{ padding:'0 16px' }}>
                  {pilotNames.map(name => {
                    const flights = byPilot[name]
                    const totalEur = flights.reduce((sum, bk) => {
                      return sum + (bk.passengers || []).reduce((s, p) => {
                        const ft = flightTypes.find(t => t.id === p.flight_type)
                        return s + (ft?.price_eur || 0)
                      }, 0)
                    }, 0)

                    return (
                      <div key={name} style={{ marginTop:20 }}>
                        {/* Pilot header */}
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                          <span style={{ fontWeight:800, fontSize:15, color: name === 'Capitaine' ? '#38bdf8' : '#e2e8f0' }}>
                            {name === 'Capitaine' ? '✈️ Capitaine (toi)' : `🧑‍✈️ ${name}`}
                          </span>
                          {name !== 'Capitaine' && (
                            <span style={{ fontWeight:700, fontSize:14, color:'#4ade80' }}>
                              Total dû : {totalEur.toFixed(2).replace('.', ',')} €
                            </span>
                          )}
                        </div>
                        {/* Flight rows */}
                        {flights.map((bk, idx) => {
                          const slotDate = bk.pilot_slots?.slot_date || ''
                          const dateFr   = slotDate ? new Date(slotDate + 'T00:00:00').toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' }) : '—'
                          const paxCount = bk.passengers?.length || 0
                          const bkTotal  = (bk.passengers || []).reduce((s, p) => {
                            const ft = flightTypes.find(t => t.id === p.flight_type)
                            return s + (ft?.price_eur || 0)
                          }, 0)
                          const payIcon = { card:'💳', cash:'💶', wero:'📲' }[bk.payment_method] || '—'
                          return (
                            <div key={bk.id || idx} style={{
                              display:'flex', alignItems:'center', justifyContent:'space-between',
                              padding:'10px 12px', marginBottom:4,
                              background:'#111827', borderRadius:8, border:'1px solid #1e293b',
                            }}>
                              <div>
                                <div style={{ fontSize:13, fontWeight:700, color:'#cbd5e1' }}>{dateFr} · {paxCount} pax</div>
                                <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>
                                  {(bk.passengers || []).map(p => {
                                    const ft = flightTypes.find(t => t.id === p.flight_type)
                                    return ft?.label || p.flight_type
                                  }).join(', ')}
                                </div>
                              </div>
                              <div style={{ textAlign:'right' }}>
                                <div style={{ fontSize:13, fontWeight:700, color:'#e2e8f0' }}>{bkTotal.toFixed(2).replace('.', ',')} €</div>
                                <div style={{ fontSize:11, color:'#64748b' }}>{payIcon}</div>
                              </div>
                            </div>
                          )
                        })}
                        {/* Pilot subtotal */}
                        <div style={{ display:'flex', justifyContent:'flex-end', padding:'4px 0 12px', borderBottom:'1px solid #1e293b' }}>
                          <span style={{ fontSize:12, color:'#64748b' }}>
                            {flights.length} vol{flights.length > 1 ? 's' : ''} · {flights.reduce((n,b) => n + (b.passengers?.length||0), 0)} pax total
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* AssignColleague drawer — shown over booking detail */}
      {showAssign && selectedBooking && (
        <AssignColleague
          booking={selectedBooking}
          pilot={pilot}
          slotDate={selectedBooking.pilot_slots?.slot_date || selectedDate}
          slotTime={selectedBooking.pilot_slots?.slot_time}
          onClose={() => setShowAssign(false)}
          onAssigned={() => {
            // Reload assignments shown in the booking detail panel
            if (selectedBooking) {
              supabase
                .from('booking_assignments')
                .select('*, colleagues(name, phone)')
                .eq('booking_id', selectedBooking.id)
                .order('created_at')
                .then(({ data }) => setBookingAssignments(data || []))
            }
            loadWeek(weekStart)
          }}
        />
      )}

      {/* ── Picker pilotes fixes (depuis "Pas de pilote") ─────────────────── */}
      {fixedPilotPicker && (() => {
        const fixedPilots = colleagues.filter(c => c.is_direct && c.is_fixed)
        const d = new Date((fixedPilotPicker.date || '') + 'T00:00:00')
        const days = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi']
        const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
        const slotLabel = fixedPilotPicker.date
          ? `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}${fixedPilotPicker.time ? ' à ' + fixedPilotPicker.time.slice(0,5) : ''}`
          : 'ce créneau'

        async function assignFixed(colleague) {
          // Remove any existing accepted assignment for this booking before inserting
          await supabase
            .from('booking_assignments')
            .delete()
            .eq('booking_id', fixedPilotPicker.bookingId)
            .eq('pilot_id', pilot.id)
            .eq('status', 'accepted')

          // Insert a booking_assignment with status 'accepted' directly
          const { error } = await supabase
            .from('booking_assignments')
            .insert({
              booking_id:   fixedPilotPicker.bookingId,
              colleague_id: colleague.id,
              pilot_id:     pilot.id,
              status:       'accepted',
            })
          if (error) { alert('Erreur lors de l\'assignation.'); return }
          setFixedPilotPicker(null)
          loadWeek(weekStart)
        }

        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
            onClick={e => { if (e.target === e.currentTarget) setFixedPilotPicker(null) }}
          >
            <div style={{ background: '#0f172a', borderRadius: '20px 20px 0 0', padding: '20px 20px env(safe-area-inset-bottom, 20px)', width: '100%', maxWidth: 480 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <h3 style={{ margin: 0, color: '#f1f5f9', fontSize: 16, fontWeight: 700 }}>⭐ Assigner un pilote fixe</h3>
                <button onClick={() => setFixedPilotPicker(null)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 22, cursor: 'pointer' }}>×</button>
              </div>
              <p style={{ color: '#64748b', fontSize: 13, marginTop: 0, marginBottom: 16 }}>📅 {slotLabel}</p>

              {fixedPilots.map(fp => (
                <button
                  key={fp.id}
                  onClick={() => assignFixed(fp)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: '#1c1a0e', border: '1px solid #78350f55', borderRadius: 10, padding: '13px 16px', marginBottom: 8, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <span style={{ fontWeight: 700, color: '#fcd34d', fontSize: 15 }}>⭐ {fp.name}</span>
                </button>
              ))}

              {/* Option : ouvrir le panneau complet pour envoyer un SMS */}
              <button
                onClick={() => {
                  setFixedPilotPicker(null)
                  setColleagueRequestSlot({ date: fixedPilotPicker.date, time: fixedPilotPicker.time, bookingId: fixedPilotPicker.bookingId })
                  setColleaguePanelOpen(true)
                }}
                style={{ width: '100%', marginTop: 6, padding: '11px', background: 'transparent', color: '#64748b', border: '1px solid #334155', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                💬 Envoyer un SMS à un collègue
              </button>
            </div>
          </div>
        )
      })()}

      {/* ColleaguePanel — déclenché uniquement depuis le menu */}
      <ColleaguePanel
        pilot={pilot}
        forceOpen={colleaguePanelOpen}
        requestSlot={colleagueRequestSlot}
        onClose={() => { setColleaguePanelOpen(false); setColleagueRequestSlot(null) }}
      />

      {/* ── Pending alert ── */}
      {pendingAll.length > 0 && (() => {
        // Sort pending dates and navigate to the first one by default
        const sortedDates = Object.keys(pendingByDate).sort()
        const firstDate   = sortedDates[0]
        function goToDate(date) {
          setSelectedDate(date)
          setViewMode('day')
          loadDay(date)
          loadPlanning(date)
          window.scrollTo(0, 0)
        }
        return (
          <div className="pending-alert" style={{ cursor: 'pointer' }}
            onClick={() => firstDate && goToDate(firstDate)}>
            <div className="pending-alert-title">
              🔔 {pendingAll.length} demande{pendingAll.length > 1 ? 's' : ''} en attente — appuyer pour voir
            </div>
            {sortedDates.map(date => {
              const bks = pendingByDate[date]
              return (
                <div key={date} className="pending-alert-date"
                  onClick={e => { e.stopPropagation(); goToDate(date) }}>
                  <span className="pending-date-label">
                    {new Date(date + 'T00:00:00').toLocaleDateString('fr-FR', {
                      weekday: 'short', day: 'numeric', month: 'short'
                    })}
                  </span>
                  <span className="pending-date-count">
                    {bks.length} demande{bks.length > 1 ? 's' : ''} →
                  </span>
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* ══════════════════════════════════════════════════════════════════════
          WEEK VIEW
         ══════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'week' && (
        <div className="week-view">
          {/* Week navigation */}
          <div className="week-nav">
            <button className="btn-ghost" onClick={() => changeWeek(-1)}>‹ Préc.</button>
            <span className="week-nav-label">{weekRangeLabel()}</span>
            <button className="btn-ghost" onClick={() => changeWeek(1)}>Suiv. ›</button>
          </div>

          {weekLoading ? <p className="loading">Chargement...</p> : (
            /* Full-width grid — no horizontal scroll */
            <div>
            <div className="cal-container" style={{ minWidth: 0 }}>

              {/* ── Day header row ── */}
              <div className="cal-header-row" style={{ display:'flex', borderBottom:'2px solid #1e293b', background:'#0f172a' }}>
                <div className="cal-gutter" style={{ width:40, flexShrink:0, borderRight:'1px solid #cbd5e0' }} />
                {weekDays.map((date, colIdx) => {
                  const d   = new Date(date + 'T00:00:00')
                  const num = d.getDate()
                  const isToday = date === TODAY
                  return (
                    <div key={date}
                      className={`cal-day-header ${isToday ? 'cal-day-header--today' : ''}`}
                      style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', alignItems:'center', padding:'6px 2px', borderRight:'1px solid #1e293b', cursor:'pointer', background: isToday ? '#172554' : undefined, position:'relative' }}
                      onClick={() => {
                        if (selectMode) {
                          // Toggle all slots for this day
                          const daySlots = weekData[date]?.slots || []
                          const dayIds   = daySlots.map(s => s.id)
                          const allSelected = dayIds.every(id => selectedSlotIds.has(id))
                          setSelectedSlotIds(prev => {
                            const next = new Set(prev)
                            if (allSelected) dayIds.forEach(id => next.delete(id))
                            else             dayIds.forEach(id => next.add(id))
                            return next
                          })
                          return
                        }
                        setSelectedDate(date); setViewMode('day'); loadDay(date)
                      }}>
                      <span className="cal-day-name" style={{ fontSize:'0.6rem', fontWeight:800, textTransform:'uppercase', color:'#94a3b8' }}>{DAY_LABELS[colIdx]}</span>
                      <span className={`cal-day-num ${isToday ? 'cal-day-num--today' : ''}`} style={{ fontSize:'1rem', fontWeight:800, width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:'50%', background: isToday ? '#3b82f6' : undefined, color: isToday ? 'white' : '#e2e8f0' }}>{num}</span>
                      {/* Select-mode: day checkbox */}
                      {selectMode && (() => {
                        const daySlots  = weekData[date]?.slots || []
                        const dayIds    = daySlots.map(s => s.id)
                        const allSel    = dayIds.length > 0 && dayIds.every(id => selectedSlotIds.has(id))
                        const someSel   = dayIds.some(id => selectedSlotIds.has(id))
                        return (
                          <div style={{
                            position:'absolute', top:4, right:4,
                            width:14, height:14, borderRadius:3,
                            background: allSel ? '#3b82f6' : someSel ? '#60a5fa' : 'rgba(255,255,255,0.1)',
                            border:`2px solid ${allSel || someSel ? '#93c5fd' : 'rgba(255,255,255,0.35)'}`,
                            display:'flex', alignItems:'center', justifyContent:'center',
                            fontSize:9, color:'white', fontWeight:900, pointerEvents:'none',
                          }}>
                            {allSel ? '✓' : someSel ? '–' : ''}
                          </div>
                        )
                      })()}
                    </div>
                  )
                })}
              </div>

              {/* ── Grid body (scrollable vertically) ── */}
              <div className="cal-body" style={{ display:'flex', overflowY:'auto', maxHeight:'58vh' }}>

                {/* Time axis */}
                <div className="cal-time-axis" style={{ width:40, flexShrink:0, borderRight:'1px solid #1e293b' }}>
                  {GRID_HOURS.map(h => (
                    <div key={h} className="cal-hour-label"
                      style={{ height: HOUR_HEIGHT, lineHeight: `${HOUR_HEIGHT}px`, fontSize:'0.62rem', color:'#64748b', fontWeight:700, textAlign:'right', paddingRight:4, boxSizing:'border-box' }}>
                      {`${String(h).padStart(2, '0')}h`}
                    </div>
                  ))}
                </div>

                {/* Day columns */}
                {weekDays.map((date) => {
                  const { slots: daySlots = [], bookings: dayBookings = [] } = weekData[date] || {}
                  const bkBySlot = dayBookings.reduce((acc, b) => {
                    acc[b.pilot_slot_id] = acc[b.pilot_slot_id] || []
                    acc[b.pilot_slot_id].push(b)
                    return acc
                  }, {})
                  const isToday = date === TODAY

                  return (
                    <div key={date}
                      className={`cal-day-col ${isToday ? 'cal-day-col--today' : ''}`}
                      style={{ flex:1, minWidth:0, position:'relative', borderRight:'1px solid #1e293b', minHeight: HOUR_HEIGHT * (GRID_END_H - GRID_START_H), background: isToday ? '#0c1a2e' : '#050a12' }}>

                      {/* Subtle hour lines only (no half-hour noise) */}
                      {GRID_HOURS.map((h, i) => (
                        <div key={h} style={{ position:'absolute', left:0, right:0, top: i * HOUR_HEIGHT, height:1, background:'#1e293b', pointerEvents:'none' }} />
                      ))}

                      {/* Slot blocks */}
                      {daySlots.map(slot => {
                        // Skip slots outside the visible grid range
                        const slotMin = timeToMinutes(slot.slot_time)
                        if (slotMin < GRID_START_H * 60 || slotMin >= GRID_END_H * 60) return null

                        const bks           = bkBySlot[slot.id] || []
                        const status        = slotWeekStatus(slot, bks)
                        const { name, pax } = slotWeekLabel(slot, bks)
                        const firstActive   = bks.find(b => b.status === 'pending' || b.status === 'confirmed')
                        const activeBks     = bks.filter(b => b.status === 'pending' || b.status === 'confirmed')
                        const totalPaxW     = activeBks.reduce((n, b) => n + (b.passengers?.length || 0), 0)
                        const remainingW    = (slot.capacity || 4) - totalPaxW
                        const top           = slotTop(slot.slot_time)
                        const height        = slotHeightPx() - 8
                        const endTime       = slotEndTime(slot.slot_time)

                        // Slot colours (priority order):
                        // 🔴 Red    = needs a colleague (>1 pax, no assignment) OR colleague refused
                        // 🟠 Orange = waiting for colleague reply (pending)
                        // 🟢 Green  = confirmed
                        // 🟡 Yellow = booking pending pilot confirmation
                        // ⬜ Grey   = slot unavailable
                        // 🔵 Blue   = available slot (no booking)
                        const hasPendingAssignment  = activeBks.some(b => b._hasPendingAssignment)
                        const hasRefusedAssignment  = activeBks.some(b => b._hasRefusedAssignment)
                        // Needs a colleague when:
                        // - Single booking: total pax > 1 and no colleague assigned yet
                        // - Multiple bookings: each booking needs its own pilot (Capitaine covers only one),
                        //   so any booking without an accepted colleague is missing a pilot
                        // Fixed pilots — all sorted by rank (for the dot row display)
                        const fixedPilotsAvail = colleagues
                          .filter(c => c.is_direct && c.is_fixed)
                          .sort((a, b) => (a.fixed_order ?? 99) - (b.fixed_order ?? 99))
                        // Fixed pilots available for this slot, excluding the main pilot himself.
                        // fixedPilotsAvail is sorted by fixed_order; index 0 = pilot himself
                        // (consistent with fetchAndAutoAssign which does fixedPilots.slice(1))
                        const fixedPilotsPresent = fixedPilotsAvail
                          .slice(1)
                          .filter(c => !isColleagueUnavailable(c.id, slot.slot_date, slot.slot_time))

                        let needsColleague
                        if (activeBks.length > 1) {
                          // Multi-booking slot: check each booking individually
                          needsColleague = activeBks.some(b => {
                            const bPax = b.passengers?.length || 1
                            const pilotsNeeded = bPax - 1  // pilot himself covers pax 1
                            return fixedPilotsPresent.length < pilotsNeeded && !b._hasPendingAssignment
                          })
                        } else {
                          const bPax = activeBks[0]?.passengers?.length || totalPaxW
                          const pilotsNeeded = bPax - 1
                          needsColleague = totalPaxW > 1
                            && fixedPilotsPresent.length < pilotsNeeded
                            && !hasPendingAssignment
                        }
                        let wBg, wColor, wBorder
                        if (hasRefusedAssignment || needsColleague) {
                          wBg = '#dc2626'; wColor = 'white'; wBorder = '#991b1b' // red = needs replacement / no colleague yet
                        } else if (hasPendingAssignment) {
                          wBg = '#ea580c'; wColor = 'white'; wBorder = '#9a3412' // orange = waiting for reply
                        } else if (activeBks.some(b => b.status === 'confirmed')) {
                          wBg = '#16a34a'; wColor = 'white'; wBorder = '#166534'
                        } else if (activeBks.some(b => b.status === 'pending')) {
                          wBg = '#f59e0b'; wColor = 'white'; wBorder = '#b45309'
                        } else if (!slot.is_available) {
                          wBg = '#94a3b8'; wColor = 'white'; wBorder = '#475569'
                        } else {
                          wBg = '#3b82f6'; wColor = 'white'; wBorder = '#1d4ed8'
                        }

                        return (
                          <div key={slot.id}
                            className={status}
                            style={{ position:'absolute', left:4, right:4, top, height, borderRadius:8, background:wBg, borderLeft:`4px solid ${wBorder}`, color:wColor, display:'flex', flexDirection:'column', overflow:'hidden', cursor:'pointer', boxShadow:'0 2px 8px rgba(0,0,0,0.28)' }}
                            onClick={() => {
                              if (selectMode) {
                                // Toggle slot selection
                                setSelectedSlotIds(prev => {
                                  const next = new Set(prev)
                                  if (next.has(slot.id)) next.delete(slot.id)
                                  else next.add(slot.id)
                                  return next
                                })
                                return
                              }
                              if (!slot.is_available && activeBks.length === 0) {
                                // Closed slot — open mini modal to reopen
                                setSlotToggleTarget(slot)
                              } else if (activeBks.length > 1) {
                                // Multiple bookings on this slot — show selector
                                setSelectedSlotBookings(activeBks)
                              } else if (firstActive) {
                                setSelectedBooking(firstActive)
                              } else {
                                openNewBooking(slot, date)
                              }
                            }}>
                            {/* Select-mode checkbox overlay */}
                            {selectMode && (
                              <div style={{
                                position:'absolute', top:3, right:3, zIndex:10,
                                width:16, height:16, borderRadius:4,
                                background: selectedSlotIds.has(slot.id) ? '#3b82f6' : 'rgba(255,255,255,0.15)',
                                border: `2px solid ${selectedSlotIds.has(slot.id) ? '#93c5fd' : 'rgba(255,255,255,0.5)'}`,
                                display:'flex', alignItems:'center', justifyContent:'center',
                                fontSize:10, color:'white', fontWeight:900, pointerEvents:'none',
                              }}>
                                {selectedSlotIds.has(slot.id) ? '✓' : ''}
                              </div>
                            )}
                            {/* Row 1: time (left) + "+N" badge (right) in a single flex row */}
                            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'2px 3px 0 4px', minHeight:0 }}>
                              <span style={{ fontSize:'0.55rem', fontWeight:700, opacity:0.85, lineHeight:1 }}>
                                {slot.slot_time.slice(0, 5)}
                              </span>
                              {firstActive && remainingW > 0 && slot.is_available && firstActive.source !== 'colleague' && (
                                <button
                                  style={{
                                    background:'rgba(255,255,255,0.35)', color:'white',
                                    border:'1px solid rgba(255,255,255,0.5)', borderRadius:4,
                                    fontSize:'0.62rem', fontWeight:900,
                                    padding:'0 4px', lineHeight:1.4,
                                    cursor:'pointer', flexShrink:0,
                                  }}
                                  onClick={e => { e.stopPropagation(); openNewBooking(slot, date) }}
                                  title={`${remainingW} place${remainingW > 1 ? 's' : ''} restante${remainingW > 1 ? 's' : ''}`}>
                                  +{remainingW}
                                </button>
                              )}
                            </div>
                            {/* Row 2: passenger name */}
                            {name && (
                              <span style={{ fontSize:'0.65rem', fontWeight:800, padding:'0 4px', lineHeight:1.2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'block' }}>
                                {name}
                              </span>
                            )}
                            {/* Row 3: pax count OR "pas dispo" label */}
                            {pax !== null && (
                              <span style={{ fontSize:'0.6rem', fontWeight:700, padding:'0 4px', opacity:0.85 }}>{pax} pax</span>
                            )}
                            {!slot.is_available && activeBks.length === 0 && (
                              <span style={{ fontSize:'0.58rem', fontWeight:700, padding:'0 4px', opacity:0.8, letterSpacing:'0.04em', textTransform:'uppercase' }}>pas dispo</span>
                            )}
                            {/* Fixed pilots availability row — numbered badges at the bottom */}
                            {fixedPilotsAvail.length > 0 && (
                              <div style={{ display:'flex', gap:2, padding:'1px 3px', marginTop:'auto', flexWrap:'nowrap' }}>
                                {fixedPilotsAvail.map(c => {
                                  const unavail = isColleagueUnavailable(c.id, slot.slot_date, slot.slot_time)
                                  return (
                                    <div key={c.id}
                                      title={unavail ? `${c.name} — indisponible` : `${c.name} — disponible`}
                                      style={{
                                        width: 13, height: 13,
                                        borderRadius: '50%',
                                        background: unavail ? 'transparent' : 'rgba(255,255,255,0.85)',
                                        border: `1px solid ${unavail ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)'}`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: '0.48rem', fontWeight: 900,
                                        color: unavail ? 'transparent' : wBg,
                                        flexShrink: 0,
                                        lineHeight: 1,
                                      }}>
                                      {c.fixed_order}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
            </div>
          )}

          {/* Calendar legend + bulk-select controls */}
          {selectMode ? (
            /* ── Bulk-select action bar ── */
            <div className="week-legend" style={{ gap:6, flexWrap:'wrap' }}>
              <span style={{ color:'#94a3b8', fontSize:'0.78rem', fontWeight:600, marginRight:4 }}>
                {selectedSlotIds.size} créneau{selectedSlotIds.size !== 1 ? 'x' : ''} sélectionné{selectedSlotIds.size !== 1 ? 's' : ''}
              </span>
              <button
                onClick={() => applyBulkAvailability(true)}
                disabled={selectedSlotIds.size === 0}
                style={{ padding:'5px 12px', borderRadius:8, border:'1.5px solid #16a34a', background:'rgba(20,83,45,0.3)', color:'#86efac', fontWeight:700, fontSize:'0.78rem', cursor: selectedSlotIds.size === 0 ? 'not-allowed' : 'pointer', opacity: selectedSlotIds.size === 0 ? 0.5 : 1, fontFamily:'inherit' }}>
                ✓ DISPO
              </button>
              <button
                onClick={() => applyBulkAvailability(false)}
                disabled={selectedSlotIds.size === 0}
                style={{ padding:'5px 12px', borderRadius:8, border:'1.5px solid #dc2626', background:'rgba(127,29,29,0.3)', color:'#fca5a5', fontWeight:700, fontSize:'0.78rem', cursor: selectedSlotIds.size === 0 ? 'not-allowed' : 'pointer', opacity: selectedSlotIds.size === 0 ? 0.5 : 1, fontFamily:'inherit' }}>
                ✗ PAS DISPO
              </button>
              <button
                onClick={deleteBulkSlots}
                disabled={selectedSlotIds.size === 0}
                style={{ padding:'5px 12px', borderRadius:8, border:'1.5px solid #7c3aed', background:'rgba(109,40,217,0.2)', color:'#c4b5fd', fontWeight:700, fontSize:'0.78rem', cursor: selectedSlotIds.size === 0 ? 'not-allowed' : 'pointer', opacity: selectedSlotIds.size === 0 ? 0.5 : 1, fontFamily:'inherit' }}>
                🗑 Supprimer
              </button>
              <button
                onClick={() => { setSelectMode(false); setSelectedSlotIds(new Set()) }}
                style={{ padding:'5px 12px', borderRadius:8, border:'1.5px solid #475569', background:'rgba(71,85,105,0.2)', color:'#94a3b8', fontWeight:700, fontSize:'0.78rem', cursor:'pointer', fontFamily:'inherit' }}>
                Annuler
              </button>
            </div>
          ) : (
            /* ── Normal legend ── */
            <div className="week-legend">
              <span className="legend-item"><span className="legend-dot legend-dot--free" />Libre</span>
              <span className="legend-item"><span className="legend-dot legend-dot--pending" />En attente</span>
              <span className="legend-item"><span className="legend-dot legend-dot--confirmed" />Confirmé</span>
              <span className="legend-item"><span className="legend-dot" style={{ background:'#ea580c' }} />Collègue ?</span>
              <span className="legend-item"><span className="legend-dot" style={{ background:'#dc2626' }} />Pilote manquant</span>
              <button
                onClick={() => setSelectMode(true)}
                style={{ marginLeft:'auto', padding:'4px 10px', borderRadius:8, border:'1.5px solid #475569', background:'rgba(71,85,105,0.15)', color:'#94a3b8', fontWeight:700, fontSize:'0.72rem', cursor:'pointer', fontFamily:'inherit' }}>
                ☐ Sélectionner
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          DAY VIEW
         ══════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'day' && (
        <>
          {/* 14-day planning strip */}
          <div className="planning-strip-wrapper">
            <div className="planning-strip">
              {planningDays.map(date => {
                const { day, num } = formatDayLabel(date)
                const info         = planning[date] || { pending: 0, confirmed: 0 }
                const isSelected   = date === selectedDate
                const isToday      = date === TODAY
                const hasPending   = info.pending > 0
                const hasConfirmed = info.confirmed > 0

                return (
                  <button key={date}
                    className={[
                      'planning-day',
                      isSelected  ? 'planning-day--selected' : '',
                      isToday     ? 'planning-day--today'    : '',
                      hasPending  ? 'planning-day--pending'  : '',
                    ].join(' ')}
                    onClick={() => setSelectedDate(date)}>
                    <span className="planning-day__name">{day}</span>
                    <span className="planning-day__num">{num}</span>
                    <span className="planning-day__dots">
                      {hasPending   && <span className="dot dot--pending"   title="En attente" />}
                      {hasConfirmed && <span className="dot dot--confirmed" title="Confirme" />}
                    </span>
                    {(info.pending + info.confirmed) > 0 && (
                      <span className="planning-day__count">
                        {info.pending + info.confirmed}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Date navigator */}
          <div className="date-bar">
            <button className="btn-ghost" onClick={() => changeDate(-1)}>‹</button>
            <input type="date" value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)} className="date-input" />
            <button className="btn-ghost" onClick={() => changeDate(1)}>›</button>
          </div>

          {/* ── Day calendar grid (Google Agenda style) ── */}
          {loading ? <p className="loading">Chargement...</p> : (
            <div style={{ margin:'8px', border:'1px solid #1e293b', borderRadius:12, overflow:'hidden', background:'#050a12' }}>
              <div style={{ display:'flex', overflowY:'auto', maxHeight:'62vh' }}>

                {/* Time axis */}
                <div style={{ width:44, flexShrink:0, borderRight:'1px solid #1e293b' }}>
                  {GRID_HOURS.map(h => (
                    <div key={h} style={{ height:HOUR_HEIGHT, display:'flex', alignItems:'flex-start', justifyContent:'flex-end', paddingRight:6, paddingTop:3, fontSize:'0.65rem', color:'#475569', fontWeight:600, boxSizing:'border-box' }}>
                      {`${String(h).padStart(2,'0')}:00`}
                    </div>
                  ))}
                </div>

                {/* Single day column */}
                <div style={{ flex:1, position:'relative', minHeight: HOUR_HEIGHT * (GRID_END_H - GRID_START_H) }}>

                  {/* Hour lines */}
                  {GRID_HOURS.map((h, i) => (
                    <div key={h} style={{ position:'absolute', left:0, right:0, top: i * HOUR_HEIGHT, height:1, background:'#1e293b', pointerEvents:'none' }} />
                  ))}
                  {/* Half-hour lines */}
                  {GRID_HOURS.slice(0,-1).map((h, i) => (
                    <div key={`h-${h}`} style={{ position:'absolute', left:0, right:0, top: i * HOUR_HEIGHT + HOUR_HEIGHT/2, height:1, background:'#0f172a', pointerEvents:'none' }} />
                  ))}

                  {/* Slot blocks */}
                  {slots.map(slot => {
                    const slotMin = timeToMinutes(slot.slot_time)
                    if (slotMin < GRID_START_H * 60 || slotMin >= GRID_END_H * 60) return null

                    const slotBookings = bookingsBySlot[slot.id] || []
                    const pendingBks   = slotBookings.filter(b => b.status === 'pending')
                    const confirmedBks = slotBookings.filter(b => b.status === 'confirmed')
                    const firstActive  = [...pendingBks, ...confirmedBks][0]

                    // Remaining capacity: slot.capacity minus all active passengers
                    const activeBks    = [...pendingBks, ...confirmedBks]
                    const totalPax     = activeBks.reduce((n, b) => n + (b.passengers?.length || 0), 0)
                    const remaining    = (slot.capacity || 4) - totalPax

                    const top    = slotTop(slot.slot_time)
                    const height = slotHeightPx() - 3
                    const endT   = slotEndTime(slot.slot_time)

                    // Vivid colours — every slot is a clearly visible rectangle
                    let bg, border, color, label
                    if (confirmedBks.length > 0) {
                      bg = '#16a34a'; border = '#15803d'; color = 'white'; label = 'Confirmé'
                    } else if (pendingBks.length > 0) {
                      bg = '#f59e0b'; border = '#d97706'; color = 'white'; label = 'En attente'
                    } else if (!slot.is_available) {
                      bg = '#94a3b8'; border = '#64748b'; color = 'white'; label = 'Pas dispo'
                    } else {
                      bg = '#3b82f6'; border = '#2563eb'; color = 'white'; label = 'Libre'
                    }

                    const activeBooking = firstActive
                    const timeLabel     = `${slot.slot_time.slice(0,5)} – ${endT}`

                    return (
                      <div key={slot.id}
                        style={{ position:'absolute', left:6, right:6, top, height, borderRadius:8, background:bg, borderLeft:`4px solid ${border}`, color, display:'flex', alignItems:'stretch', overflow:'hidden', cursor:'pointer', boxShadow:'0 1px 3px rgba(0,0,0,0.06)' }}
                        onClick={() => {
                          if (activeBks.length > 1) {
                            setSelectedSlotBookings(activeBks)
                          } else if (activeBooking) {
                            setSelectedBooking(activeBooking)
                          } else {
                            openNewBooking(slot, selectedDate)
                          }
                        }}>

                        {/* Main info */}
                        <div style={{ flex:1, padding:'6px 10px', display:'flex', flexDirection:'column', justifyContent:'center', gap:2 }}>
                          <span style={{ fontSize:'0.7rem', fontWeight:700, opacity:0.75 }}>{timeLabel}</span>
                          {activeBooking ? (
                            <>
                              <span style={{ fontSize:'0.85rem', fontWeight:800, lineHeight:1.2 }}>
                                {activeBooking.source === 'colleague'
                                  ? `Pour ${activeBooking.contact_name}`
                                  : activeBooking.contact_name}
                              </span>
                              <span style={{ fontSize:'0.72rem', fontWeight:600, opacity:0.8 }}>
                                {activeBooking.source === 'colleague'
                                  ? 'Demande collègue'
                                  : `${totalPax} pax · ${remaining} place${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}`}
                              </span>
                            </>
                          ) : (
                            <span style={{ fontSize:'0.78rem', fontWeight:600 }}>{label}</span>
                          )}
                        </div>

                        {/* Add booking button when slot has bookings but capacity remains */}
                        {activeBooking && remaining > 0 && slot.is_available && (
                          <button
                            style={{ alignSelf:'stretch', padding:'0 10px', background:'#3182ce', color:'white', border:'none', fontSize:'1rem', fontWeight:800, cursor:'pointer', borderLeft:'1px solid rgba(255,255,255,0.3)' }}
                            onClick={e => { e.stopPropagation(); openNewBooking(slot, selectedDate) }}
                            title={`Ajouter une réservation (${remaining} place${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''})`}>
                            +
                          </button>
                        )}

                        {/* DISPO toggle on the right (only for non-booked slots) */}
                        {!activeBooking && (
                          <button
                            style={{ alignSelf:'stretch', padding:'0 12px', background: slot.is_available ? '#22c55e' : '#94a3b8', color:'white', border:'none', fontSize:'0.65rem', fontWeight:800, letterSpacing:'0.05em', cursor:'pointer', borderLeft:'1px solid rgba(255,255,255,0.3)', whiteSpace:'nowrap' }}
                            onClick={e => { e.stopPropagation(); toggleAvailability(slot) }}>
                            {slot.is_available ? 'DISPO' : 'PAS\nDISPO'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── New booking modal ── */}
      {newBookingSlot && nbForm && (
        <div className="modal-overlay" onClick={() => { setNewBookingSlot(null); setNbForm(null) }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Nouvelle réservation</h2>
              <button className="btn-ghost" onClick={() => { setNewBookingSlot(null); setNbForm(null) }}>✕</button>
            </div>

            {/* Slot info */}
            <div style={{ background:'#ebf8ff', borderRadius:8, padding:'8px 12px', marginBottom:12, fontSize:'0.82rem', color:'#2b6cb0', fontWeight:600 }}>
              📅 {new Date(newBookingSlot.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' })}
              &nbsp;· {newBookingSlot.slot.slot_time.slice(0,5)} – {slotEndTime(newBookingSlot.slot.slot_time)}
            </div>

            {/* Contact — prénom + nom séparés */}
            <div className="edit-section">
              <div className="field-row" style={{ display:'flex', gap:8 }}>
                <div style={{ flex:1 }}>
                  <label className="edit-label">Prénom *</label>
                  <input className="edit-input" placeholder="Marie" value={nbForm.contactFirstName}
                    onChange={e => setNbForm(f => ({ ...f, contactFirstName: e.target.value }))} />
                </div>
                <div style={{ flex:1 }}>
                  <label className="edit-label">Nom *</label>
                  <input className="edit-input" placeholder="Dupont" value={nbForm.contactLastName}
                    onChange={e => setNbForm(f => ({ ...f, contactLastName: e.target.value }))} />
                </div>
              </div>
              <label className="edit-label">Téléphone *</label>
              <input className="edit-input" type="tel" placeholder="Ex: 0692 12 34 56" value={nbForm.contactPhone}
                onChange={e => setNbForm(f => ({ ...f, contactPhone: e.target.value }))} />

              {/* Quick-fill: 4 compact dropdowns — auto-builds passenger rows */}
              <label className="edit-label">Répartition des vols</label>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:4 }}>
                {/* Personnes */}
                <div>
                  <label className="edit-label" style={{fontSize:11,marginBottom:2}}>Personnes</label>
                  <select className="edit-input" style={{padding:'6px 8px'}} value={nbForm.totalCount}
                    onChange={e => {
                      const total    = parseInt(e.target.value)
                      const children = Math.min(nbForm.childCount, total)
                      const free     = total - children
                      const disco    = Math.min(nbForm.discoveryCount,   free)
                      const perf     = Math.min(nbForm.performanceCount, free - disco)
                      const rows     = []
                      for (let i = 0; i < total; i++) {
                        const prev = nbForm.passengers[i] || {}
                        if (i < children)               rows.push({ firstName: prev.firstName||'', lastName: prev.lastName||'', cat:'under14', vol: 'discovery' })
                        else if (i < children + disco)  rows.push({ firstName: prev.firstName||'', lastName: prev.lastName||'', cat:'under75',  vol: 'discovery' })
                        else if (i < children + disco + perf) rows.push({ firstName: prev.firstName||'', lastName: prev.lastName||'', cat:'under75', vol: 'performance' })
                        else                            rows.push({ firstName: prev.firstName||'', lastName: prev.lastName||'', cat:'under75',  vol: flightTypes[0]?.id||'discovery' })
                      }
                      setNbForm(f => ({ ...f, totalCount: total, childCount: children, discoveryCount: disco, performanceCount: perf, passengers: rows }))
                    }}>
                    {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>

                {/* Marmailles */}
                <div>
                  <label className="edit-label" style={{fontSize:11,marginBottom:2}}>Marmailles</label>
                  <select className="edit-input" style={{padding:'6px 8px'}} value={nbForm.childCount}
                    onChange={e => {
                      const children = parseInt(e.target.value)
                      const free     = nbForm.totalCount - children
                      const disco    = Math.min(nbForm.discoveryCount,   free)
                      const perf     = Math.min(nbForm.performanceCount, free - disco)
                      const rows     = []
                      for (let i = 0; i < nbForm.totalCount; i++) {
                        const prev = nbForm.passengers[i] || {}
                        if (i < children)               rows.push({ firstName: prev.firstName||'', lastName: prev.lastName||'', cat:'under14', vol: 'discovery' })
                        else if (i < children + disco)  rows.push({ firstName: prev.firstName||'', lastName: prev.lastName||'', cat:'under75',  vol: 'discovery' })
                        else if (i < children + disco + perf) rows.push({ firstName: prev.firstName||'', lastName: prev.lastName||'', cat:'under75', vol: 'performance' })
                        else                            rows.push({ firstName: prev.firstName||'', lastName: prev.lastName||'', cat:'under75',  vol: flightTypes[0]?.id||'discovery' })
                      }
                      setNbForm(f => ({ ...f, childCount: children, discoveryCount: disco, performanceCount: perf, passengers: rows }))
                    }}>
                    {Array.from({ length: nbForm.totalCount + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>

                {/* Découverte */}
                <div>
                  <label className="edit-label" style={{fontSize:11,marginBottom:2}}>Découverte</label>
                  <select className="edit-input" style={{padding:'6px 8px'}} value={nbForm.discoveryCount}
                    onChange={e => {
                      const disco    = parseInt(e.target.value)
                      const free     = nbForm.totalCount - nbForm.childCount
                      const perf     = Math.min(nbForm.performanceCount, free - disco)
                      const rows     = []
                      for (let i = 0; i < nbForm.totalCount; i++) {
                        const prev = nbForm.passengers[i] || {}
                        const c = nbForm.childCount
                        if (i < c)              rows.push({ firstName: prev.firstName||'', lastName: prev.lastName||'', cat:'under14', vol: 'discovery' })
                        else if (i < c + disco) rows.push({ firstName: prev.firstName||'', lastName: prev.lastName||'', cat:'under75',  vol: 'discovery' })
                        else if (i < c + disco + perf) rows.push({ firstName: prev.firstName||'', lastName: prev.lastName||'', cat:'under75', vol: 'performance' })
                        else                    rows.push({ firstName: prev.firstName||'', lastName: prev.lastName||'', cat:'under75',  vol: flightTypes[0]?.id||'discovery' })
                      }
                      setNbForm(f => ({ ...f, discoveryCount: disco, performanceCount: perf, passengers: rows }))
                    }}>
                    {Array.from({ length: nbForm.totalCount - nbForm.childCount + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>

                {/* Performance */}
                <div>
                  <label className="edit-label" style={{fontSize:11,marginBottom:2}}>Performance</label>
                  <select className="edit-input" style={{padding:'6px 8px'}} value={nbForm.performanceCount}
                    onChange={e => {
                      const perf  = parseInt(e.target.value)
                      const free  = nbForm.totalCount - nbForm.childCount
                      const disco = Math.min(nbForm.discoveryCount, free - perf)
                      const rows  = []
                      for (let i = 0; i < nbForm.totalCount; i++) {
                        const prev = nbForm.passengers[i] || {}
                        const c = nbForm.childCount
                        if (i < c)               rows.push({ firstName: prev.firstName||'', lastName: prev.lastName||'', cat:'under14', vol: 'discovery' })
                        else if (i < c + disco)  rows.push({ firstName: prev.firstName||'', lastName: prev.lastName||'', cat:'under75',  vol: 'discovery' })
                        else if (i < c + disco + perf) rows.push({ firstName: prev.firstName||'', lastName: prev.lastName||'', cat:'under75', vol: 'performance' })
                        else                     rows.push({ firstName: prev.firstName||'', lastName: prev.lastName||'', cat:'under75',  vol: flightTypes[0]?.id||'discovery' })
                      }
                      setNbForm(f => ({ ...f, performanceCount: perf, discoveryCount: disco, passengers: rows }))
                    }}>
                    {Array.from({ length: nbForm.totalCount - nbForm.childCount + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Passengers — catégorie + vol par personne */}
            <div className="edit-section">
              <div className="edit-section-title">Passagers</div>
              {nbForm.passengers.map((p, i) => {
                const isChild = p.cat === 'under14'
                const updatePax = (fields) => setNbForm(f => ({
                  ...f,
                  passengers: f.passengers.map((px, idx) => idx === i ? { ...px, ...fields } : px)
                }))
                return (
                  <div key={i} className="modal-pax-card" style={{ position:'relative' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                      <div className="modal-pax-name">Passager {i + 1}</div>
                      {nbForm.passengers.length > 1 && (
                        <button className="btn-ghost-small"
                          onClick={() => setNbForm(f => ({ ...f, passengers: f.passengers.filter((_, idx) => idx !== i) }))}>✕</button>
                      )}
                    </div>
                    {/* Prénom + Nom optionnels */}
                    <div className="field-row" style={{ display:'flex', gap:8, marginBottom:8 }}>
                      <div style={{ flex:1 }}>
                        <label className="edit-label">Prénom <span style={{opacity:.5,fontWeight:400}}>(opt.)</span></label>
                        <input className="edit-input" placeholder="Prénom" value={p.firstName}
                          onChange={e => updatePax({ firstName: e.target.value })} />
                      </div>
                      <div style={{ flex:1 }}>
                        <label className="edit-label">Nom <span style={{opacity:.5,fontWeight:400}}>(opt.)</span></label>
                        <input className="edit-input" placeholder="Nom" value={p.lastName}
                          onChange={e => updatePax({ lastName: e.target.value })} />
                      </div>
                    </div>
                    {/* Catégorie uniquement — le vol est déterminé par les compteurs en haut */}
                    <div className="field-row" style={{ display:'flex', gap:8 }}>
                      <div style={{ flex:1 }}>
                        <label className="edit-label">Catégorie</label>
                        <select className="edit-input" value={p.cat}
                          onChange={e => {
                            const newCat = e.target.value
                            // Under-14 → force discovery flight
                            const newVol = newCat === 'under14' ? (flightTypes.find(f => f.id === 'discovery')?.id || flightTypes[0]?.id || 'discovery') : p.vol
                            updatePax({ cat: newCat, vol: newVol })
                          }}>
                          {WEIGHT_CATS.map(c => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ flex:1, display:'flex', alignItems:'flex-end', paddingBottom:2 }}>
                        <span style={{ fontSize:'0.8rem', color:'#64748b', background:'rgba(99,102,241,.08)', borderRadius:6, padding:'6px 10px', width:'100%', textAlign:'center' }}>
                          {flightTypes.find(f => f.id === p.vol)?.label || p.vol}
                        </span>
                      </div>
                    </div>
                    {isChild && (
                      <div style={{ marginTop:6, fontSize:'0.75rem', color:'#f59e0b', background:'rgba(245,158,11,.1)', borderRadius:6, padding:'4px 8px' }}>
                        ⚠ Moins de 14 ans — Découverte obligatoire · créneau 08:00
                      </div>
                    )}
                  </div>
                )
              })}
              {nbForm.passengers.length < 6 && (
                <button className="btn-secondary" style={{ width:'100%', marginTop:8 }}
                  onClick={() => setNbForm(f => ({ ...f, passengers: [...f.passengers, { firstName:'', lastName:'', cat:'under75', vol: flightTypes[0]?.id || 'discovery' }] }))}>
                  + Ajouter un passager
                </button>
              )}
            </div>

            {/* Notes */}
            <div className="edit-section">
              <label className="edit-label">Notes (optionnel)</label>
              <textarea className="edit-input" rows={2} placeholder="Demande spéciale, remarque..." value={nbForm.notes}
                onChange={e => setNbForm(f => ({ ...f, notes: e.target.value }))}
                style={{ resize:'vertical', fontFamily:'inherit', fontSize:'0.85rem' }} />
            </div>

            <div className="booking-actions">
              <button className="btn-confirm" disabled={nbSaving} onClick={submitNewBooking}>
                {nbSaving ? 'Enregistrement...' : '✓ Confirmer la résa'}
              </button>
              <button className="btn-refuse" onClick={() => { setNewBookingSlot(null); setNbForm(null) }}>Annuler</button>
            </div>

            {/* Close slot from new-booking form — available even without a booking */}
            <button
              onClick={() => {
                toggleAvailability(newBookingSlot.slot)
                setNewBookingSlot(null)
                setNbForm(null)
              }}
              style={{
                width:'100%', marginTop:8, padding:'10px 14px',
                background:'rgba(127,29,29,0.2)',
                border:'1.5px solid #dc2626',
                borderRadius:10, cursor:'pointer', fontWeight:700, fontSize:13,
                color:'#fca5a5', fontFamily:'inherit'
              }}>
              🔒 Fermer ce créneau plutôt (PAS DISPO)
            </button>
          </div>
        </div>
      )}

      {/* ── Mini modal: reopen a closed (grey) slot ─────────────────────── */}
      {slotToggleTarget && (
        <div className="modal-overlay" onClick={() => setSlotToggleTarget(null)}>
          <div className="modal" style={{ maxWidth: 340 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ fontSize: '1rem' }}>🔒 Créneau fermé</h2>
              <button className="btn-ghost" onClick={() => setSlotToggleTarget(null)}>✕</button>
            </div>
            <p style={{ color: '#94a3b8', padding: '0 0 20px', fontSize: '0.88rem', lineHeight: 1.5 }}>
              <strong style={{ color: '#e2e8f0' }}>
                {slotToggleTarget.slot_time?.slice(0, 5)}
              </strong>{' '}
              — ce créneau est marqué <strong style={{ color: '#fca5a5' }}>PAS DISPO</strong>.
              <br />Voulez-vous le rouvrir ?
            </p>
            <div className="booking-actions">
              <button
                className="btn-confirm"
                onClick={() => {
                  toggleAvailability(slotToggleTarget)
                  setSlotToggleTarget(null)
                }}>
                🔓 Rouvrir ce créneau
              </button>
              <button className="btn-refuse" onClick={() => setSlotToggleTarget(null)}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Slot multi-booking selector (when a slot has several bookings) ── */}
      {selectedSlotBookings.length > 0 && (
        <div className="modal-overlay" onClick={() => setSelectedSlotBookings([])}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Réservations du créneau</h2>
              <button className="btn-ghost" onClick={() => setSelectedSlotBookings([])}>✕</button>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: '#64748b' }}>
              {selectedSlotBookings.length} réservations sur ce créneau. Choisissez-en une pour voir les détails.
            </p>
            {selectedSlotBookings.map((bk, idx) => {
              const paxCount = bk.passengers?.length || 0
              const statusColors = {
                pending:   { bg: '#78350f', color: '#fde68a', label: '⏳ En attente' },
                confirmed: { bg: '#14532d', color: '#86efac', label: '✅ Confirmé' },
                refused:   { bg: '#450a0a', color: '#fca5a5', label: '❌ Refusé' },
              }
              const sc = statusColors[bk.status] || statusColors.pending
              return (
                <div key={bk.id}
                  onClick={() => { setSelectedSlotBookings([]); setSelectedBooking(bk) }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 14px', marginBottom: 8, borderRadius: 10,
                    background: '#0f172a', border: '1px solid #334155',
                    cursor: 'pointer', gap: 12,
                  }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#e2e8f0', marginBottom: 3 }}>
                      {bk.contact_name || '—'}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                      📞 {bk.contact_phone || '—'}
                    </div>
                    {bk.passengers?.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        {bk.passengers.map((p, i) => (
                          <div key={p.id || i} style={{ fontSize: '0.78rem', color: '#64748b' }}>
                            🪂 {p.first_name || p.last_name ? `${p.first_name} ${p.last_name} — ` : ''}{catLabel(p.weight_kg, p.age)} · {flightTypeLabel(p.flight_type)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{ padding: '3px 8px', borderRadius: 6, background: sc.bg, color: sc.color, fontSize: '0.72rem', fontWeight: 700 }}>
                      {sc.label}
                    </span>
                    {/* Main pilot badge — always show the logged-in pilot's name */}
                    <span style={{ padding: '3px 8px', borderRadius: 6, background: '#1e3a5f', color: '#93c5fd', fontSize: '0.72rem', fontWeight: 700 }}>
                      🪂 {pilot.name}
                    </span>
                    {/* Colleague pilot badge — only for multi-pax bookings */}
                    {paxCount > 1 && (
                      bk._acceptedColleagueName ? (
                        // Clickable green badge to reassign the colleague
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            const slotDate = bk.pilot_slots?.slot_date
                            const slotTime = bk.pilot_slots?.slot_time
                            const fixedPilots = colleagues.filter(c => c.is_direct && c.is_fixed)
                            if (fixedPilots.length > 0) {
                              setFixedPilotPicker({ bookingId: bk.id, date: slotDate, time: slotTime })
                            } else {
                              setColleagueRequestSlot({ date: slotDate, time: slotTime, bookingId: bk.id })
                              setSelectedSlotBookings([])
                              setColleaguePanelOpen(true)
                            }
                          }}
                          style={{ padding: '3px 8px', borderRadius: 6, background: '#14532d', color: '#86efac', fontSize: '0.72rem', fontWeight: 700, border: '1px solid #16a34a55', cursor: 'pointer' }}>
                          ⭐ {bk._acceptedColleagueName}
                        </button>
                      ) : (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            const slotDate = bk.pilot_slots?.slot_date
                            const slotTime = bk.pilot_slots?.slot_time
                            const fixedPilots = colleagues.filter(c => c.is_direct && c.is_fixed)
                            if (fixedPilots.length > 0) {
                              setFixedPilotPicker({ bookingId: bk.id, date: slotDate, time: slotTime })
                            } else {
                              setColleagueRequestSlot({ date: slotDate, time: slotTime, bookingId: bk.id })
                              setSelectedSlotBookings([])
                              setColleaguePanelOpen(true)
                            }
                          }}
                          style={{ padding: '3px 8px', borderRadius: 6, background: '#dc2626', color: 'white', fontSize: '0.72rem', fontWeight: 700, border: 'none', cursor: 'pointer' }}>
                          🚨 Pas de pilote
                        </button>
                      )
                    )}
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {paxCount} pax →
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          PILOTS PLANNING VIEW
         ══════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'pilots' && (() => {
        // All fixed pilots sorted by fixed_order (includes main pilot at order=1)
        const fixedPilots = colleagues
          .filter(c => c.is_direct && c.is_fixed)
          .sort((a, b) => (a.fixed_order ?? 99) - (b.fixed_order ?? 99))

        // Collect all unique slot times across the week
        const slotTimesSet = new Set()
        weekDays.forEach(date => {
          const { slots = [] } = weekData[date] || {}
          slots.forEach(s => { if (s.slot_time) slotTimesSet.add(s.slot_time.slice(0,5)) })
        })
        const slotTimes = Array.from(slotTimesSet).sort()

        return (
          <div style={{ padding:'0 0 40px' }}>
            {/* Navigation semaine */}
            <div className="week-nav">
              <button className="btn-ghost" onClick={() => changeWeek(-1)}>‹ Préc.</button>
              <span className="week-nav-label">{weekRangeLabel()}</span>
              <button className="btn-ghost" onClick={() => changeWeek(1)}>Suiv. ›</button>
            </div>

            {weekLoading ? <p className="loading">Chargement...</p> : (
              <div style={{ overflowX:'auto', WebkitOverflowScrolling:'touch' }}>
                <table style={{
                  width:'100%', borderCollapse:'collapse', fontSize:'0.78rem',
                  minWidth: 320
                }}>
                  <thead>
                    <tr>
                      {/* Pilot name column header */}
                      <th style={{
                        padding:'6px 8px', textAlign:'left', background:'#0f172a',
                        color:'#94a3b8', fontWeight:700, borderBottom:'2px solid #1e293b',
                        position:'sticky', left:0, zIndex:2, minWidth:90
                      }}>Pilote</th>
                      {/* Day columns */}
                      {weekDays.map((date, colIdx) => {
                        const d = new Date(date + 'T00:00:00')
                        const isToday = date === TODAY
                        return (
                          <th key={date} style={{
                            padding:'6px 4px', textAlign:'center', background: isToday ? '#172554' : '#0f172a',
                            color: isToday ? '#93c5fd' : '#94a3b8', fontWeight:700,
                            borderBottom:'2px solid #1e293b', borderLeft:'1px solid #1e293b',
                            minWidth: slotTimes.length > 0 ? Math.max(40, slotTimes.length * 22) : 48
                          }}>
                            <div style={{ fontSize:'0.6rem', textTransform:'uppercase' }}>
                              {DAY_LABELS[colIdx]}
                            </div>
                            <div style={{ fontSize:'0.85rem', fontWeight:800 }}>
                              {d.getDate()}
                            </div>
                          </th>
                        )
                      })}
                    </tr>
                    {/* Sub-header: slot times */}
                    {slotTimes.length > 1 && (
                      <tr>
                        <th style={{
                          padding:'4px 8px', background:'#0f172a', borderBottom:'1px solid #1e293b',
                          position:'sticky', left:0, zIndex:2
                        }} />
                        {weekDays.map(date => (
                          <th key={date} style={{
                            padding:'2px 2px', background:'#0a1020',
                            borderBottom:'1px solid #1e293b', borderLeft:'1px solid #1e293b'
                          }}>
                            <div style={{ display:'flex', justifyContent:'center', gap:2 }}>
                              {slotTimes.map(t => (
                                <span key={t} style={{
                                  fontSize:'0.55rem', color:'#475569', fontWeight:600,
                                  minWidth:18, textAlign:'center'
                                }}>{t}</span>
                              ))}
                            </div>
                          </th>
                        ))}
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {fixedPilots.map((pilot, rowIdx) => {
                      const isMainPilot = pilot.fixed_order === 1
                      return (
                        <tr key={pilot.id} style={{ background: rowIdx % 2 === 0 ? '#0f172a' : '#111827' }}>
                          {/* Pilot name cell */}
                          <td style={{
                            padding:'8px 8px', fontWeight:700, color: isMainPilot ? '#f8fafc' : '#cbd5e1',
                            borderBottom:'1px solid #1e293b', whiteSpace:'nowrap',
                            position:'sticky', left:0, background: rowIdx % 2 === 0 ? '#0f172a' : '#111827',
                            zIndex:1
                          }}>
                            {pilot.name}
                            {isMainPilot && (
                              <span style={{ marginLeft:5, fontSize:'0.6rem', color:'#6366f1', fontWeight:800 }}>MOI</span>
                            )}
                          </td>
                          {/* Day cells */}
                          {weekDays.map(date => {
                            const { slots: daySlots = [] } = weekData[date] || {}
                            const isToday = date === TODAY

                            if (slotTimes.length === 0) {
                              // No slots at all for this day — show neutral cell
                              return (
                                <td key={date} style={{
                                  padding:'6px 4px', textAlign:'center',
                                  borderBottom:'1px solid #1e293b', borderLeft:'1px solid #1e293b',
                                  background: isToday ? '#0d1b3e' : undefined
                                }}>
                                  <span style={{ color:'#334155', fontSize:'0.65rem' }}>—</span>
                                </td>
                              )
                            }

                            return (
                              <td key={date} style={{
                                padding:'6px 4px', textAlign:'center',
                                borderBottom:'1px solid #1e293b', borderLeft:'1px solid #1e293b',
                                background: isToday ? '#0d1b3e' : undefined
                              }}>
                                <div style={{ display:'flex', justifyContent:'center', gap:3, flexWrap:'wrap' }}>
                                  {slotTimes.map(slotTime => {
                                    // Check if this slot exists on this day
                                    const slotExists = daySlots.some(s => s.slot_time?.slice(0,5) === slotTime)
                                    const unavail    = isColleagueUnavailable(pilot.id, date, slotTime + ':00')

                                    // Is this pilot booked on this slot?
                                    // Main pilot (fixed_order=1) = booked if ANY booking exists on this slot.
                                    // Other colleagues = booked if they appear in _assignedColleagueIds.
                                    const { bookings: dayBookings = [] } = weekData[date] || {}
                                    const slotBookings = dayBookings.filter(b =>
                                      b.pilot_slots?.slot_time?.slice(0,5) === slotTime
                                    )
                                    const isBooked = isMainPilot
                                      ? slotBookings.length > 0
                                      : slotBookings.some(b => b._assignedColleagueIds?.has(pilot.id))

                                    if (!slotExists) {
                                      // Slot doesn't exist this day
                                      return (
                                        <span key={slotTime} style={{
                                          width:18, height:18, borderRadius:4,
                                          background:'#1e293b', display:'inline-flex',
                                          alignItems:'center', justifyContent:'center',
                                          fontSize:'0.5rem', color:'#334155'
                                        }}>–</span>
                                      )
                                    }

                                    // Color priority: absent (red) > booked (blue) > present (green)
                                    let cellBg, cellBorder, cellIcon, cellTitle
                                    if (unavail) {
                                      cellBg     = '#7f1d1d'
                                      cellBorder = '#dc2626'
                                      cellIcon   = '✗'
                                      cellTitle  = `Cliquer pour rendre ${pilot.name} présent — ${slotTime}`
                                    } else if (isBooked) {
                                      cellBg     = '#1e3a5f'
                                      cellBorder = '#3b82f6'
                                      cellIcon   = '✈'
                                      cellTitle  = `${pilot.name} est booké sur ce créneau — ${slotTime}`
                                    } else {
                                      cellBg     = '#14532d'
                                      cellBorder = '#16a34a'
                                      cellIcon   = '✓'
                                      cellTitle  = `Cliquer pour marquer ${pilot.name} absent — ${slotTime}`
                                    }

                                    return (
                                      <span key={slotTime}
                                        role="button"
                                        title={cellTitle}
                                        onClick={() => togglePilotAvailability(pilot.id, date, slotTime)}
                                        style={{
                                          width:22, height:22, borderRadius:5,
                                          background: cellBg,
                                          border: `1px solid ${cellBorder}`,
                                          display:'inline-flex', alignItems:'center',
                                          justifyContent:'center', fontSize:'0.7rem',
                                          cursor:'pointer',
                                          transition:'filter 0.1s, transform 0.1s',
                                          userSelect:'none'
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.filter='brightness(1.4)'; e.currentTarget.style.transform='scale(1.15)' }}
                                        onMouseLeave={e => { e.currentTarget.style.filter=''; e.currentTarget.style.transform='' }}>
                                        {cellIcon}
                                      </span>
                                    )
                                  })}
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {/* Legend + hint */}
                <div style={{
                  display:'flex', gap:16, padding:'12px 16px', marginTop:8,
                  fontSize:'0.75rem', color:'#94a3b8', flexWrap:'wrap',
                  alignItems:'center'
                }}>
                  <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <span style={{
                      width:14, height:14, borderRadius:3, background:'#14532d',
                      border:'1px solid #16a34a', display:'inline-block'
                    }} />
                    Présent
                  </span>
                  <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <span style={{
                      width:14, height:14, borderRadius:3, background:'#1e3a5f',
                      border:'1px solid #3b82f6', display:'inline-block'
                    }} />
                    Booké ✈
                  </span>
                  <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <span style={{
                      width:14, height:14, borderRadius:3, background:'#7f1d1d',
                      border:'1px solid #dc2626', display:'inline-block'
                    }} />
                    Absent
                  </span>
                  <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <span style={{
                      width:14, height:14, borderRadius:3, background:'#1e293b',
                      display:'inline-block'
                    }} />
                    Pas de créneau
                  </span>
                  <span style={{ marginLeft:'auto', color:'#475569', fontStyle:'italic' }}>
                    👆 Cliquer sur une case pour basculer présence / absence
                  </span>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Booking detail modal (shared by both views) ── */}
      {selectedBooking && (
        <div className="modal-overlay" onClick={() => { setSelectedBooking(null); setEditMode(false); setShowClosure(false) }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editMode ? 'Modifier la reservation' : 'Fiche de reservation'}</h2>
              <button className="btn-ghost" onClick={() => { setSelectedBooking(null); setEditMode(false); setShowClosure(false) }}>✕</button>
            </div>

            {/* ── VIEW MODE ── */}
            {!editMode && (
              <>
                <div className="modal-contact">
                  <strong>{selectedBooking.contact_name}</strong><br />
                  {selectedBooking.contact_phone && (
                    <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                      <a href={`tel:${selectedBooking.contact_phone.replace(/\s+/g,'')}`}
                        style={{ flex: 1, textAlign: 'center', padding: '8px 6px', background: '#1d4ed8', color: 'white', borderRadius: 8, fontWeight: 700, fontSize: '0.85rem', textDecoration: 'none' }}>
                        📞 Appeler
                      </a>
                      <a href={`sms:${selectedBooking.contact_phone.replace(/\s+/g,'')}`}
                        style={{ flex: 1, textAlign: 'center', padding: '8px 6px', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 8, fontWeight: 700, fontSize: '0.85rem', textDecoration: 'none' }}>
                        💬 SMS
                      </a>
                    </div>
                  )}
                </div>
                <div className="modal-passengers">
                  {selectedBooking.passengers?.map((p, i) => {
                    // Fixed pilots available for this booking's slot (exclude indispo)
                    const slotDate = selectedBooking.pilot_slots?.slot_date
                    const slotTime = selectedBooking.pilot_slots?.slot_time
                    const sortedFixed = colleagues
                      .filter(c => c.is_direct && c.is_fixed)
                      .filter(c => !isColleagueUnavailable(c.id, slotDate, slotTime))
                      .sort((a, b) => (a.fixed_order ?? 99) - (b.fixed_order ?? 99))
                    // Accepted colleagues who are NOT already in sortedFixed AND are available
                    // (a fixed pilot absent on that slot gets excluded from sortedFixed but
                    //  may still have an auto-accepted assignment → filter them out here too)
                    const sortedFixedIds = new Set(sortedFixed.map(c => c.id))
                    const acceptedFreelancers = bookingAssignments
                      .filter(a => a.status === 'accepted'
                        && !sortedFixedIds.has(a.colleague_id)
                        && !isColleagueUnavailable(a.colleague_id, slotDate, slotTime))
                      .map(a => a.colleagues?.name)
                      .filter(Boolean)
                    // i=0 → sortedFixed[0] (pilot himself if he's listed as fixed) or pilot.name
                    // i=1..N → sortedFixed[i], then accepted freelancers once fixed list is exhausted
                    const freelancerForSlot = !sortedFixed[i] && i > 0
                      ? acceptedFreelancers[i - sortedFixed.length] || null
                      : null
                    const pilotName = sortedFixed[i]?.name
                      || (i === 0 ? pilot.name : null)
                      || freelancerForSlot
                    return (
                      <div key={p.id} className="modal-pax-card">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                          <div className="modal-pax-name" style={{ margin: 0 }}>
                            Passager {i + 1}{(p.first_name || p.last_name) ? ` — ${p.first_name} ${p.last_name}`.trimEnd() : ''}
                          </div>
                          {pilotName && (
                            <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                              background: i === 0 ? '#1e3a5f' : '#14532d',
                              color: i === 0 ? '#93c5fd' : '#86efac' }}>
                              🪂 {pilotName}
                            </span>
                          )}
                        </div>
                        <div className="modal-pax-details">
                          👤 {catLabel(p.weight_kg, p.age)} &nbsp;|&nbsp; ✈️ {flightTypeLabel(p.flight_type)}
                          {p.parental_auth && <span style={{marginLeft:6,color:'#f59e0b'}}>· autorisation parentale</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {selectedBooking.notes && (
                  <div className="modal-notes">
                    <div className="modal-notes-label">📝 Notes</div>
                    <div className="modal-notes-text">{selectedBooking.notes}</div>
                  </div>
                )}
                <div className="modal-ref">Ref. {selectedBooking.booking_ref || selectedBooking.id?.slice(0, 8).toUpperCase()}</div>

                {/* ── Colleague assignments ── */}
                {bookingAssignments.length > 0 && (
                  <div style={{ margin: '12px 0', padding: '12px', background: '#0f172a', borderRadius: 10, border: '1px solid #1e293b' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                      🧑‍✈️ Collègues demandés
                    </div>
                    {bookingAssignments.map(a => {
                      const slotDate = selectedBooking.pilot_slots?.slot_date
                      const slotTime = selectedBooking.pilot_slots?.slot_time
                      const isAbsent = isColleagueUnavailable(a.colleague_id, slotDate, slotTime)
                      const statusMap = {
                        pending:  { icon: '⏳', color: '#f59e0b', label: 'En attente' },
                        accepted: { icon: '✅', color: '#4ade80', label: 'Accepté' },
                        refused:  { icon: '❌', color: '#f87171', label: 'Refusé' },
                      }
                      const st = statusMap[a.status] || statusMap.pending
                      return (
                        <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0',
                          opacity: isAbsent ? 0.45 : 1 }}>
                          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: isAbsent ? '#94a3b8' : '#e2e8f0' }}>
                            {a.colleagues?.name || '—'}
                            {isAbsent && <span style={{ marginLeft: 6, fontSize: '0.72rem', fontWeight: 700, color: '#f87171' }}>ABSENT</span>}
                          </span>
                          <span style={{ fontSize: '0.8rem', color: isAbsent ? '#64748b' : st.color, fontWeight: 600 }}>
                            {isAbsent ? '🚫 Absent' : `${st.icon} ${st.label}`}
                          </span>
                        </div>
                      )
                    })}
                    <button
                      onClick={() => setShowAssign(true)}
                      style={{ marginTop: 8, width: '100%', padding: '7px', background: 'rgba(29,78,216,0.12)', border: '1px solid rgba(29,78,216,0.3)', borderRadius: 7, color: '#93c5fd', fontSize: '0.8rem', cursor: 'pointer' }}>
                      Gérer les collègues →
                    </button>
                  </div>
                )}

                {/* ── Reinforcement needed banner ── */}
                {(() => {
                  const slotDate = selectedBooking.pilot_slots?.slot_date
                  const slotTime = selectedBooking.pilot_slots?.slot_time
                  const paxCount = selectedBooking.passengers?.length || 1
                  // Fixed pilots sorted by rank; [0] = pilot himself → use slice(1) to exclude
                  const allFixed = colleagues
                    .filter(c => c.is_direct && c.is_fixed)
                    .sort((a, b) => (a.fixed_order ?? 99) - (b.fixed_order ?? 99))
                  const availFixed = allFixed
                    .slice(1)
                    .filter(c => !isColleagueUnavailable(c.id, slotDate, slotTime))
                  const pilotsNeeded = paxCount - 1  // pilot himself covers pax 1
                  const missing = pilotsNeeded - availFixed.length
                  if (missing <= 0) return null

                  // Freelance (non-fixed) direct colleagues to call as reinforcement
                  const freelancers = colleagues
                    .filter(c => c.is_direct && !c.is_fixed)
                    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

                  return (
                    <div style={{ margin: '12px 0', padding: '12px', background: 'rgba(239,68,68,0.08)', borderRadius: 10, border: '1px solid rgba(239,68,68,0.3)' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f87171', marginBottom: 8 }}>
                        ⚠️ Renfort nécessaire — {missing} pilote{missing > 1 ? 's' : ''} manquant{missing > 1 ? 's' : ''}
                      </div>
                      {freelancers.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {freelancers.map(c => (
                            <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 7 }}>
                              <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#e2e8f0' }}>🪂 {c.name}</span>
                              <div style={{ display: 'flex', gap: 6 }}>
                                {c.phone && (
                                  <a href={`tel:${c.phone}`}
                                    style={{ padding: '4px 10px', background: 'rgba(29,78,216,0.2)', border: '1px solid rgba(29,78,216,0.4)', borderRadius: 6, color: '#93c5fd', fontSize: '0.78rem', textDecoration: 'none', fontWeight: 600 }}>
                                    📞 Appeler
                                  </a>
                                )}
                                {c.phone && (
                                  <a href={`sms:${c.phone}`}
                                    style={{ padding: '4px 10px', background: 'rgba(5,150,105,0.2)', border: '1px solid rgba(5,150,105,0.4)', borderRadius: 6, color: '#6ee7b7', fontSize: '0.78rem', textDecoration: 'none', fontWeight: 600 }}>
                                    💬 SMS
                                  </a>
                                )}
                                {!c.phone && (
                                  <span style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}>Pas de numéro</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                          Aucun pilote indépendant enregistré. Ajoutez des collègues dans vos contacts.
                        </div>
                      )}
                      <button
                        onClick={() => setShowAssign(true)}
                        style={{ marginTop: 10, width: '100%', padding: '7px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 7, color: '#fca5a5', fontSize: '0.8rem', cursor: 'pointer' }}>
                        Envoyer une demande officielle →
                      </button>
                    </div>
                  )
                })()}

                {selectedBooking.status === 'pending' && (
                  <div className="booking-actions">
                    <button className="btn-confirm"
                      onClick={() => handleBooking(selectedBooking.id, 'confirmed')}>✓ Confirmer</button>
                    <button className="btn-refuse"
                      onClick={() => handleBooking(selectedBooking.id, 'refused')}>✗ Refuser</button>
                  </div>
                )}
                {selectedBooking.status === 'confirmed' && (
                  <div className="booking-whatsapp-actions">
                    <div className="booking-confirmed-label">
                      ✓ Vol confirmé
                      {selectedBooking.source !== 'manual' && ' — SMS envoyé au client'}
                      {selectedBooking.source === 'manual' && ' (réservation manuelle)'}
                    </div>
                  </div>
                )}
                {selectedBooking.status === 'refused' && (
                  <div className="booking-whatsapp-actions">
                    <div className="booking-confirmed-label" style={{ color: '#e53e3e' }}>✗ Vol refuse</div>
                  </div>
                )}

                {/* ── CLÔTURE DU VOL ──────────────────────────────────────────── */}
                {/* Toujours accessible pour les vols confirmés — même après une 1re clôture */}
                {selectedBooking.status === 'confirmed' && (
                  <div style={{ margin:'10px 0' }}>

                    {/* Résumé des paiements déjà enregistrés (si vol déjà clôturé) */}
                    {selectedBooking.paid_at && !showClosure && (
                      <div style={{ marginBottom:8, padding:'10px 12px', background:'rgba(34,197,94,0.08)', border:'1px solid rgba(34,197,94,0.2)', borderRadius:10 }}>
                        <div style={{ fontSize:11, fontWeight:700, color:'#4ade80', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:6 }}>
                          ✅ Paiements enregistrés
                        </div>
                        {selectedBooking.closure_data?.payment_groups?.length ? (
                          /* Nouveau format : payer + vols + méthode */
                          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                            {selectedBooking.closure_data.payment_groups.map((g, i) => (
                              <div key={g.id || i} style={{ fontSize:12, color:'#94a3b8', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                                <span style={{ color:'#e2e8f0', fontWeight:600 }}>
                                  {g.payer_name || `Règlement ${i+1}`}
                                </span>
                                {(g.flight_lines || []).map((l, li) => (
                                  <span key={li} style={{ color:'#7dd3fc' }}>
                                    {l.count > 1 ? `${l.count}×` : ''}{l.label} {l.count * l.price_eur}€
                                  </span>
                                ))}
                                <span>{{ cash:'💶', check:'✅', wero:'📲' }[g.method] || ''}</span>
                                {g.invoice_number && <span style={{ color:'#a78bfa' }}>🧾 {g.invoice_number}</span>}
                              </div>
                            ))}
                          </div>
                        ) : (
                          /* Ancien format */
                          <div style={{ fontSize:13, color:'#94a3b8', display:'flex', flexWrap:'wrap', gap:'6px 16px' }}>
                            <span>🧑‍✈️ {selectedBooking.flew_pilot_name || '—'}</span>
                            <span>{{ card:'💳 Carte', cash:'💶 Espèces', wero:'📲 Wero' }[selectedBooking.payment_method] || selectedBooking.payment_method || '—'}</span>
                            {selectedBooking.invoice_number && <span>🧾 {selectedBooking.invoice_number}</span>}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Bouton toujours visible — label selon l'état */}
                    {!showClosure ? (
                      <button
                        onClick={() => setShowClosure(true)}
                        style={{
                          width:'100%', padding:'11px',
                          background: selectedBooking.paid_at
                            ? 'linear-gradient(135deg,#1e3a1e,#172e17)'
                            : 'linear-gradient(135deg,#0f2a4a,#0c1e35)',
                          border: selectedBooking.paid_at
                            ? '1.5px solid #16a34a'
                            : '1.5px solid #1d4ed8',
                          borderRadius:10,
                          color: selectedBooking.paid_at ? '#86efac' : '#93c5fd',
                          fontWeight:700, fontSize:14, cursor:'pointer', fontFamily:'inherit',
                        }}>
                        {selectedBooking.paid_at
                          ? '✏️ Modifier les paiements'
                          : '🛬 Clôturer ce vol'}
                      </button>
                    ) : (
                      <FlightClosure
                        booking={selectedBooking}
                        pilot={{ id: pilot.id, name: pilot.sms_name || 'Capitaine' }}
                        flightTypes={flightTypes}
                        pilots={[
                          pilot.sms_name || 'Capitaine',
                          // Seulement les collègues assignés à CE vol
                          ...bookingAssignments
                            .map(a => a.colleagues?.name)
                            .filter(Boolean),
                        ]}
                        onDone={async (patch) => {
                          setSelectedBooking(prev => ({ ...prev, ...patch }))
                          setShowClosure(false)

                          // ── Sync booking_assignments ───────────────────────
                          // If a colleague was replaced at closure (e.g. Charles → Edouard),
                          // remove their booking_assignment so their planning no longer shows the booking.
                          try {
                            const finalPilotNames = new Set(
                              (patch.closure_data?.pilot_flights || [])
                                .map(pf => pf.pilot_name)
                                .filter(Boolean)
                            )
                            // For each assignment, check if the colleague's name is still in pilot_flights
                            const removedIds = bookingAssignments
                              .filter(a => {
                                const name = a.colleagues?.name
                                return name && !finalPilotNames.has(name)
                              })
                              .map(a => a.colleague_id)
                              .filter(Boolean)

                            if (removedIds.length > 0) {
                              await supabase
                                .from('booking_assignments')
                                .delete()
                                .eq('booking_id', selectedBooking.id)
                                .in('colleague_id', removedIds)
                            }
                          } catch (syncErr) {
                            // Non-fatal — log only
                            console.warn('[onDone] booking_assignments sync error:', syncErr)
                          }

                          loadDay(selectedDate)
                          loadWeek(weekStart)
                        }}
                        onCancel={() => setShowClosure(false)}
                      />
                    )}
                  </div>
                )}
                {/* ── FIN CLÔTURE ──────────────────────────────────────────── */}

                {(selectedBooking.status === 'pending' || selectedBooking.status === 'confirmed') && (
                  <div className="booking-manage-actions">
                    {/* Assign colleague — shown when booking has multiple passengers or pilot wants help */}
                    <button
                      className="btn-edit"
                      onClick={() => setShowAssign(true)}
                      style={{ background: 'rgba(29,78,216,0.15)', borderColor: 'rgba(29,78,216,0.4)', color: '#93c5fd' }}
                    >
                      🧑‍✈️ Appeler un collègue en renfort
                    </button>
                    <button className="btn-edit" onClick={enterEditMode}>✏️ Modifier la reservation</button>
                    <button className="btn-cancel-booking" onClick={() => handleCancel(selectedBooking.id)}>
                      🗑 Annuler cette reservation
                    </button>
                  </div>
                )}

                {/* ── FERMER / ROUVRIR LE CRÉNEAU ─────────────────────────── */}
                {selectedBooking.pilot_slots && (
                  <button
                    onClick={async () => {
                      const slot = selectedBooking.pilot_slots
                      const newAvail = !slot.is_available
                      await supabase.from('pilot_slots')
                        .update({ is_available: newAvail }).eq('id', slot.id)
                      logActivity(pilot.id, 'slot_toggled', 'slot', slot.id, {
                        slot_date: slot.slot_date, slot_time: slot.slot_time,
                        is_available: newAvail, source: 'booking_modal'
                      })
                      // Update the selected booking's nested slot so the button reflects new state
                      setSelectedBooking(prev => prev ? {
                        ...prev,
                        pilot_slots: { ...prev.pilot_slots, is_available: newAvail }
                      } : null)
                      loadWeek(weekStart)
                    }}
                    style={{
                      width:'100%', marginTop:8, padding:'10px 14px',
                      background: selectedBooking.pilot_slots.is_available
                        ? 'rgba(127,29,29,0.25)' : 'rgba(20,83,45,0.25)',
                      border: `1.5px solid ${selectedBooking.pilot_slots.is_available ? '#dc2626' : '#16a34a'}`,
                      borderRadius:10, cursor:'pointer', fontWeight:700, fontSize:13,
                      color: selectedBooking.pilot_slots.is_available ? '#fca5a5' : '#86efac',
                      fontFamily:'inherit'
                    }}>
                    {selectedBooking.pilot_slots.is_available
                      ? '🔒 Fermer ce créneau (PAS DISPO)'
                      : '🔓 Rouvrir ce créneau (DISPO)'}
                  </button>
                )}
              </>
            )}

            {/* ── EDIT MODE ── */}
            {editMode && editData && (
              <>
                <div className="edit-section">
                  <div className="edit-section-title">Date et creneau</div>
                  <label className="edit-label">Date</label>
                  <input className="edit-input" type="date" value={editData.slot_date} min={TODAY}
                    onChange={e => {
                      const d = e.target.value
                      setEditData(prev => ({ ...prev, slot_date: d, pilot_slot_id: '' }))
                      loadEditSlots(d)
                    }} />
                  <label className="edit-label">Creneau</label>
                  {editSlots.length === 0
                    ? <p style={{ fontSize: '0.85rem', color: '#888', margin: '4px 0' }}>Aucun creneau pour cette date.</p>
                    : <select className="edit-input" value={editData.pilot_slot_id}
                        onChange={e => setEditData(d => ({ ...d, pilot_slot_id: e.target.value }))}>
                        <option value="">— Choisir un creneau —</option>
                        {editSlots.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.slot_time.slice(0, 5)}{!s.is_available ? ' (indispo)' : ''}
                          </option>
                        ))}
                      </select>
                  }
                </div>
                <div className="edit-section">
                  <label className="edit-label">Nom du contact</label>
                  <input className="edit-input" value={editData.contact_name}
                    onChange={e => setEditData(d => ({ ...d, contact_name: e.target.value }))} />
                  <label className="edit-label">Telephone</label>
                  <input className="edit-input" type="tel" value={editData.contact_phone}
                    onChange={e => setEditData(d => ({ ...d, contact_phone: e.target.value }))} />
                </div>
                <div className="edit-section">
                  <div className="edit-section-title">Passagers</div>
                  {editData.passengers.map((p, i) => (
                    <div key={p.id || `new-${i}`} className="modal-pax-card" style={{ position: 'relative' }}>
                      <div className="modal-pax-name" style={{ marginBottom: '8px' }}>Passager {i + 1}</div>
                      {editData.passengers.length > 1 && (
                        <button className="btn-ghost-small" style={{ position: 'absolute', top: 8, right: 8 }}
                          onClick={() => setEditData(d => ({ ...d, passengers: d.passengers.filter((_, idx) => idx !== i) }))}>✕</button>
                      )}
                      <div className="field-row" style={{ display: 'flex', gap: '8px' }}>
                        <div style={{ flex: 1 }}>
                          <label className="edit-label">Prenom</label>
                          <input className="edit-input" value={p.first_name}
                            onChange={e => setEditData(d => ({ ...d, passengers: d.passengers.map((px, idx) => idx === i ? { ...px, first_name: e.target.value } : px) }))} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="edit-label">Nom</label>
                          <input className="edit-input" value={p.last_name}
                            onChange={e => setEditData(d => ({ ...d, passengers: d.passengers.map((px, idx) => idx === i ? { ...px, last_name: e.target.value } : px) }))} />
                        </div>
                      </div>
                      <div className="field-row" style={{ display: 'flex', gap: '8px' }}>
                        <div style={{ flex: 1 }}>
                          <label className="edit-label">Poids (kg)</label>
                          <input className="edit-input" type="number" min="10" max="120" value={p.weight_kg}
                            onChange={e => setEditData(d => ({ ...d, passengers: d.passengers.map((px, idx) => idx === i ? { ...px, weight_kg: e.target.value } : px) }))} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="edit-label">Age</label>
                          <input className="edit-input" type="number" min="6" max="99" value={p.age}
                            onChange={e => setEditData(d => ({ ...d, passengers: d.passengers.map((px, idx) => idx === i ? { ...px, age: e.target.value } : px) }))} />
                        </div>
                      </div>
                      <div>
                        <label className="edit-label">Type de vol</label>
                        <select className="edit-input" value={p.flight_type}
                          onChange={e => setEditData(d => ({ ...d, passengers: d.passengers.map((px, idx) => idx === i ? { ...px, flight_type: e.target.value } : px) }))}>
                          {flightTypes.map(ft => (
                            <option key={ft.id} value={ft.id}>
                              {ft.label} ({ft.price_eur} €)
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                  {editData.passengers.length < 4 && (
                    <button className="btn-secondary" style={{ width: '100%', marginTop: '8px' }}
                      onClick={() => setEditData(d => ({ ...d, passengers: [...d.passengers, { first_name: '', last_name: '', weight_kg: '', age: '', flight_type: 'discovery' }] }))}>
                      + Ajouter un passager
                    </button>
                  )}
                </div>
                {/* Notes */}
                <div className="edit-section">
                  <label className="edit-label">📝 Notes (optionnel)</label>
                  <textarea className="edit-input" rows={3}
                    placeholder="Habite à Saint-Pierre, aura du retard, nous attend au décollage..."
                    value={editData.notes}
                    onChange={e => setEditData(d => ({ ...d, notes: e.target.value }))}
                    style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: '0.85rem' }} />
                </div>
                <div className="booking-actions">
                  <button className="btn-confirm" onClick={handleSaveEdit}>✓ Enregistrer</button>
                  <button className="btn-refuse" onClick={() => setEditMode(false)}>Annuler</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
