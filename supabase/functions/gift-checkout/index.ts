// Supabase Edge Function — gift-checkout (public, no JWT)
// Receives the gift voucher order form, computes the price SERVER-SIDE from the settings,
// stores a "pending" voucher and returns a Stripe Checkout URL.
// Secrets needed: STRIPE_SECRET_KEY, SITE_URL (e.g. https://dispo-app-pi.vercel.app)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const PACK_EXTRA: Record<string, number> = { none: 0, photo: 10, photo_video: 20 }
const PACK_LABEL: Record<string, string> = { none: '', photo: ' + photos', photo_video: ' + photos et vidéo' }
const DESIGNS = ['child', 'adult', 'colleague', 'birthday']

// Voucher code without ambiguous characters (no 0/O, 1/I)
function makeCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const pick = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => chars[b % chars.length]).join('')
  return `PP-${pick(4)}-${pick(4)}`
}

const clean = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max)

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const b = await req.json()
    const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
    const SITE_URL = (Deno.env.get('SITE_URL') ?? 'https://dispo-app-pi.vercel.app').replace(/\/$/, '')
    if (!STRIPE_KEY) return json({ error: 'Paiement non configuré' }, 500)

    const first = clean(b.first_name, 80), last = clean(b.last_name, 80)
    const phone = clean(b.phone, 30), email = clean(b.email, 120)
    if (!first || !last || !phone || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Champs obligatoires manquants' }, 400)

    const pack = 'none' // photos / video are never included in a voucher
    const design = DESIGNS.includes(b.design) ? b.design : 'adult'
    if (b.cgv !== true) return json({ error: 'CGV non acceptées' }, 400)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Price comes from the owner's settings, never from the browser
    const { data: st } = await sb.from('settings').select('flight_types').order('created_at', { ascending: true }).limit(1).maybeSingle()
    const types = (st?.flight_types ?? []) as Array<{ id: string; label: string; price_eur: number }>
    const ft = types.find(t => t.id === b.flight_type_id)
    if (!ft) return json({ error: 'Vol inconnu' }, 400)
    const amount = Number(ft.price_eur) + PACK_EXTRA[pack]

    const desired = /^\d{4}-\d{2}-\d{2}$/.test(String(b.desired_date ?? '')) ? b.desired_date : null

    // Insert the pending voucher (retry on the rare code collision)
    let voucher: { id: string; token: string } | null = null
    for (let i = 0; i < 5 && !voucher; i++) {
      const { data, error } = await sb.from('gift_vouchers').insert({
        code: makeCode(), status: 'pending',
        flight_type_id: ft.id, flight_label: ft.label, media_pack: pack, amount_eur: amount, design,
        buyer_first_name: first, buyer_last_name: last, buyer_phone: phone, buyer_email: email,
        from_name: clean(b.from_name, 80) || null, to_name: clean(b.to_name, 80) || null,
        message: clean(b.message, 600) || null, desired_date: desired,
      }).select('id, token').single()
      if (!error) voucher = data
    }
    if (!voucher) return json({ error: 'Création impossible' }, 500)

    // Stripe Checkout session (REST, no SDK needed)
    const form = new URLSearchParams()
    form.set('mode', 'payment')
    form.set('customer_email', email)
    form.set('client_reference_id', voucher.id)
    form.set('success_url', `${SITE_URL}/bon-cadeau/merci?t=${voucher.token}`)
    form.set('cancel_url', `${SITE_URL}/bon-cadeau`)
    form.set('line_items[0][quantity]', '1')
    form.set('line_items[0][price_data][currency]', 'eur')
    form.set('line_items[0][price_data][unit_amount]', String(Math.round(amount * 100)))
    form.set('line_items[0][price_data][product_data][name]', `Bon cadeau — Vol parapente ${ft.label}${PACK_LABEL[pack]}`)
    form.set('metadata[voucher_id]', voucher.id)

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    })
    const session = await res.json()
    if (!res.ok || !session.url) {
      console.error('Stripe error', session)
      return json({ error: 'Paiement indisponible' }, 502)
    }
    await sb.from('gift_vouchers').update({ stripe_session_id: session.id }).eq('id', voucher.id)
    return json({ url: session.url })
  } catch (e) {
    console.error(e)
    return json({ error: 'Erreur serveur' }, 500)
  }
})
