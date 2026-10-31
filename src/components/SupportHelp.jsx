// SupportHelp — in-app help (opened from the menu → « Assistance »; no floating button) for signed-in users (e.g. a secretary while the owner is away).
//  • A panel with an ADVISOR that explains how to use the app.
//    The advisor only talks: it cannot see the planning/bookings/accounting and cannot change anything.
//  • "Prévenir l'administrateur" saves a help request (shown as a banner on the owner's dashboard)
//    and texts the owner. Both go through the `support-assistant` Edge Function.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { POSES } from '../mascot/poses'

const GREETING = "Bonjour ! Je peux vous expliquer comment utiliser l'application. Je ne vois pas votre planning et je ne peux rien modifier : je suis là pour vous conseiller. Quelle est votre question ?"

export default function SupportHelp({ where = '', open = false, onClose = () => {} }) {
  const [log, setLog]           = useState([{ who: 'a', text: GREETING }])
  const [input, setInput]       = useState('')
  const [busy, setBusy]         = useState(false)
  const [escalate, setEscalate] = useState(false)   // advisor suggests warning the admin
  const [reporting, setReporting] = useState(false) // report form open
  const [report, setReport]     = useState('')
  const [sent, setSent]         = useState(false)
  const [error, setError]       = useState('')
  const historyRef = useRef([])                     // messages sent to the advisor
  const logRef     = useRef(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log, busy, reporting, sent])

  async function ask() {
    const text = input.trim()
    if (!text || busy) return
    setInput(''); setError(''); setBusy(true)
    setLog(l => [...l, { who: 'u', text }])
    historyRef.current = [...historyRef.current, { role: 'user', content: text }]
    try {
      const { data, error: err } = await supabase.functions.invoke('support-assistant', {
        body: { action: 'chat', messages: historyRef.current },
      })
      if (err || !data || data.error) throw new Error(data?.error || err?.message || 'support_error')
      const reply = String(data.texte || '').trim()
      historyRef.current = [...historyRef.current, { role: 'assistant', content: reply }]
      setLog(l => [...l, { who: 'a', text: reply }])
      if (data.escalate) setEscalate(true)
    } catch (e) {
      console.warn('support error', e)
      setLog(l => [...l, { who: 'a', text: "Je ne suis pas disponible pour le moment. Vous pouvez prévenir l'administrateur avec le bouton ci-dessous." }])
      setEscalate(true)
    } finally {
      setBusy(false)
    }
  }

  function openReport() {
    // Pre-fill with the person's last question so they only have to confirm
    const lastQ = [...historyRef.current].reverse().find(m => m.role === 'user')?.content || ''
    setReport(r => r || lastQ)
    setReporting(true); setSent(false); setError('')
  }

  async function sendReport() {
    const message = report.trim()
    if (message.length < 3 || busy) return
    setBusy(true); setError('')
    try {
      const { data, error: err } = await supabase.functions.invoke('support-assistant', {
        body: { action: 'report', message, page: where, conversation: historyRef.current },
      })
      if (err || !data || data.error) throw new Error(data?.error || err?.message || 'report_error')
      setSent(true); setReporting(false); setReport(''); setEscalate(false)
    } catch (e) {
      console.warn('report error', e)
      setError("Le message n'est pas parti. Vérifiez votre connexion et réessayez, ou appelez l'administrateur.")
    } finally {
      setBusy(false)
    }
  }

  // The mascot changes pose with what is going on
  const pose = sent ? 'merci' : busy ? 'je-reflechis' : escalate ? 'je-t-ecoute' : 'je-t-explique'

  return (
    <>
      {open && (
        <div className="support-panel" role="dialog" aria-label="Aide">
          <div className="support-head">
            <img className="support-avatar" src={POSES[pose]} alt="" />
            <span className="support-title">Assistance<small>Je vous explique l'application</small></span>
            <button className="support-close" onClick={onClose} aria-label="Fermer">✕</button>
          </div>

          <div className="support-log" ref={logRef}>
            {log.map((m, i) => (
              <div key={i} className={`support-msg ${m.who === 'u' ? 'support-user' : 'support-bot'}`}>{m.text}</div>
            ))}
            {busy && !reporting && <div className="support-msg support-bot">…</div>}
            {sent && <div className="support-msg support-ok">✅ L'administrateur est prévenu. Il vous répondra dès que possible.</div>}
          </div>

          {reporting ? (
            <div className="support-report">
              <label>Décrivez le problème en quelques mots :</label>
              <textarea value={report} onChange={e => setReport(e.target.value)} rows={3} maxLength={800}
                placeholder="Ex. : je n'arrive pas à voir la réservation de 9h30 jeudi" />
              {error && <div className="support-error">{error}</div>}
              <div className="support-row">
                <button className="support-btn support-btn-ghost" onClick={() => setReporting(false)}>Annuler</button>
                <button className="support-btn support-btn-alert" onClick={sendReport} disabled={busy || report.trim().length < 3}>
                  {busy ? 'Envoi…' : '📩 Envoyer'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {error && <div className="support-error">{error}</div>}
              <div className="support-input">
                <input value={input} onChange={e => setInput(e.target.value)} placeholder="Votre question…"
                  maxLength={600} onKeyDown={e => { if (e.key === 'Enter') ask() }} />
                <button className="support-btn" onClick={ask} disabled={busy || !input.trim()}>Envoyer</button>
              </div>
              <button className={`support-btn support-admin ${escalate ? 'support-admin-hot' : ''}`} onClick={openReport}>
                🆘 Prévenir l'administrateur
              </button>
            </>
          )}
        </div>
      )}
    </>
  )
}
