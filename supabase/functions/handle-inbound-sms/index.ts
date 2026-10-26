// Supabase Edge Function — handle-inbound-sms
// Twilio webhook: called when a colleague replies to an assignment SMS.
//
// Flow:
//   1. Parse Twilio's POST (application/x-www-form-urlencoded)
//   2. Find the most recent 'pending' assignment whose colleague phone matches the sender
//   3. Interpret the reply: "dispo", "ok", "oui" → accepted; "non", "pas dispo" → refused
//   4. Update assignment status in Supabase
//   5. Send confirmation SMS to the pilot
//   6. Return a TwiML response (empty <Response/> so Twilio doesn't send a default reply)
//
// Configure in Twilio console:
//   Phone number → Messaging → "A message comes in" → Webhook →
//   https://<project-ref>.supabase.co/functions/v1/handle-inbound-sms
//   HTTP POST

import { serve }       from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL           = Deno.env.get('SUPABASE_URL')            ?? ''
const SUPABASE_SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TWILIO_ACCOUNT_SID     = Deno.env.get('TWILIO_ACCOUNT_SID')      ?? ''
const TWILIO_AUTH_TOKEN      = Deno.env.get('TWILIO_AUTH_TOKEN')       ?? ''
const TWILIO_SENDER          = Deno.env.get('TWILIO_SENDER')           ?? 'Planetemanu'
const PILOT_PHONE            = Deno.env.get('PILOT_PHONE')             ?? ''

// Empty TwiML — tells Twilio not to send any default reply
const TWIML_EMPTY = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`

function normalisePhone(raw: string): string {
  const digits = raw.replace(/[\s\-]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.startsWith('00')) return '+' + digits.slice(2)
  if (digits.startsWith('0')) return '+262' + digits.slice(1)
  return '+262' + digits
}

/** Interpret French reply text → 'accepted' | 'refused' | null (unknown) */
function parseReply(body: string): 'accepted' | 'refused' | null {
  const t = body.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
  if (/\b(ok|oui|dispo|j.accepte|accept|present|ok dispo)\b/.test(t)) return 'accepted'
  if (/\b(non|pas dispo|refuse|indispo|impossible|occupe|peux pas|desolé)\b/.test(t)) return 'refused'
  return null
}

async function sendTwilioSMS(to: string, body: string): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
    },
    body: new URLSearchParams({ From: TWILIO_SENDER, To: to, Body: body }),
  })
}

serve(async (req) => {
  // Twilio sends POST with form-encoded body
  if (req.method !== 'POST') {
    return new Response(TWIML_EMPTY, { headers: { 'Content-Type': 'text/xml' } })
  }

  try {
    const text    = await req.text()
    const params  = new URLSearchParams(text)
    const fromRaw = params.get('From') ?? ''
    const msgBody = params.get('Body') ?? ''

    console.log(`[inbound-sms] From=${fromRaw} Body="${msgBody}"`)

    if (!fromRaw) {
      return new Response(TWIML_EMPTY, { headers: { 'Content-Type': 'text/xml' } })
    }

    // Normalise sender phone for DB lookup
    const fromE164 = normalisePhone(fromRaw)

    // Init Supabase with service role (bypasses RLS)
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // ── 1. Find colleague by phone ─────────────────────────────────────────────
    const { data: colleagues } = await db
      .from('colleagues')
      .select('id, name, pilot_id')
      .or(`phone.eq.${fromRaw},phone.eq.${fromE164}`)

    if (!colleagues || colleagues.length === 0) {
      console.log(`[inbound-sms] No colleague found for phone ${fromRaw}`)
      return new Response(TWIML_EMPTY, { headers: { 'Content-Type': 'text/xml' } })
    }

    // Among all colleagues sharing this phone, find the most recent pending assignment
    const colleagueIds = colleagues.map((c: { id: string }) => c.id)

    const { data: assignments } = await db
      .from('booking_assignments')
      .select('id, colleague_id, pilot_id, slot_date, slot_time, pilot_name, pilot_phone')
      .in('colleague_id', colleagueIds)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)

    if (!assignments || assignments.length === 0) {
      console.log(`[inbound-sms] No pending assignment for colleague(s) ${colleagueIds}`)
      return new Response(TWIML_EMPTY, { headers: { 'Content-Type': 'text/xml' } })
    }

    const assignment = assignments[0]
    const colleague  = colleagues.find((c: { id: string }) => c.id === assignment.colleague_id)

    // ── 2. Interpret reply ─────────────────────────────────────────────────────
    const newStatus = parseReply(msgBody)

    if (!newStatus) {
      // Unrecognised reply — still want to notify pilot so they can check
      console.log(`[inbound-sms] Unrecognised reply from ${fromRaw}: "${msgBody}"`)
      const pilotPhone = assignment.pilot_phone || PILOT_PHONE
      if (pilotPhone) {
        const dateLabel = assignment.slot_date
          ? new Date(assignment.slot_date + 'T00:00:00').toLocaleDateString('fr-FR', {
              weekday: 'short', day: 'numeric', month: 'short',
            })
          : ''
        const timeLabel = assignment.slot_time?.slice(0, 5) ?? ''
        await sendTwilioSMS(
          normalisePhone(pilotPhone),
          `Votre collegue ${colleague?.name ?? ''} a repondu au SMS (${dateLabel}${timeLabel ? ' ' + timeLabel : ''}) : "${msgBody.slice(0, 100)}"`
        )
      }
      return new Response(TWIML_EMPTY, { headers: { 'Content-Type': 'text/xml' } })
    }

    // ── 3. Update assignment ───────────────────────────────────────────────────
    await db
      .from('booking_assignments')
      .update({ status: newStatus, responded_at: new Date().toISOString() })
      .eq('id', assignment.id)

    // ── 4. Notify pilot by SMS ─────────────────────────────────────────────────
    const pilotPhone = assignment.pilot_phone || PILOT_PHONE
    if (pilotPhone) {
      const dateLabel = assignment.slot_date
        ? new Date(assignment.slot_date + 'T00:00:00').toLocaleDateString('fr-FR', {
            weekday: 'long', day: 'numeric', month: 'long',
          })
        : ''
      const timeLabel  = assignment.slot_time?.slice(0, 5) ?? ''
      const statusWord = newStatus === 'accepted' ? 'DISPO ✅' : 'PAS DISPO ❌'
      const msg = `${colleague?.name ?? 'Votre collegue'} : ${statusWord} pour le ${dateLabel}${timeLabel ? ' a ' + timeLabel : ''}. Ouvrez l'app pour confirmer.`
      await sendTwilioSMS(normalisePhone(pilotPhone), msg)
      console.log(`[inbound-sms] Notified pilot at ${pilotPhone}: ${msg}`)
    }

    return new Response(TWIML_EMPTY, { headers: { 'Content-Type': 'text/xml' } })

  } catch (err) {
    console.error('[inbound-sms] Error:', err)
    // Always return valid TwiML so Twilio doesn't retry
    return new Response(TWIML_EMPTY, { headers: { 'Content-Type': 'text/xml' } })
  }
})
