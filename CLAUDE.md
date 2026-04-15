# CLAUDE.md — Supplier Command Center
> Last updated: 2025-04-08 | Phase: Post-launch — Polish & Demo Prep

## What we're building
AI-powered supplier portal — the "other side" of Valorant's Astra procurement platform.
Suppliers manage buyer relationships, respond to RFPs, track compliance. All AI-powered.
Demo target: Biju Mohan, Co-Founder of Valorant (job application project).
Live URL: https://supplier-command-center.vercel.app

## Stack
| Layer | Tech |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind + shadcn/ui |
| Backend | Node.js + Express |
| Database | Supabase (PostgreSQL + Auth + Storage + RLS) |
| AI | Claude API — claude-sonnet-4-6, streaming, system prompt cached |
| Deploy | Vercel (FE) + Railway (BE) |

## Design system
Font: Plus Jakarta Sans | Sidebar: Navy #0F172A | CTA: Blue #0369A1 | BG: Slate
Badges: emerald=active, amber=expiring_soon, red=expired/critical
Full spec: design-system/suppliercommandcenter/MASTER.md — read before ANY UI work

## Non-negotiables
- TypeScript strict — no `any` types
- Vertical slices — full feature (FE+BE+DB) before starting next
- No broken commits — every commit runs without errors
- AI failures degrade gracefully — show raw form, never crash
- Mobile-first — test 375px before marking done
- Commits: `feat(scope): description` or `fix(scope): description`

## Key paths
```
src/client/          → React frontend
  components/        → ui/ layout/ + one folder per feature
  pages/             → one per route
  lib/supabase.ts    → Supabase client
src/server/          → Express backend
  routes/            → one file per domain
  prompts/procurement.system.md  → AI brain, loaded once at startup
  services/claude.ts → Claude API wrapper (streaming)
src/types/index.ts   → all shared TypeScript types
design-system/suppliercommandcenter/MASTER.md → read before ANY UI work
test-data/           → synthetic data (suppliers/, buyer-requests/, documents/, compliance/)
docs/schema.sql      → full DB schema
```

## Database
Tables: `suppliers` `supplier_contacts` `certifications` `buyer_relationships` `inbox_requests` `ai_responses`
All have RLS — users see only their own data via `user_id`. Full schema in `docs/schema.sql`.

## AI rules
- One system prompt: `src/server/prompts/procurement.system.md` — cached at startup
- All responses stream via SSE — never wait for full completion
- Never fabricate data — flag missing info, don't invent
- Prompt = system prompt + supplier profile JSON + document text + task instruction

## Claude Code session rules
1. Read this file + `design-system/suppliercommandcenter/MASTER.md` before any UI work
2. Use `/plan` before writing code — think first, always
3. Use `/compact` every ~30 mins to save tokens
4. One task per session — finish, commit, done
5. Confirm before installing any new packages
6. Python: use `py -3.14` not `python` (Windows multi-version setup)

## Opening message for every Claude Code session
"Read CLAUDE.md. We're on Slice [N]. Task today: [specific task]. Check design-system/suppliercommandcenter/MASTER.md before writing any UI."

## Build slices
- [x] Slice 1 (Days 1–4): Auth + profile CRUD + app shell ✓
- [x] Slice 2 (Days 5–9): Smart inbox + request ingestion + PDF parsing ✓
- [x] Slice 3 (Days 10–15): AI response generator + streaming ✓
- [x] Slice 4 (Days 16–20): Compliance tracker + dashboard + deploy ✓

## Slice 2 — what to build next
Files to create:
- src/server/routes/requests.ts       → CRUD for inbox_requests
- src/client/pages/inbox/InboxPage.tsx → main inbox list view
- src/client/components/inbox/RequestCard.tsx → single request card
- src/client/components/inbox/RequestDetail.tsx → expanded view
- src/client/components/inbox/PriorityBadge.tsx → urgent/high/medium/low
- src/client/components/inbox/TypeBadge.tsx → rfp/rfq/compliance/onboarding
- src/client/lib/seed.ts → extend to also seed inbox_messages.json

Done when: All 5 test requests from test-data/buyer-requests/inbox_messages.json
are visible, filterable by type and priority, with deadline countdown.

## Decisions log
| Date | Decision | Reason |
|---|---|---|
| 2025-04-07 | Vite over Next.js | No SSR needed, simpler |
| 2025-04-07 | Supabase over Firebase | PostgreSQL + auth + storage in one |
| 2025-04-07 | Vertical slices | Every slice is independently demo-able |
| 2025-04-07 | claude-sonnet-4-6 | Best speed/quality for streaming |
| 2025-04-07 | py -3.14 for scripts | Multi-version Windows, other project uses older |
| 2025-04-08 | Email confirmation kept ON | Real auth flow; handle with empty state + Load demo data button on first login |
| 2025-04-08 | react-markdown + remark-gfm | GFM needed for table parsing; prose plugin for typography |
| 2025-04-08 | Haiku over Sonnet for drafts | 10x cheaper than Sonnet; quality sufficient for structured procurement drafts |
| 2025-04-08 | Prompt caching via cache_control ephemeral on system prompt | System prompt billed once per 5-min TTL window, not per call |
| 2025-04-08 | SSE streaming via fetch not EventSource | EventSource doesn't support custom headers; Bearer auth requires fetch + ReadableStream |
| 2025-04-08 | Minimal context per request type via contextBuilder.ts | Never send full profile; select only certs/contacts/buyers relevant to the request type |
| 2025-04-08 | tsconfig.server.json uses NodeNext not CommonJS | package.json has "type":"module" + server uses import.meta.url — CommonJS conflicts without extra workaround |
| 2025-04-08 | required_by seeded from compliance_tracker.json via fuzzy name match | Compliance tracker names differ slightly from cert names; substring match resolves all 8 items |
| 2025-04-08 | window.location.reload() after seed | Ensures AppShell re-initializes and sidebar picks up new company name |
| 2025-04-08 | TSX in production on Railway | Avoids compiled JS build step complexity; tsx runs TypeScript directly |

## Known issues (fix before demo)
- [x] Sidebar "Loading..." persists after seed until reload (fix: window.location.reload() after seedAcme)
- [x] Settings shows cached email from previous session (fix: fresh supabase.auth.getUser() on mount)
- [x] AI draft shows [FLAGGED] placeholders for missing case studies (fix: update system prompt + seed data)

## Updating this file
Check off slices when done. Add decisions. Update phase at top.
Detail lives in `/docs/` and slice brief files — not here.
