// WeekPicker — the week title (« 2 – 8 nov. 2026 ») becomes a button that opens a small month
// calendar. Tapping a day jumps to the week containing it; « Aujourd'hui » comes back to now.
import { useState } from 'react'

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const DOW = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function WeekPicker({ label, weekStart, today, onPick }) {
  const [open, setOpen]   = useState(false)
  const [month, setMonth] = useState(() => new Date(weekStart + 'T00:00:00'))   // any date inside the shown month

  function toggle() {
    if (!open) setMonth(new Date(weekStart + 'T00:00:00'))   // open on the month being viewed
    setOpen(o => !o)
  }
  function shiftMonth(delta) { setMonth(m => new Date(m.getFullYear(), m.getMonth() + delta, 1)) }
  function pick(dateStr) { setOpen(false); onPick(dateStr) }

  // 6 weeks grid starting on the Monday on/before the 1st of the month
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const lead  = (first.getDay() + 6) % 7
  const cells = Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), 1 - lead + i))

  // The week currently shown (7 days) is highlighted
  const shownStart = new Date(weekStart + 'T00:00:00')
  const shownEnd   = new Date(shownStart); shownEnd.setDate(shownEnd.getDate() + 6)

  return (
    <span className="weekpicker">
      <button type="button" className="week-nav-label weekpicker-btn" onClick={toggle} aria-label="Choisir une semaine">
        {label} <span className="weekpicker-caret">▾</span>
      </button>
      {open && (
        <>
          <div className="weekpicker-backdrop" onClick={() => setOpen(false)} />
          <div className="weekpicker-pop" role="dialog" aria-label="Calendrier">
            <div className="weekpicker-head">
              <button type="button" onClick={() => shiftMonth(-1)} aria-label="Mois précédent">‹</button>
              <b>{MONTHS[month.getMonth()]} {month.getFullYear()}</b>
              <button type="button" onClick={() => shiftMonth(1)} aria-label="Mois suivant">›</button>
            </div>
            <div className="weekpicker-grid">
              {DOW.map((d, i) => <span key={i} className="weekpicker-dow">{d}</span>)}
              {cells.map(d => {
                const s = iso(d)
                const inMonth = d.getMonth() === month.getMonth()
                const inShown = d >= shownStart && d <= shownEnd
                return (
                  <button key={s} type="button" onClick={() => pick(s)}
                    className={`weekpicker-day${inMonth ? '' : ' is-out'}${inShown ? ' is-shown' : ''}${s === today ? ' is-today' : ''}`}>
                    {d.getDate()}
                  </button>
                )
              })}
            </div>
            <button type="button" className="weekpicker-today" onClick={() => pick(today)}>📍 Aujourd'hui</button>
          </div>
        </>
      )}
    </span>
  )
}
