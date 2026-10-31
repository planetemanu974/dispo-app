// Supabase Edge Function — support-assistant
// In-app ADVISOR for signed-in users (e.g. a secretary managing the planning while the owner is away).
//   action "chat"   → explains how to use the app. It has NO database access and NO power to act:
//                     it never reads the planning/bookings/accounting, never modifies anything.
//   action "report" → stores a help request ("Prévenir l'administrateur") and texts the owner.
//
// Secrets: ANTHROPIC_API_KEY (same as booking-assistant), optional ASSISTANT_MODEL.
// Auth: the caller must be a signed-in user who is in the `pilots` table (checked below —
// the anon key alone is NOT enough).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const API_KEY      = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const MODEL        = Deno.env.get('ASSISTANT_MODEL') ?? 'claude-haiku-5-5'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: CORS })

const MAX_MESSAGES = 20
const MAX_CHARS    = 600
const chatHits   = new Map<string, number[]>()
const reportHits = new Map<string, number[]>()
function limited(map: Map<string, number[]>, key: string, windowMs: number, max: number): boolean {
  const now = Date.now()
  const list = (map.get(key) ?? []).filter(t => now - t < windowMs)
  list.push(now)
  map.set(key, list)
  return list.length > max
}

// Who is calling? A real signed-in user who is a pilot. Returns null otherwise.
async function authenticate(req: Request): Promise<{ userId: string; name: string } | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token || !SUPABASE_URL || !SERVICE_KEY) return null
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } })
  if (!u.ok) return null
  const user = await u.json()
  if (!user?.id) return null
  const p = await fetch(`${SUPABASE_URL}/rest/v1/pilots?user_id=eq.${encodeURIComponent(user.id)}&select=name&limit=1`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } })
  if (!p.ok) return null
  const rows = await p.json()
  if (!rows.length) return null
  return { userId: user.id, name: String(rows[0].name ?? '').slice(0, 60) }
}

// What the advisor knows about the app. Keep it factual: anything not listed here, it must not invent.
const APP_GUIDE = `
DISPO / PAS DISPO est l'application de planning d'un moniteur de parapente indépendant à La Réunion (Planète Parapente Réunion).

ÉCRAN PRINCIPAL
- En haut à gauche, le logo ouvre le MENU. À côté, trois vues : « Semaine », « Jour », « Pilotes ». À droite, le bouton ⚙️ ouvre les Paramètres.
- Le menu contient : Planning, Collègues, Messages (pastille = messages non lus), Rapport pilotes, Historique, Structures, Comptabilité, Météo (pas encore disponible), et « Déconnexion » en bas.
- Si un bouton jaune « Mettre à jour l'app » apparaît dans le menu, il faut le toucher : l'application se recharge avec la dernière version. C'est la première chose à essayer quand quelque chose ne s'affiche pas comme prévu.
- Un bandeau bleu « client à rappeler » peut apparaître en haut : il indique qu'un client a demandé à être rappelé ; le bouton « Rappelé » le retire une fois le client rappelé.
- Des réservations en attente peuvent apparaître dans une alerte en haut de l'écran.

CONSEILS GÉNÉRAUX
- Si l'écran semble figé ou vide : fermer puis rouvrir l'application, ou toucher « Mettre à jour l'app » dans le menu.
- Si la connexion est perdue, on se reconnecte avec l'adresse e-mail et le mot de passe habituels.
`.trim()

function systemPrompt(name: string): string {
  return `Tu es le conseiller d'aide de l'application DISPO / PAS DISPO. Tu parles à ${name || 'un utilisateur'}, qui gère le planning quand l'administrateur (le propriétaire de l'application) est absent. Cette personne n'est pas forcément à l'aise avec l'informatique.

TON RÔLE : EXPLIQUER, rien d'autre.
- Tu expliques comment utiliser l'application, pas à pas, avec des mots simples et courts (2 à 4 phrases, pas de jargon).
- Tu n'as AUCUN accès au planning, aux réservations, aux clients ni à la comptabilité. Tu ne vois pas son écran. Tu ne peux rien modifier, supprimer, créer ni envoyer dans l'application. Ne laisse jamais croire le contraire. Si on te demande de le faire, explique que c'est à la personne de le faire elle-même, et dis-lui comment si tu le sais.
- Tu ne corriges jamais l'application. Un bug ou un comportement bizarre, c'est pour l'administrateur.
- Tu te bases UNIQUEMENT sur le guide ci-dessous. Si tu n'es pas sûr, ou si la réponse n'y est pas, dis-le franchement (« je ne suis pas sûr de cette partie ») et propose de prévenir l'administrateur. N'invente jamais un bouton, un menu ou une procédure.
- Dès qu'il s'agit d'un bug, d'une erreur, d'une donnée qui semble fausse, d'une réservation à supprimer ou à changer en cas de doute, ou si la personne est bloquée après deux essais : mets escalate à true et invite-la à toucher le bouton « Prévenir l'administrateur ».
- Ne demande jamais de mot de passe ni de donnée personnelle de client.
- Tu réponds en français, avec politesse et chaleur, en vouvoyant.

GUIDE DE L'APPLICATION
${APP_GUIDE}`
}

const REPLY_TOOL = {
  name: 'reply',
  description: "Réponse affichée à l'utilisateur dans le panneau d'aide.",
  input_schema: {
    type: 'object',
    properties: {
      texte: { type: 'string', description: "Ta réponse, 2 à 4 phrases simples." },
      escalate: { type: 'boolean', description: "true si l'administrateur doit être prévenu (bug, doute, blocage)." },
    },
    required: ['texte', 'escalate'],
  },
}

async function handleChat(body: { messages?: { role: string; content: string }[] }, who: { userId: string; name: string }) {
  if (!API_KEY) return json({ error: 'assistant_not_configured' }, 503)
  if (limited(chatHits, who.userId, 10 * 60_000, 40)) return json({ error: 'rate_limited' }, 429)

  const messages = (body.messages ?? [])
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
    .slice(-MAX_MESSAGES)
  while (messages.length && messages[0].role !== 'user') messages.shift()
  if (!messages.length) return json({ error: 'no_message' }, 400)

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system: systemPrompt(who.name),
      messages,
      tools: [REPLY_TOOL],
      tool_choice: { type: 'tool', name: 'reply' },
    }),
  })
  if (!r.ok) { console.error('anthropic error', r.status, await r.text()); return json({ error: 'ai_error' }, 502) }
  const data = await r.json()
  const block = (data.content ?? []).find((b: { type: string }) => b.type === 'tool_use')
  const texte = String(block?.input?.texte ?? '').trim()
  if (!texte) return json({ error: 'empty' }, 502)
  return json({ texte, escalate: block?.input?.escalate === true })
}

async function handleReport(
  body: { message?: string; page?: string; conversation?: { role: string; content: string }[] },
  who: { userId: string; name: string },
) {
  const message = String(body.message ?? '').trim().slice(0, 800)
  const page = String(body.page ?? '').trim().slice(0, 80)
  if (message.length < 3) return json({ error: 'empty_message' }, 400)
  if (limited(reportHits, who.userId, 3_600_000, 5)) return json({ ok: true, throttled: true })   // don't spam the owner

  const conversation = (body.conversation ?? []).slice(-10)
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '').slice(0, 500) }))

  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/support_requests`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ from_name: who.name, from_user: who.userId, page, message, conversation }),
  })
  if (!ins.ok) { console.error('support insert failed', ins.status, await ins.text()); return json({ error: 'save_failed' }, 500) }

  // SMS to the owner (best effort — the banner in the app is the main channel)
  const sms = `🆘 Aide demandée par ${who.name || 'un utilisateur'}${page ? ` (${page})` : ''}\n${message}`
  fetch(`${SUPABASE_URL}/functions/v1/send-sms`, {
    method: 'POST', headers, body: JSON.stringify({ to: 'PILOT', message: sms.slice(0, 450) }),
  }).catch(e => console.error('support sms failed', e))
  return json({ ok: true })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const who = await authenticate(req)
    if (!who) return json({ error: 'unauthorized' }, 401)
    const body = await req.json()
    if (body.action === 'report') return await handleReport(body, who)
    return await handleChat(body, who)
  } catch (e) {
    console.error('support-assistant error', e)
    return json({ error: 'server_error' }, 500)
  }
})
