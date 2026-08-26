import { guard, parseModelJson, MODEL } from '../lib/guard.js';

export default async function handler(req, res) {
  if (await guard(req, res)) return;

  const { accountSummaries, today } = req.body || {};
  if (!accountSummaries) return res.status(400).json({ error: 'Missing account data' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const prompt = `You are a senior CSM analyzing a portfolio of accounts. Based on the notes below, identify which accounts need attention THIS WEEK and why.

${String(accountSummaries).slice(0, 10000)}

Today is ${today}.

Return ONLY valid JSON, no markdown, no backticks:
{"watchlist":[{"account":"account name","priority":"high|medium|low","reason":"one sentence — specific signal from the notes that makes this account need attention now","action":"one concrete action to take this week — max 8 words"}]}

Rules:
- Include ALL accounts, sorted by priority (high first)
- high = renewal risk, unresolved escalation, sponsor change, overdue commitment, silent client
- medium = no recent contact, upcoming renewal in 30-60 days, pending commitment
- low = healthy account, no immediate action needed
- reason must reference something specific from the notes
- action must be concrete and specific to this account`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || 'Groq API error' });
    }

    const data = await response.json();
    const parsed = parseModelJson(data.choices?.[0]?.message?.content);
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Something went wrong' });
  }
}
