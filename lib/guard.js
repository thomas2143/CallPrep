// Garde-fous partagés par toutes les fonctions serverless.
// Objectif : aucune route ne doit exposer la clé Groq sans contrôle.

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export const MODEL = 'openai/gpt-oss-120b';

const ANON_LIMIT = 10;
const ANON_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

// Best-effort : en mémoire, donc réinitialisé à chaque cold start / instance.
// C'est une friction supplémentaire, pas une garantie — le vrai garde-fou
// anti-abus reste la vérification d'origine. Pour une limite fiable
// multi-instance, il faudrait un store partagé (ex. Upstash Redis).
const anonHits = new Map();

function checkAnonRateLimit(ip) {
  const now = Date.now();
  const entry = anonHits.get(ip);
  if (!entry || now - entry.start > ANON_WINDOW_MS) {
    anonHits.set(ip, { start: now, count: 1 });
    return true;
  }
  if (entry.count >= ANON_LIMIT) return false;
  entry.count++;
  return true;
}

export function setCors(res) {
  if (ALLOWED_ORIGIN) res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Retourne null si la requête peut continuer, sinon termine la réponse.
// Usage : if (await guard(req, res)) return;
export async function guard(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return true; }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (token) {
    try {
      const check = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
      });
      if (!check.ok) { res.status(401).json({ error: 'Invalid session' }); return true; }
    } catch (e) {
      res.status(401).json({ error: 'Auth check failed' }); return true;
    }
    return false;
  }

  // Accès anonyme : la requête doit venir du site lui-même.
  const origin = req.headers.origin || req.headers.referer || '';
  if (ALLOWED_ORIGIN && !origin.startsWith(ALLOWED_ORIGIN)) {
    res.status(403).json({ error: 'Origin not allowed' }); return true;
  }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || 'unknown';
  if (!checkAnonRateLimit(ip)) {
    res.status(429).json({ error: 'Free limit reached — sign in to continue' });
    return true;
  }
  return false;
}

// Ferme un JSON tronqué : suit l'état de chaîne et d'échappement, empile les
// ouvrants et referme dans le bon ordre. Un brief imparfait vaut mieux qu'une
// erreur de parsing.
export function repairTruncatedJson(raw) {
  let out = '', inStr = false, esc = false;
  const stack = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    out += ch;
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, '');
  for (let j = stack.length - 1; j >= 0; j--) out += (stack[j] === '{' ? '}' : ']');
  return out;
}

export function parseModelJson(text) {
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    return JSON.parse(repairTruncatedJson(clean));
  }
}
