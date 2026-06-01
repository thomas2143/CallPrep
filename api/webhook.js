export const config = { api: { bodyParser: false } };

const STRIPE_WEBHOOK_SECRET = 'whsec_TUbR9aRJ9TZVmL83sz70sTxXMOiAK5eB';
const SUPABASE_URL = 'https://ybqqgtabxejwzuxjnsim.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlicXFndGFieGVqd3p1eGpuc2ltIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDMyMDE0NiwiZXhwIjoyMDk1ODk2MTQ2fQ.bcFUBCLecx2A7tYX5ybRA3C1s7FmyMM7kcryEmvYMvY';

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    const { createHmac } = await import('crypto');
    const parts = sig.split(',').reduce((acc, part) => {
      const [key, val] = part.split('=');
      acc[key] = val;
      return acc;
    }, {});

    const timestamp = parts.t;
    const expectedSig = parts.v1;
    const payload = `${timestamp}.${buf.toString()}`;
    const hmac = createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(payload).digest('hex');

    if (hmac !== expectedSig) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    event = JSON.parse(buf.toString());
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const subscription = event.data.object;
  const customerEmail = subscription.customer_email || 
    (subscription.customer_details && subscription.customer_details.email);

  if (!customerEmail) {
    return res.status(200).json({ received: true, note: 'No email found' });
  }

  let plan = 'free';
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    plan = subscription.status === 'active' ? 'pro' : 'free';
  } else if (event.type === 'customer.subscription.deleted') {
    plan = 'free';
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(customerEmail)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ plan, briefs_count: plan === 'pro' ? 0 : undefined })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: err });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  return res.status(200).json({ received: true, plan });
}
