# CLAUDE.md — Supplier Command Center
> Last updated: 2025-04-07 | Phase: Slice 1 — Foundation

## What we're building
AI-powered supplier portal — the "other side" of Valorant's Astra procurement platform.
Suppliers manage buyer relationships, respond to RFPs, track compliance. All AI-powered.
Demo target: Biju Mohan, Co-Founder of Valorant (job application project).

## Stack
| Layer | Tech |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind + shadcn/ui |
| Backend | Node.js + Express |
| Database | Supabase (PostgreSQL + Auth + Storage + RLS) |
| AI | Claude API — claude-sonnet-4-6, streaming, system prompt cached |
| Deploy | Vercel (FE) + Railway (BE) |

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
design-system/MASTER.md → read before ANY UI work
test-data/           → synthetic data for development
docs/schema.sql      → full DB schema
```

## Database
Tables: `suppliers` `supplier_contacts` `certifications` `buyer_relationships` `inbox_requests` `ai_responses`
All have RLS — users see only their own data via `user_id`. Full schema in `docs/schema.sql`.

## AI rules
- One system prompt: `src/server/prompts/procurement.system.md` — cached at startup, injected into every call
- All responses stream via SSE — never wait for full completion
- Never fabricate data — if supplier profile is missing info, flag it, don't invent
- Prompt = system prompt + supplier profile JSON + document text + task instruction

## Claude Code session rules
1. Read this file + `design-system/MASTER.md` before any UI work
2. Use `/plan` before writing code — think first, always
3. Use `/compact` every ~30 mins to save tokens
4. One task per session — finish, commit, done
5. Confirm before installing any new packages
6. Python: use `py -3.14` not `python` (Windows multi-version setup)

## Opening message for every Claude Code session
"Read CLAUDE.md. We're on Slice [N]. Task today: [specific task]. Check design-system/MASTER.md before writing any UI."

## Current slices
- [ ] Slice 1 (Days 1–4): Auth + profile CRUD + app shell → see `slice-1-brief.md`
- [ ] Slice 2 (Days 5–9): Smart inbox + request ingestion + PDF parsing
- [ ] Slice 3 (Days 10–15): AI response generator + streaming
- [ ] Slice 4 (Days 16–20): Compliance tracker + dashboard + deploy

## Decisions log
| Date | Decision | Reason |
|---|---|---|
| 2025-04-07 | Vite over Next.js | No SSR needed, simpler |
| 2025-04-07 | Supabase over Firebase | PostgreSQL + auth + storage in one |
| 2025-04-07 | Vertical slices | Every slice is independently demo-able |
| 2025-04-07 | claude-sonnet-4-6 | Best speed/quality for streaming |
| 2025-04-07 | py -3.14 for scripts | Multi-version Windows, other project uses older |

## Updating this file
Check off slices when done. Add decisions. Update phase at top.
Detail lives in `/docs/` and slice brief files — not here.
