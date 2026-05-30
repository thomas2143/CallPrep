export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { transcript, account } = req.body;
  if (!transcript) return res.status(400).json({ error: 'Missing transcript' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const prompt = `You are a senior CSM summarizing a client call transcript for ${account || 'a client'}.

TRANSCRIPT:
${transcript.slice(0, 8000)}

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
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 800,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const clean = text.replace(/```json|```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch(e) {
      const opens = (clean.match(/\{/g)||[]).length;
      const closes = (clean.match(/\}/g)||[]).length;
      let rec = clean.replace(/,\s*\]/g,']').replace(/,\s*\}/g,'}');
      for(let i=0;i<opens-closes;i++) rec+='}';
      parsed = JSON.parse(rec);
    }
    return res.status(200).json(parsed);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
