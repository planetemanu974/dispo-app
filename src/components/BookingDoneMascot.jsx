/**
 * BookingDoneMascot.jsx — animated mascot on the « Demande envoyée » screen.
 * Joy jump + confetti, then thumbs up, thank-you, and finally waves goodbye.
 * Pure CSS animation (see .done-mascot in App.css), disabled for reduced-motion users.
 */
import { useEffect, useState } from 'react'
import { POSES } from '../mascot/poses'

// pose key + how long it stays (ms); the last one stays on screen
const SEQUENCE = [
  { pose: 'reservation-confirmee', ms: 2600 },
  { pose: 'pouce',                 ms: 2200 },
  { pose: 'merci',                 ms: 2200 },
  { pose: 'a-bientot',             ms: 0 },
]
const COLORS = ['#ff6a2b', '#3b82f6', '#ffffff', '#fbbf24']

// Deterministic « random » confetti so every render is identical
const CONFETTI = Array.from({ length: 22 }, (_, i) => {
  const r = n => ((Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1
  return { left: 6 + r(1) * 88, delay: r(2) * 0.5, dur: 1.6 + r(3) * 1.2, size: 6 + r(4) * 6, color: COLORS[i % COLORS.length], rot: r(5) * 360 }
})

export default function BookingDoneMascot() {
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    SEQUENCE.forEach(s => { const im = new Image(); im.src = POSES[s.pose] })   // preload
    const cur = SEQUENCE[idx]
    if (!cur.ms) return
    const t = setTimeout(() => setIdx(i => Math.min(i + 1, SEQUENCE.length - 1)), cur.ms)
    return () => clearTimeout(t)
  }, [idx])

  const { pose } = SEQUENCE[idx]
  return (
    <div className="done-mascot" aria-hidden="true">
      <div className="done-confetti">
        {CONFETTI.map((c, i) => (
          <span key={i} style={{ left: `${c.left}%`, width: c.size, height: c.size * 0.6, background: c.color,
            animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s`, transform: `rotate(${c.rot}deg)` }} />
        ))}
      </div>
      {/* key = pose → the pop animation replays on every change of pose */}
      <img key={pose} className="done-mascot-img" src={POSES[pose]} alt="" />
      <div className="done-shadow" />
    </div>
  )
}
