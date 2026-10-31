// MascotAssistant — conversational helper of the public booking page.
// The mascot chats with the customer (via the `booking-assistant` Edge Function), gathers the
// passengers / date / contact and, when the customer accepts the plan, hands a draft to the
// regular booking form (`onApply`). The form keeps all the checks, the SMS verification code and
// the actual booking creation — the assistant never writes to the database.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { createGlider } from '../mascot/glider'
import { POSES, PILOT_SPRITE } from '../mascot/poses'
import './MascotAssistant.css'

const wait = ms => new Promise(r => setTimeout(r, ms))
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function MascotAssistant({ onApply }) {
  const [open, setOpen]         = useState(false)
  const [log, setLog]           = useState([])      // [{ who: 'u' | 'a', text }]
  const [chips, setChips]       = useState([])      // [{ label, go? }]
  const [bubble, setBubble]     = useState(null)    // string | 'thinking' | null
  const [pose, setPose]         = useState(null)    // pose id currently shown
  const [pop, setPop]           = useState(false)
  const [input, setInput]       = useState('')
  const [busy, setBusy]         = useState(false)
  const [voiceOn, setVoiceOn]   = useState(false)
  const [listening, setListening] = useState(false)
  const recRef = useRef(null)        // active SpeechRecognition, if any

  const canvasRef   = useRef(null)
  const gliderRef   = useRef(null)
  const logRef      = useRef(null)
  const historyRef  = useRef([])     // messages sent to the AI
  const slotsRef    = useRef({})     // { 'YYYY-MM-DD': ['08:00', ...] } free slots, next 10 days
  const draftRef    = useRef(null)   // latest draft returned by the AI
  const poseTimer   = useRef(null)
  const openingRef  = useRef(false)

  // Lazily create the 3D glider (needs the canvas to be in the DOM)
  const glider = useCallback(() => {
    if (!gliderRef.current && canvasRef.current) gliderRef.current = createGlider(canvasRef.current, PILOT_SPRITE)
    return gliderRef.current
  }, [])

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [log])
  useEffect(() => () => {
    clearTimeout(poseTimer.current)
    try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    try { if (recRef.current) { recRef.current.onend = null; recRef.current.abort() } } catch { /* ignore */ }
  }, [])

  function showPose(id) {
    const key = POSES[id] ? id : 'sourire'
    clearTimeout(poseTimer.current)
    setPose(null)
    poseTimer.current = setTimeout(() => { setPose(key); setPop(true); setTimeout(() => setPop(false), 300) }, 140)
  }

  function speak(text) {
    if (!voiceOn) return
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'fr-FR'; u.rate = 1.05; u.pitch = 1.1
      window.speechSynthesis.speak(u)
    } catch { /* ignore */ }
  }

  function say(text) { setBubble(text); speak(text) }

  // Free slots for the next 10 days — the same public view the booking page already reads
  async function loadSlots() {
    const start = new Date(); const end = new Date(); end.setDate(end.getDate() + 9)
    const { data } = await supabase.from('public_slot_availability')
      .select('slot_date, slot_time')
      .gte('slot_date', isoDate(start)).lte('slot_date', isoDate(end))
      .eq('is_available', true).eq('has_capacity', true)
    const map = {}
    for (let i = 0; i < 10; i++) { const d = new Date(); d.setDate(d.getDate() + i); map[isoDate(d)] = [] }
    for (const s of data || []) {
      const t = String(s.slot_time).slice(0, 5)
      if (map[s.slot_date] && !map[s.slot_date].includes(t)) map[s.slot_date].push(t)
    }
    Object.values(map).forEach(a => a.sort())
    slotsRef.current = map
  }

  async function openAssistant() {
    if (open || openingRef.current) return
    openingRef.current = true
    setOpen(true); setLog([]); setChips([]); setBubble(null); setPose(null)
    historyRef.current = []; draftRef.current = null
    loadSlots().catch(() => {})
    await wait(300)
    await glider()?.play('arrive', 4200)
    glider()?.clear()
    showPose('salut')
    const hello = "Bonjour ! Je suis l'assistant de vol de Planète Parapente."
    say(hello)
    await wait(1600)
    showPose('bienvenue')
    const q = "Dites-moi avec qui vous souhaitez voler, et je m'occupe de trouver le bon créneau."
    say(q)
    setLog([{ who: 'a', text: `${hello} ${q}` }])
    historyRef.current = [{ role: 'assistant', content: `${hello} ${q}` }]
    setChips([{ label: 'Nous sommes en famille' }, { label: 'Je viens seul(e)' }, { label: 'Nous sommes en couple' }])
    openingRef.current = false
  }

  async function closeAssistant() {
    if (!open) return
    setChips([]); showPose('a-bientot'); say("À bientôt dans le ciel de Saint-Leu !")
    await wait(1500)
    setBubble(null); setPose(null)
    await glider()?.play('depart', 3000)
    glider()?.clear()
    setOpen(false)
    try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
  }

  async function send(raw) {
    const text = (raw || '').trim()
    if (!text || busy) return
    setInput(''); setChips([]); setBusy(true)
    setLog(l => [...l, { who: 'u', text }])
    historyRef.current = [...historyRef.current, { role: 'user', content: text }]
    showPose('je-reflechis'); setBubble('thinking')
    try {
      const { data, error } = await supabase.functions.invoke('booking-assistant', {
        body: { messages: historyRef.current, today: isoDate(new Date()), slots: slotsRef.current },
      })
      if (error || !data || data.error) throw new Error(data?.error || error?.message || 'assistant_error')

      let reply = String(data.texte || '').trim() || 'Pouvez-vous reformuler ?'
      // Safety net: never show raw JSON to the customer
      if (reply.startsWith('{')) {
        const m = reply.match(/"texte"\s*:\s*"((?:[^"\\]|\\.)*)"/)
        reply = m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ') : 'Pouvez-vous reformuler ?'
      }
      historyRef.current = [...historyRef.current, { role: 'assistant', content: reply }]
      setLog(l => [...l, { who: 'a', text: reply }])
      showPose(data.pose); say(reply)

      const next = (Array.isArray(data.suggestions) ? data.suggestions : []).slice(0, 3).map(s => ({ label: String(s) }))
      if (data.draft) draftRef.current = data.draft
      if (data.draft?.ready) next.unshift({ label: '✅ Préparer ma réservation', go: true })
      setChips(next)
    } catch (e) {
      console.warn('assistant error', e)
      const msg = "Je ne suis pas disponible pour le moment. Vous pouvez réserver directement avec le formulaire ci-dessous."
      setLog(l => [...l, { who: 'a', text: msg }])
      showPose('pas-disponible'); say(msg)
      setChips([{ label: 'Fermer', go: false }])
    } finally {
      setBusy(false)
    }
  }

  function onChip(c) {
    if (c.go) { applyDraft(); return }
    if (c.label === 'Fermer') { closeAssistant(); return }
    send(c.label)
  }

  async function applyDraft() {
    const draft = draftRef.current
    if (!draft) return
    showPose('reservation-confirmee')
    say("Parfait ! Je prépare votre réservation : vérifiez les informations, puis validez.")
    await wait(1600)
    onApply?.(draft)
    closeAssistant()
  }

  // Microphone: keeps listening through short pauses, shows what it hears in the input field,
  // and sends once the customer has been silent for ~2.5 s (or taps the mic again to stop).
  function startMic() {
    // Second tap = stop listening and send what was heard
    if (recRef.current) { try { recRef.current.stop() } catch { /* ignore */ } return }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setBubble("Le micro n'est pas disponible sur cet appareil."); return }
    try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    try {
      const r = new SR()
      r.lang = 'fr-FR'; r.continuous = true; r.interimResults = true
      let finalText = ''
      let silence = null
      let finished = false     // true once the customer is done (silence, or second tap on the mic)
      let restarts = 0

      // The browser may close the listening session on its own after a few words.
      // Until `finished`, we simply reopen it and keep what was already heard.
      const finish = () => { finished = true; clearTimeout(silence); try { r.stop() } catch { /* ignore */ } }
      const armSilence = (ms = 3500) => { clearTimeout(silence); silence = setTimeout(finish, ms) }

      r.onresult = e => {
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript
          if (e.results[i].isFinal) finalText += t + ' '; else interim += t
        }
        setInput((finalText + interim).trim())
        armSilence()
      }
      r.onerror = ev => {
        if (ev.error === 'no-speech' || ev.error === 'aborted') return   // handled in onend
        finished = true
        setBubble(ev.error === 'not-allowed' ? "Autorisez le micro dans votre navigateur pour parler." : "Je n'ai pas pu utiliser le micro.")
      }
      r.onend = () => {
        if (!finished && restarts < 40) {            // closed early by the browser → listen again
          restarts++
          try { r.start(); return } catch { /* fall through and finish */ }
        }
        clearTimeout(silence)
        recRef.current = null
        setListening(false)
        const heard = finalText.trim()
        if (heard) send(heard)
        else { setInput(''); setBubble("Je n'ai rien entendu, vous pouvez réessayer ou écrire votre message.") }
      }
      // Tapping the mic again calls r.stop(): mark as finished so onend sends instead of restarting
      r.stop = (orig => function () { finished = true; clearTimeout(silence); return orig.call(r) })(r.stop)
      recRef.current = r
      setListening(true); setInput('')
      showPose('je-t-ecoute'); setBubble('Je vous écoute…')
      r.start(); armSilence(6000)
    } catch { recRef.current = null; setListening(false); setBubble("Je n'ai pas pu utiliser le micro.") }
  }

  return (
    <>
      {!open && (
        <button className="mascot-fab" onClick={openAssistant} aria-label="Réserver avec l'assistant">
          <img src={POSES.salut} alt="" />
          Réserver avec l'assistant
        </button>
      )}

      <div className={`mascot-sheet${open ? ' open' : ''}`} aria-live="polite">
        <div className="mascot-head">
          <b>Votre assistant de vol</b>
          <button className={`mascot-icon${voiceOn ? ' on' : ''}`} title="Voix"
            onClick={() => { setVoiceOn(v => { if (v) { try { window.speechSynthesis?.cancel() } catch { /* ignore */ } } return !v }) }}>
            {voiceOn ? '🔊' : '🔈'}
          </button>
          <button className="mascot-icon" title="Fermer" onClick={closeAssistant}>✕</button>
        </div>

        <div className="mascot-stage">
          <canvas ref={canvasRef} />
          {pose && <img className={`mascot-pose show${pop ? ' pop' : ''}`} src={POSES[pose]} alt="" />}
          <div className={`mascot-bubble${bubble ? ' show' : ''}`}>
            {bubble === 'thinking'
              ? <span className="mascot-dots"><span /><span /><span /></span>
              : bubble}
          </div>
        </div>

        <div className="mascot-log" ref={logRef}>
          {log.map((m, i) => <div key={i} className={`mascot-msg ${m.who}`}>{m.text}</div>)}
        </div>

        <div className="mascot-chips">
          {chips.map((c, i) => (
            <button key={i} className={`mascot-chip${c.go ? ' go' : ''}`} onClick={() => onChip(c)}>{c.label}</button>
          ))}
        </div>

        <form className="mascot-in" onSubmit={e => { e.preventDefault(); send(input) }}>
          <button type="button" className={`mascot-icon${listening ? ' on' : ''}`} title={listening ? 'Arrêter et envoyer' : 'Parler'} onClick={startMic}>{listening ? '⏹' : '🎤'}</button>
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="Écrivez votre message…"
            autoComplete="off" disabled={busy} maxLength={600} />
          <button className="mascot-icon mascot-send" disabled={busy} title="Envoyer">➤</button>
        </form>
      </div>
    </>
  )
}
