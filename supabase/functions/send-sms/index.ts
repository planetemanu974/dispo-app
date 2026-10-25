// Supabase Edge Function — send-sms
// Sends an SMS via Twilio API from the "Planetemanu" alphanumeric sender.
// Called server-side so Twilio credentials are never exposed to the client.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? ''
const TWILIO_AUTH_TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN')  ?? ''
const TWILIO_SENDER      = Deno.env.get('TWILIO_SENDER')      ?? 'Planetemanu'
// Pilot's own phone number, stored as a Supabase secret (never exposed to the client)
const PILOT_PHONE        = Deno.env.get('PILOT_PHONE')        ?? ''

// Normalise a phone number to E.164 format for La Réunion (+262).
// Accepts: 0692123456, +262692123456, 692123456
function normalisePhone(raw: string): string {
  const digits = raw.replace(/\s+/g, '').replace(/-/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.startsWith('00')) return '+' + digits.slice(2)
  // French overseas: 0692… → +262692…
  if (digits.startsWith('0')) return '+262' + digits.slice(1)
  // Bare 9-digit Réunion number
  return '+262' + digits
}

serve(async (req) => {
  // CORS pre-flight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    const { to, message } = await req.json() as { to: string; message: string }

    if (!to || !message) {
      return new Response(JSON.stringify({ error: 'Missing to or message' }), { status: 400 })
    }

    // Special recipient "PILOT" → use the pilot's private phone number from env
    const resolvedTo = to === 'PILOT' ? PILOT_PHONE : to
    if (!resolvedTo) {
      return new Response(JSON.stringify({ error: 'Pilot phone not configured' }), { status: 500 })
    }
    const toE164 = normalisePhone(resolvedTo)
    const url    = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`

    const body = new URLSearchParams({
      From: TWILIO_SENDER,
      To:   toE164,
      Body: message,
    })

    const response = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
      },
      body,
    })

    const result = await response.json()

    if (!response.ok) {
      console.error('Twilio error:', result)
      return new Response(JSON.stringify({ error: result.message }), { status: 500 })
    }

    return new Response(JSON.stringify({ sid: result.sid }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    console.error('send-sms error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
