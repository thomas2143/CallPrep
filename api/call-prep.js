export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { notes, account, callType, mode } = req.body;
  if (!notes) return res.status(400).json({ error: 'Missing notes' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });
  const prompt = `You are a senior Customer Success Manager. Analyze the notes and return ONLY valid JSON, no markdown, no backticks, no extra text.

ACCOUNT: ${account || 'Unknown'}
CALL TYPE: ${callType || 'QBR'}

NOTES:
${notes.slice(0, 8000)}

Return this exact JSON structure:
{"account_name":"string","call_type":"string","account_read":"2-3 sentences honest CSM reading of this account","sentiment":"positive|neutral|concerned|at-risk","sentiment_reason":"one sentence","opening_line":"perfect first sentence for the call max 25 words","timeline":[{"date":"string","type":"call|email|ticket|commitment|win|risk","title":"max 6 words","detail":"one sentence","flag":"open_commitment|risk|win|neutral"}],"open_commitments":[{"what":"string","promised_on":"string","promised_by":"CSM|client|unknown","status":"overdue|pending|unclear","urgency":"high|medium|low"}],"risk_signals":[{"signal":"string","why_it_matters":"one sentence"}],"questions_to_ask":[{"question":"specific question for this account","why":"one sentence"}],"dont_forget":"single most important thing for this call"}`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 2000,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || 'Groq API error' });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const clean = text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch(e) {
      const opens = (clean.match(/\{/g) || []).length;
      const closes = (clean.match(/\}/g) || []).length;
      const arrOpens = (clean.match(/\[/g) || []).length;
      const arrCloses = (clean.match(/\]/g) || []).length;
      let recovered = clean.replace(/,\s*\]/g, ']').replace(/,\s*\}/g, '}');
      for (let i = 0; i < arrOpens - arrCloses; i++) recovered += ']';
      for (let i = 0; i < opens - closes; i++) recovered += '}';
      parsed = JSON.parse(recovered);
    }

    return res.status(200).json(parsed);

  } catch (e) {
    return res.status(500).json({ error: e.message || 'Something went wrong' });
  }
}
