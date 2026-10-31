// Supabase Edge Function — booking-assistant
// Conversational assistant of the public booking page ("la mascotte").
// It only talks: it collects date / passengers / contact and proposes a flight plan from the
// free slots the page sends. It has NO database access — the booking itself is created by the
// regular booking form (with its checks and the SMS verification code).
//
// Secrets to set (Supabase → Edge Functions → Secrets, or `supabase secrets set`):
//   ANTHROPIC_API_KEY   (required)  — developer key from console.anthropic.com
//   ASSISTANT_MODEL     (optional)  — defaults to claude-haiku-5-5
//
// Deploy:  supabase functions deploy booking-assistant
// (The page calls it with the public anon key, like send-sms.)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const MODEL   = Deno.env.get('ASSISTANT_MODEL') ?? 'claude-haiku-5-5'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

// ── Abuse guards (this endpoint is public and each call costs a little) ──────
const MAX_MESSAGES = 30          // messages kept per conversation
const MAX_CHARS    = 700         // per message
const RATE_WINDOW  = 10 * 60_000 // 10 minutes
const RATE_MAX     = 60          // calls per IP per window (best effort, per instance)
const hits = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const list = (hits.get(ip) ?? []).filter(t => now - t < RATE_WINDOW)
  list.push(now)
  hits.set(ip, list)
  return list.length > RATE_MAX
}

const POSES = [
  'salut', 'bienvenue', 'je-t-ecoute', 'sourire', 'je-reflechis', 'recherche', 'creneau-trouve',
  'je-montre', 'prise-reservation', 'reservation-confirmee', 'pouce', 'pas-disponible',
  'tout-est-dispo', 'montre-telephone', 'observation-meteo', 'infos-spot', 'je-t-explique',
  'camera', 'a-bientot', 'merci', 'bras-croises', 'controle-voile', 'check-materiel',
]


// Structured output: forcing a tool call guarantees valid, complete JSON (no hand-written JSON to parse)
const REPLY_TOOL = {
  name: 'reply',
  description: "Réponse affichée au client dans l'assistant de réservation.",
  input_schema: {
    type: 'object',
    properties: {
      texte: { type: 'string', description: 'Ce que tu dis au client (1 à 3 phrases).' },
      pose: { type: 'string', enum: POSES, description: 'Pose de la mascotte.' },
      suggestions: { type: 'array', items: { type: 'string' }, description: '0 à 3 réponses courtes cliquables.' },
      draft: {
        type: ['object', 'null'],
        description: 'Brouillon de réservation, mis à jour à chaque réponse dès que la date ou les passagers sont connus.',
        properties: {
          date: { type: ['string', 'null'], description: 'AAAA-MM-JJ' },
          passengers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['adult', 'child'] },
                first_name: { type: 'string' },
                age: { type: ['number', 'null'] },
                weight_kg: { type: ['number', 'null'] },
                flight: { type: 'string', enum: ['discovery', 'performance'] },
                slot: { type: ['string', 'null'], description: 'HH:MM' },
              },
              required: ['kind', 'flight'],
            },
          },
          contact_name: { type: 'string' },
          phone: { type: 'string' },
          ready: { type: 'boolean' },
        },
      },
      callback: {
        type: ['object', 'null'],
        description: 'Demande de rappel par un moniteur (une seule fois, quand nom + téléphone sont connus).',
        properties: {
          name: { type: 'string' },
          phone: { type: 'string' },
          note: { type: 'string', description: 'Résumé pour le moniteur.' },
        },
        required: ['name', 'phone', 'note'],
      },
    },
    required: ['texte', 'pose'],
  },
}

function systemPrompt(today: string, slots: Record<string, string[]>): string {
  const free = Object.entries(slots)
    .map(([d, t]) => `${d} : ${t.length ? t.join(', ') : 'complet'}`)
    .join('\n')

  return `Tu es l'assistant de réservation de Planète Parapente Réunion (Saint-Leu, île de La Réunion), dans la page de réservation en ligne.
Langue du client (français par défaut), vouvoiement sauf si le client tutoie. Ton chaleureux, direct, efficace. Réponses COURTES : 1 à 3 phrases, pas de listes. Tu ne donnes jamais d'avis médical.
Aujourd'hui : ${today}.

OBJECTIF : conduire le client à une réservation le plus VITE possible, en un minimum de messages. Le client peut tout dire d'un coup (« on est deux adultes, 65 et 90 kg, une découverte et une performance, jeudi ») : exploite TOUT ce qu'il donne et ne redemande jamais une information déjà fournie. Pose UNE seule question à la fois, mais regroupe ce qui manque dans cette question. Hors sujet : une phrase de réponse puis retour à la réservation.

══ TUNNEL DE RÉSERVATION ══
Passe les étapes dans l'ordre, en sautant celles dont tu as déjà la réponse.

ÉTAPE 1 — LE GROUPE. Demande en une fois : « Combien de personnes êtes-vous, y a-t-il des enfants (moins de 14 ans), et quel est le poids approximatif de chacun ? ». Un poids approximatif suffit (en kg).
  • Si des enfants : demande l'âge ET le poids de chaque enfant.
  • Adultes : demande le poids de chaque adulte s'il manque.

ÉTAPE 2 — LES TYPES DE VOL (adultes et personnes de 14 ans et plus uniquement). Demande pour chacun : vol découverte (≈20 min) ou vol performance (30 à 45 min, sensations plus fortes) ? Les enfants de moins de 14 ans n'ont PAS le choix : vol marmaille (découverte, 80 €). Ne leur pose pas la question.

ÉTAPE 3 — LA DATE. Si le client ne l'a pas donnée, demande-la (ou « jour », « week-end »…). S'il dit « dès que possible » ou n'a pas de préférence, cherche toi-même dans les créneaux libres le premier jour où un plan complet est possible.

ÉTAPE 4 — LE PLAN. Dès que tu as groupe + vols + date, propose DIRECTEMENT un plan précis (qui vole à quelle heure, avec qui) basé sur les créneaux libres, sans demander d'autre confirmation préalable. Termine par « Est-ce que cela vous convient ? ». Mets des suggestions cliquables (« Oui, parfait », « Un autre horaire », « Un autre jour »).

ÉTAPE 5 — LE CONTACT. Quand le plan est accepté, demande en UNE question : « Votre prénom, nom et numéro de téléphone ? ». Dès que tu les as, dis que tu prépares la réservation et mets "ready": true.

Cas rapide (aucun enfant, tout est dit en un message) : va directement à l'étape 4 avec un créneau précis.

══ RÈGLES MÉTIER (strictes) ══
POIDS
- Entre 18 kg et 100 kg uniquement (assurance). Au-dessus de 100 kg : impossible, dis-le avec tact. En dessous de 18 kg : impossible.
- Créneau de 8h00 : découverte ou marmaille uniquement, passagers légers (≤ 75 kg). Entre 76 et 85 kg, possible à 8h mais prévenir : le vol sera plus court et moins agréable (descente plus rapide) ; le créneau suivant lui convient mieux. Au-delà de 85 kg : pas à 8h.
- Créneaux de 9h15 et après : découverte ou performance, jusqu'à 100 kg.
- Un adulte lourd (> 75 kg) volant à côté d'un passager léger (< 65 kg) en découverte : le prévenir qu'il descendra plus vite.
ENFANTS ET MARMAILLE
- Moins de 14 ans = enfant = vol marmaille (découverte, 80 €), JAMAIS de vol performance. Le vol performance est ouvert à partir de 14 ans.
- Âge minimum : 6 ans. Un enfant de moins de 20 kg vole uniquement à 8h00.
- Le vol marmaille se fait en priorité à 8h00 (brise douce). Un enfant de 20 kg ou plus peut voler après 8h00 seulement si 8h00 est complet ou si cela permet d'organiser le groupe sans laisser un enfant seul.
- Un enfant ne reste JAMAIS seul : à tout moment, un enfant qui attend au sol ou à l'atterrissage est avec un adulte de son groupe, et un enfant qui vole a un adulte de son groupe qui vole dans le même créneau (côte à côte) ou qui l'attend à l'atterrissage. Autorisation parentale demandée dans le formulaire.
CRÉNEAUX ET MONITEURS
- Un même créneau accepte jusqu'à 4 vols SIMULTANÉS (plusieurs moniteurs en même temps) : ne dis jamais qu'il n'y a qu'un moniteur. Un parent et son enfant peuvent voler côte à côte dans le même créneau. Un groupe de plus de 4 est réparti sur plusieurs créneaux.
- Si un plan demande plusieurs moniteurs à une heure donnée, c'est possible : note-le pour le moniteur (« prévoir N moniteurs à HH:MM ») sans en faire un problème pour le client.
TARIFS
- Marmaille (< 14 ans) 80 € ; découverte 90 € ; performance 110 à 120 € ; photos +10 € ; photos + vidéo +20 €. Paiement à la fin du vol, pas d'acompte.
DIVERS
- Un moniteur valide la réservation ou rappelle directement le client. Ne promets rien d'autre. Vol annulé pour la météo : reporté sans frais.
- Tu ne connais PAS : le point de rendez-vous exact, la météo, les cas médicaux. Dis que le moniteur le précisera. N'invente jamais d'information.

══ COMPOSER LE PLAN (méthode à suivre à chaque fois) ══
1. Contraintes dures d'abord : enfant < 20 kg → 8h00 ; adulte > 85 kg → pas 8h00 ; performance → jamais 8h00, jamais un enfant < 14 ans.
2. Préfère GROUPER tout le monde dans le même créneau (≤ 4 vols) : c'est le plus simple pour le client. Choisis le premier créneau libre qui convient à tous. Exemple : un couple 65 kg + 90 kg, une découverte et une performance → même créneau à 9h15 (ou le premier créneau libre à partir de 9h15).
3. Si le groupe ne peut pas voler ensemble (typiquement : enfant < 20 kg à 8h00 + adulte lourd ou performance après), répartis en créneaux successifs en alternant les parents pour que l'enfant ne soit jamais seul. Exemple : papa 90 kg, maman 65 kg, enfants 20 kg et 45 kg → 8h00 : maman + enfant de 20 kg côte à côte, pendant que papa attend avec l'enfant de 45 kg ; 9h15 : papa + enfant de 45 kg, pendant que maman attend avec le plus jeune.
4. Vérifie sur la date demandée avec les créneaux LIBRES uniquement. Si ça ne marche pas, cherche une autre combinaison, puis un autre jour proche (propose-en un précis). Ne propose le rappel par un moniteur QUE si rien ne marche vraiment ou si le client le demande.
5. Annonce le plan clairement : qui vole à quelle heure, avec qui, qui attend avec qui, et le prix total.

DISPONIBILITÉS RÉELLES (seuls ces créneaux sont libres ; n'en propose jamais d'autres, ne t'engage jamais sur un créneau absent de cette liste) :
${free}

DEMANDE DE RAPPEL : si aucun plan ne convient (même après avoir cherché), ou si le client demande à être rappelé / à parler à un moniteur, propose qu'un moniteur le rappelle. Demande en UNE question son prénom, nom et numéro de téléphone (si pas déjà donnés). Dès que tu as les deux, remplis "callback" UNE SEULE FOIS et dis « Votre demande est transmise, un moniteur vous rappelle très vite ». Dans "callback.note", résume pour le moniteur : composition du groupe (adultes/enfants, âges, poids), vols souhaités, date voulue, pourquoi aucun créneau n'a convenu. Ne promets aucune heure de rappel précise. N'écris « transmise » que si tu remplis "callback" dans cette même réponse.

FORMAT DE RÉPONSE : tu réponds TOUJOURS en appelant l'outil « reply » (texte pour le client, pose de la mascotte, suggestions cliquables, brouillon de réservation, demande de rappel).
- "draft" : renseigne-le dès que tu connais la date ou des passagers, et mets-le à jour à chaque réponse (garde ce que tu savais déjà). Un passager par personne, avec le créneau choisi dans "slot". "ready" vaut true seulement quand le plan est accepté et que nom + téléphone sont connus.
- Ne mets jamais de poids ou d'âge inventés : null si inconnu.
- Enfants de moins de 14 ans : "kind": "child" et "flight": "discovery". Personnes de 14 ans et plus : "kind": "adult".
- "suggestions" : 0 à 3 réponses courtes qui font gagner du temps (ex. « Découverte pour tous », « Performance pour tous », « 1 découverte + 1 performance », « Oui, parfait »).`
}

// ── Callback requests ────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const cbHits = new Map<string, number[]>()   // anti-spam: max 3 callback requests / hour / IP

async function saveCallback(
  cb: { name?: string; phone?: string; note?: string },
  draft: Record<string, unknown> | null,
  ip: string,
): Promise<boolean> {
  try {
    const name  = String(cb.name ?? '').trim().slice(0, 80)
    const phone = String(cb.phone ?? '').trim().slice(0, 30)
    const note  = String(cb.note ?? '').trim().slice(0, 600)
    if (name.length < 2 || phone.replace(/\D/g, '').length < 8) return false
    if (!SUPABASE_URL || !SERVICE_KEY) { console.error('callback: missing service role env'); return false }

    const now = Date.now()
    const recent = (cbHits.get(ip) ?? []).filter(t => now - t < 3_600_000)
    if (recent.length >= 3) return true            // already saved earlier, don't spam the pilot
    cbHits.set(ip, [...recent, now])

    const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }

    // Same phone already waiting for a call → don't create (or SMS) a duplicate
    const dup = await fetch(
      `${SUPABASE_URL}/rest/v1/callback_requests?status=eq.new&contact_phone=eq.${encodeURIComponent(phone)}&select=id&limit=1`,
      { headers })
    if (dup.ok && (await dup.json()).length) return true

    const wanted = typeof draft?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(draft.date as string) ? draft.date : null
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/callback_requests`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ contact_name: name, contact_phone: phone, wanted_date: wanted, summary: note, draft: draft ?? null }),
    })
    if (!ins.ok) { console.error('callback insert failed', ins.status, await ins.text()); return false }

    // SMS to the pilot (best effort — the banner in the app is the main channel)
    const sms = `📞 Rappel demandé\n${name} — ${phone}\n${note}${wanted ? `\nDate voulue : ${wanted}` : ''}`
    fetch(`${SUPABASE_URL}/functions/v1/send-sms`, {
      method: 'POST', headers, body: JSON.stringify({ to: 'PILOT', message: sms.slice(0, 450) }),
    }).catch(e => console.error('callback sms failed', e))
    return true
  } catch (e) {
    console.error('saveCallback error', e)
    return false
  }
}

function extractJson(text: string): Record<string, unknown> | null {
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a < 0 || b < a) return null
  try { return JSON.parse(text.slice(a, b + 1)) } catch { return null }
}

// Fallback when the JSON is cut or malformed: salvage the spoken text so the customer never
// sees raw JSON. Returns null when nothing readable can be recovered.
function salvageText(text: string): string | null {
  const m = text.match(/"texte"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (m) {
    try { return JSON.parse(`"${m[1]}"`) } catch { return m[1] }
  }
  // Not JSON at all (the model just answered in plain text)
  if (!text.trim().startsWith('{') && !text.includes('"texte"')) return text.trim() || null
  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    if (!API_KEY) {
      return new Response(JSON.stringify({ error: 'assistant_not_configured' }), { status: 503, headers: CORS })
    }
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    if (rateLimited(ip)) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: CORS })
    }

    const body = await req.json() as {
      messages?: { role: string; content: string }[]
      today?: string
      slots?: Record<string, string[]>
    }

    const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today ?? '') ? body.today! : new Date().toISOString().slice(0, 10)

    // Sanitise the slot map (dates → times) so nothing unexpected reaches the prompt
    const slots: Record<string, string[]> = {}
    for (const [d, times] of Object.entries(body.slots ?? {}).slice(0, 14)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Array.isArray(times)) continue
      slots[d] = times.filter(t => /^\d{2}:\d{2}$/.test(String(t))).slice(0, 12).map(String)
    }

    // Keep only well-formed, bounded messages; the API needs the first one to be from the user
    let messages = (body.messages ?? [])
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
      .slice(-MAX_MESSAGES)
    while (messages.length && messages[0].role !== 'user') messages.shift()
    if (!messages.length) {
      return new Response(JSON.stringify({ error: 'no_message' }), { status: 400, headers: CORS })
    }

    // Ask the model (forced tool call → structured reply). One retry if the answer is unusable.
    let out: Record<string, unknown> | null = null
    for (let attempt = 0; attempt < 2 && !out; attempt++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2000,
          system: systemPrompt(today, slots),
          messages,
          tools: [REPLY_TOOL],
          tool_choice: { type: 'tool', name: 'reply' },
        }),
      })

      if (!res.ok) {
        console.error('Anthropic error', res.status, await res.text())
        if (attempt === 1) return new Response(JSON.stringify({ error: 'upstream_error' }), { status: 502, headers: CORS })
        continue
      }

      const data = await res.json()
      const blocks: { type: string; input?: Record<string, unknown>; text?: string }[] = data.content ?? []
      const tool = blocks.find(c => c.type === 'tool_use')?.input
      const text = blocks.map(c => c.text ?? '').join('')
      const cand = tool ?? extractJson(text) ?? (salvageText(text) ? { texte: salvageText(text), pose: 'je-reflechis' } : null)
      if (cand && typeof cand.texte === 'string' && cand.texte.trim()) out = cand
      else console.error('Unusable assistant reply', attempt, data.stop_reason, JSON.stringify(data.content).slice(0, 500))
    }
    if (!out) out = { texte: "Excusez-moi, je n'ai pas bien compris. Pouvez-vous reformuler ?", pose: 'je-reflechis' }

    // Never let the model send an unknown pose id
    if (!POSES.includes(String(out.pose))) out.pose = 'sourire'

    // Callback request → stored for the pilot (banner in the app) + SMS to the pilot's phone.
    // The customer is only told "transmise" if this really worked.
    const cb = out.callback as { name?: string; phone?: string; note?: string } | null | undefined
    delete out.callback
    if (cb && typeof cb === 'object') {
      const saved = await saveCallback(cb, out.draft as Record<string, unknown> | null, ip)
      out.callback_saved = saved
      if (!saved) {
        out.texte = "Je n'ai pas réussi à transmettre votre demande. Pouvez-vous réessayer, ou nous appeler directement ? Merci !"
        out.pose = 'pas-disponible'
      }
    }

    return new Response(JSON.stringify(out), { headers: CORS })
  } catch (err) {
    console.error('booking-assistant error:', err)
    return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: CORS })
  }
})
