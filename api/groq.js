const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const ALLOWED_MODELS = ['openai/gpt-oss-120b'];
const MAX_TOKENS_CAP = 4000;
const MAX_PROMPT_CHARS = 12000;

export default async function handler(req, res) {
  if (ALLOWED_ORIGIN) res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const check = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (!check.ok) return res.status(401).json({ error: 'Invalid session' });
  } catch (e) {
    return res.status(401).json({ error: 'Auth check failed' });
  }

  const { model, max_tokens, temperature, messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Missing messages' });
  }
  const totalChars = messages.reduce((n, m) => n + String(m?.content || '').length, 0);
  if (totalChars > MAX_PROMPT_CHARS) {
    return res.status(413).json({ error: 'Prompt too large' });
  }

  const safeModel = ALLOWED_MODELS.includes(model) ? model : ALLOWED_MODELS[0];
  const safeTokens = Math.min(Number(max_tokens) || 1000, MAX_TOKENS_CAP);
  const safeTemp = Number.isFinite(Number(temperature)) ? Number(temperature) : 0.1;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: safeModel,
        max_tokens: safeTokens,
        temperature: safeTemp,
        messages: messages.map(m => ({ role: m.role, content: String(m.content || '') }))
      })
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
