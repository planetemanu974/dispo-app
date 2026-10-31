// Supabase Edge Function — stripe-webhook (called by Stripe, no JWT)
// On checkout.session.completed: marks the voucher as paid (valid 6 months),
// e-mails the buyer the download link (if RESEND_API_KEY is set) and texts the pilot.
// Secrets needed: STRIPE_WEBHOOK_SECRET. Optional: RESEND_API_KEY, MAIL_FROM, SITE_URL.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const enc = new TextEncoder()

// Verify the Stripe-Signature header (HMAC SHA-256 of "t.payload"), 5 min tolerance
async function verifyStripe(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=') as [string, string]))
  const t = parts['t'], v1 = header.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3))
  if (!t || !v1.length) return false
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`))
  const hex = Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('')
  return v1.includes(hex)
}

serve(async (req) => {
  const raw = await req.text()
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
  if (!secret || !(await verifyStripe(raw, req.headers.get('stripe-signature') ?? '', secret))) {
    return new Response('bad signature', { status: 400 })
  }
  const event = JSON.parse(raw)
  if (event.type !== 'checkout.session.completed') return new Response('ignored')

  const session = event.data.object
  if (session.payment_status !== 'paid') return new Response('not paid')
  const voucherId = session.metadata?.voucher_id ?? session.client_reference_id
  if (!voucherId) return new Response('no voucher')

  const SB_URL = Deno.env.get('SUPABASE_URL')!, SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const sb = createClient(SB_URL, SB_KEY)
  const SITE_URL = (Deno.env.get('SITE_URL') ?? 'https://dispo-app-pi.vercel.app').replace(/\/$/, '')

  // Idempotent: only the first delivery flips pending → paid
  const expires = new Date(); expires.setMonth(expires.getMonth() + 6)
  const { data: v } = await sb.from('gift_vouchers')
    .update({ status: 'paid', paid_at: new Date().toISOString(), expires_at: expires.toISOString() })
    .eq('id', voucherId).eq('status', 'pending').select().maybeSingle()
  if (!v) return new Response('already handled')

  const link = `${SITE_URL}/bon-cadeau/merci?t=${v.token}`

  // E-mail to the buyer (optional until RESEND_API_KEY is configured)
  const resend = Deno.env.get('RESEND_API_KEY')
  if (resend) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('MAIL_FROM') ?? 'Planète Parapente <onboarding@resend.dev>',
        to: [v.buyer_email],
        subject: 'Votre bon cadeau vol en parapente 🪂',
        html: `<p>Bonjour ${v.buyer_first_name},</p>
          <p>Merci ! Votre paiement est bien reçu. Votre bon cadeau (${v.flight_label}) est prêt :</p>
          <p><a href="${link}" style="background:#f97316;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Télécharger / imprimer mon bon</a></p>
          <p>Code du bon : <b>${v.code}</b> — valable 6 mois. Vous pouvez l'imprimer ou le transférer directement à la personne à qui vous l'offrez.</p>
          <p>L'équipe Planète Parapente — Saint-Leu</p>`,
      }),
    })
    if (r.ok) await sb.from('gift_vouchers').update({ email_sent_at: new Date().toISOString() }).eq('id', v.id)
    else console.error('Resend error', await r.text())
  }

  // SMS to the pilot via the existing send-sms function
  try {
    await fetch(`${SB_URL}/functions/v1/send-sms`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'PILOT', message: `🎁 Bon cadeau payé : ${v.flight_label} ${v.amount_eur}€ — ${v.buyer_first_name} ${v.buyer_last_name} (${v.code})` }),
    })
  } catch (e) { console.error('SMS error', e) }

  return new Response('ok')
})
