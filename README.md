# Debrief

Pre-call briefs for Customer Success Managers. Paste raw account notes — emails,
call logs, tickets — and get back a structured brief: chronological timeline,
open commitments, risk signals, and questions tailored to that account.

Live: https://call-prep-uokh.vercel.app

No account needed to try it. Sign in to keep history across devices.

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

A **weekly debrief** view runs the same pipeline across the whole portfolio.

## Stack

- Static HTML front end, no build step, no framework
- Vercel serverless functions (`/api`) — the browser never holds a provider key
- Groq (`openai/gpt-oss-120b`) for generation
- Supabase for auth, accounts and sessions
- Stripe for the paid plan, with a webhook writing the plan server-side

## Design decisions

**The model key never reaches the browser.** Every provider call goes through a
serverless function. `lib/guard.js` holds the checks that run before any handler:
CORS, session verification, origin verification, rate limit. Adding an endpoint
is one line rather than another copy of the same four checks — and a forgotten
copy is exactly how an endpoint ends up open.

**Anonymous access is allowed, but bounded.** A visitor should be able to try the
tool without creating an account, so unauthenticated requests are accepted on two
conditions: the request must originate from the deployed front end, and the
caller's IP must be under the free-brief ceiling. Signed-in requests skip both and
are checked against the Supabase session instead.

That rate limit is best-effort and the code says so. The counter lives in memory,
so it resets on cold start and is not shared between instances. The real
protection against direct abuse is the origin check; the counter is friction. A
reliable limit would need a shared store such as Upstash Redis. Known trade-off,
not an oversight.

**Reasoning models need their own token budget.** `gpt-oss-120b` spends tokens
thinking before it answers, and that spending comes out of the same `max_tokens`
allowance as the response. A budget that comfortably fits the output is not
enough: on long notes the model exhausts it mid-reasoning, returns
`finish_reason: "length"`, and `content` comes back empty. The fix is three-part —
`reasoning_effort: "low"` to spend less, `include_reasoning: false` to keep the
thinking out of the payload, and a token floor enforced server-side so a small
client-side value cannot reintroduce the problem. An empty response still gets one
retry at the ceiling before the endpoint gives up with the actual
`finish_reason` in the error, because "Unexpected end of JSON input" tells the
user nothing.

**Output is parsed, not displayed raw.** The prompt fixes a JSON schema and
temperature sits at 0.1. When a response still comes back truncated,
`repairTruncatedJson` walks the string tracking quote and escape state, keeps a
stack of open braces and brackets, and closes them in the right order. Counting
braces with a regex is not enough — a brace inside a string value breaks it. A
brief that renders imperfectly is more useful than an error message.

**Input is truncated at the boundary, not at the model.** Notes are cut to 8000
characters server-side. Cost and latency stay bounded regardless of what gets
pasted in.

**Plan state is written by Stripe, not by the client.** The browser never grants
itself a plan; `api/webhook.js` verifies the Stripe signature with an HMAC and
patches the `profiles` row using the service role key. The front end only reads
what the webhook wrote.

## Endpoints

| Route | Purpose | Wired to UI |
|---|---|---|
| `POST /api/groq` | brief and weekly debrief generation | yes |
| `POST /api/webhook` | Stripe subscription events | yes |
| `POST /api/call-prep` | brief with the prompt held server-side | not yet |
| `POST /api/watchlist` | portfolio triage across all accounts | not yet |
| `POST /api/call-summary` | decisions and commitments from a transcript | not yet |
| `POST /api/followup` | follow-up email draft | not yet |

The four unwired routes are deployed and guarded, not dead — they are the next
features, and they run behind the same checks as everything else.

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
ALLOWED_ORIGIN        deployed front-end origin, no trailing slash
```

Set these in Vercel, then deploy. No build step — the static files are served as
they are.

## Known limits

- The anonymous rate limit is in-memory and resets on cold start (see above).
- The signed-in free-brief counter is enforced in the interface, not in the API.
  It discourages, it does not prevent.
- `api/groq.js` still carries its own copy of the guard logic instead of importing
  `lib/guard.js`. It works, it is duplication, and it is next on the list.
- Timeline dates are taken from the notes as written. Undated notes produce
  undated entries.

## Author

Thomas Hotton — https://thomas2143.github.io/Portfolio
