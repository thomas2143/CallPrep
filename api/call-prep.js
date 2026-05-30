export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { notes, account, callType } = req.body;
  if (!notes) return res.status(400).json({ error: 'Missing notes' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const prompt = `You are a senior Customer Success Manager preparing for an important client call. Analyze the raw notes below and generate a structured pre-call brief.

ACCOUNT: ${account || 'Unknown'}
CALL TYPE: ${callType || 'QBR'}

RAW NOTES (emails, call notes, tickets — all mixed, unordered):
${notes.slice(0, 12000)}

Extract ALL dated events and return ONLY valid JSON, no markdown, no preamble, no backticks:

{
  "account_name": "inferred or provided account name",
  "call_type": "QBR | Renewal | Check-in | Escalation | Expansion",
  "account_read": "2-3 sentences. Honest CSM reading of this account right now — is it healthy, drifting, at risk, ready to expand? Write like a senior CSM talking to a colleague, not a report.",
  "timeline": [
    {
      "date": "date as written in notes",
      "type": "call | email | ticket | commitment | win | risk",
      "title": "short title max 8 words",
      "detail": "one sentence with the key detail",
      "flag": "open_commitment | risk | win | neutral"
    }
  ],
  "open_commitments": [
    {
      "what": "what was promised",
      "promised_on": "date",
      "promised_by": "CSM | client | unknown",
      "status": "overdue | pending | unclear",
      "urgency": "high | medium | low"
    }
  ],
  "risk_signals": [
    {
      "signal": "specific signal from the notes",
      "why_it_matters": "one sentence on the CSM implication"
    }
  ],
  "questions_to_ask": [
    {
      "question": "specific question tailored to THIS account based on the notes",
      "why": "why this question matters for this account right now"
    }
  ],
  "dont_forget": "one critical thing the CSM must address in this call — the most important thing hidden in the notes"
}

Rules:
- Sort timeline chronologically oldest first
- Only extract events that have a date or clear temporal marker
- Open commitments = things explicitly promised that have no resolution in the notes
- Risk signals = patterns, silences, repeated frustrations, sponsor changes, budget mentions
- Questions must be specific to THIS account not generic
- dont_forget must be the single most important thing
- Write in the voice of a senior CSM not a report generator`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 3000,
        temperature: 0.2,
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
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);

  } catch (e) {
    return res.status(500).json({ error: e.message || 'Something went wrong' });
  }
}
