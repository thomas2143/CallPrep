import { guard, parseModelJson, MODEL } from '../lib/guard.js';

export default async function handler(req, res) {
  if (await guard(req, res)) return;

  const { account, callType, commitments, risks, nextSteps } = req.body || {};

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const prompt = `You are a senior CSM writing a professional follow-up email after a ${callType || 'QBR'} call with ${account || 'the client'}.

Open commitments: ${commitments || 'none noted'}
Risk signals: ${risks || 'none noted'}
Next steps: ${nextSteps || 'none noted'}

Write a concise, warm, professional follow-up email. Include a thank you, summary of decisions, clear next steps with owners, and a closing that reinforces the partnership.

Return ONLY valid JSON, no markdown, no backticks:
{"subject":"email subject line","email":"full email body in plain text with line breaks"}`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        temperature: 0.3,
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
