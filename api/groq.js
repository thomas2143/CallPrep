const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const ALLOWED_MODELS = ['openai/gpt-oss-120b'];
const MAX_TOKENS_CAP = 8000;
const MIN_TOKENS = 4000;
const MAX_PROMPT_CHARS = 12000;
const ANON_LIMIT = 10;
const ANON_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

// Best-effort : en mémoire, donc réinitialisé à chaque cold start / instance.
// C'est une couche de friction supplémentaire, pas une garantie — le vrai
// garde-fou anti-abus reste la vérification d'origine ci-dessous. Pour une
// limite fiable multi-instance, il faudrait un store partagé (ex. Upstash Redis).
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

// gpt-oss-120b est un modèle de raisonnement : ses tokens de raisonnement
// consomment le budget max_tokens et arrivent dans un champ `reasoning`
// distinct. Sans ces deux réglages, un prompt long épuise le budget en
// raisonnant et `content` revient vide (finish_reason: "length").
function buildPayload({ model, max_tokens, temperature, messages }) {
  return {
    model: ALLOWED_MODELS.includes(model) ? model : ALLOWED_MODELS[0],
    max_tokens: Math.min(Math.max(Number(max_tokens) || MIN_TOKENS, MIN_TOKENS), MAX_TOKENS_CAP),
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.1,
    reasoning_effort: 'low',
    include_reasoning: false,
    messages: messages.map(m => ({ role: m.role, content: String(m.content || '') }))
  };
}

async function callGroq(apiKey, payload) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  return { response, data };
}

export default async function handler(req, res) {
  if (ALLOWED_ORIGIN) res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (token) {
    try {
      const check = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
      });
      if (!check.ok) return res.status(401).json({ error: 'Invalid session' });
    } catch (e) {
      return res.status(401).json({ error: 'Auth check failed' });
    }
  } else {
    // Accès anonyme : on exige que la requête vienne bien du site (protège
    // contre l'appel direct de l'endpoint depuis un script tiers).
    const origin = req.headers.origin || req.headers.referer || '';
    if (ALLOWED_ORIGIN && !origin.startsWith(ALLOWED_ORIGIN)) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    if (!checkAnonRateLimit(ip)) {
      return res.status(429).json({ error: 'Free limit reached — sign in to continue' });
    }
  }

  const { model, max_tokens, temperature, messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Missing messages' });
  }
  const totalChars = messages.reduce((n, m) => n + String(m?.content || '').length, 0);
  if (totalChars > MAX_PROMPT_CHARS) {
    return res.status(413).json({ error: 'Prompt too large' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const payload = buildPayload({ model, max_tokens, temperature, messages });

  try {
    let { response, data } = await callGroq(apiKey, payload);

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'Groq API error'
      });
    }

    let choice = data.choices?.[0];
    let content = choice?.message?.content || '';

    // Le raisonnement a mangé tout le budget : une seule relance, plafond haut.
    if (!content.trim() && choice?.finish_reason === 'length') {
      const retry = await callGroq(apiKey, {
        ...payload,
        max_tokens: MAX_TOKENS_CAP
      });
      if (retry.response.ok) {
        choice = retry.data.choices?.[0];
        content = choice?.message?.content || '';
        data = retry.data;
      }
    }

    if (!content.trim()) {
      return res.status(502).json({
        error: 'Model returned no content (finish_reason: ' + (choice?.finish_reason || 'unknown') + '). Try shorter notes.'
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
