export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { account, callType, commitments, risks, nextSteps } = req.body;
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
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        max_tokens: 800,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const clean = text.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      const opens = (clean.match(/\{/g) || []).length;
      const closes = (clean.match(/\}/g) || []).length;
      let rec = clean.replace(/,\s*\]/g, ']').replace(/,\s*\}/g, '}');
      for (let i = 0; i < opens - closes; i++) rec += '}';
      parsed = JSON.parse(rec);
    }
    return res.status(200).json(parsed);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
