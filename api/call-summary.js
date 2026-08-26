import { guard, parseModelJson, MODEL } from '../lib/guard.js';

export default async function handler(req, res) {
  if (await guard(req, res)) return;

  const { transcript, account } = req.body || {};
  if (!transcript) return res.status(400).json({ error: 'Missing transcript' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const prompt = `You are a senior CSM summarizing a client call transcript for ${account || 'a client'}.

TRANSCRIPT:
${String(transcript).slice(0, 8000)}

Extract the key information and return ONLY valid JSON, no markdown, no backticks:
{
  "decisions": ["decision 1", "decision 2"],
  "commitments": ["commitment with owner and deadline if mentioned", "commitment 2"],
  "next_steps": ["concrete next step 1", "next step 2"],
  "key_quote": "most important thing the client said — verbatim if possible",
  "sentiment": "positive|neutral|concerned|at-risk",
  "one_liner": "one sentence summary of the call outcome"
}`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        temperature: 0.2,
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
    return res.status(500).json({ error: e.message });
  }
}
