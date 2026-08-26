# Debrief

Pre-call briefs for Customer Success Managers. Paste raw account notes — emails,
call logs, tickets — and get back a structured brief: chronological timeline,
open commitments, risk signals, and questions tailored to that account.

Live: https://call-prep-dusky.vercel.app

## Why it exists

Before a QBR a CSM reconstructs account history by hand, scrolling through
threads and tickets. The information already exists; it is just scattered and
unordered. The tool does the reconstruction, not the judgement.

## What it produces

One POST returns a single JSON object with a fixed shape:

| Field | Content |
|---|---|
| `account_read` | 2-3 sentence reading of where the account stands |
| `sentiment` | `positive` / `neutral` / `concerned` / `at-risk`, with a reason |
| `opening_line` | first sentence to open the call with |
| `timeline` | dated events, each flagged as commitment, risk, win or neutral |
| `open_commitments` | what was promised, by whom, overdue or pending |
| `risk_signals` | signal plus why it matters |
| `questions_to_ask` | account-specific questions, each with a rationale |
| `dont_forget` | the single most important item for this call |

Two other views are built on the same base: a **weekly debrief** across the whole
portfolio, and a **watchlist** that ranks accounts by what needs attention this
week.

## Stack

- Static HTML front end, no build step, no framework
- Vercel serverless functions (`/api`) — the browser never holds a provider key
- Groq (`openai/gpt-oss-120b`) for generation
- Supabase for auth, accounts and sessions
- Stripe for the paid plan, with a webhook writing the plan server-side

## Design decisions

**The model key never reaches the browser.** Every provider call goes through a
serverless function. `api/groq.js` additionally requires a valid Supabase
session, restricts the model to a whitelist, and caps both token count and
prompt size — otherwise a public endpoint holding a key is a public endpoint
spending someone else's money.

**Output is parsed, not displayed raw.** The prompt fixes a JSON schema and
temperature sits at 0.1. When a response still comes back truncated, the parser
counts unclosed braces and brackets, trims trailing commas, and closes the
structure before a second parse attempt. A brief that renders imperfectly is
more useful than an error message.

**Input is truncated at the boundary, not at the model.** Notes are cut to 8000
characters server-side. Cost and latency stay bounded regardless of what gets
pasted in.

**Plan state is written by Stripe, not by the client.** The browser never grants
itself a plan; `api/webhook.js` verifies the Stripe signature with an HMAC and
patches the `profiles` row using the service role key. The front end only reads
what the webhook wrote.

## Endpoints

| Route | Purpose |
|---|---|
| `POST /api/call-prep` | full pre-call brief from raw notes |
| `POST /api/groq` | authenticated passthrough for weekly debrief |
| `POST /api/watchlist` | portfolio triage across all accounts |
| `POST /api/call-summary` | decisions and commitments from a transcript |
| `POST /api/followup` | follow-up email draft |
| `POST /api/webhook` | Stripe subscription events |

## Data model

Three Supabase tables: `profiles` (plan and usage), `accounts` (name, call type,
last context), `sessions` (notes per account, dated). Accounts are also mirrored
to `localStorage` so the tool works before sign-in.

## Running it

```
GROQ_API_KEY          server-side, Groq console
SUPABASE_URL          project URL
SUPABASE_ANON_KEY     public key, used to verify sessions
SUPABASE_SERVICE_KEY  webhook only, never client-side
STRIPE_WEBHOOK_SECRET webhook signature verification
ALLOWED_ORIGIN        deployed front-end origin
```

Set these in Vercel, then deploy. No build step — the static files are served as
they are.

## Known limits

- The free-tier brief counter is enforced in the interface, not in the API. It
  discourages, it does not prevent.
- `api/call-summary` and `api/followup` are implemented and deployed but not yet
  wired into the interface.
- Timeline dates are taken from the notes as written. Undated notes produce
  undated entries.

## Author

Thomas Hotton — https://thomas2143.github.io/Portfolio
