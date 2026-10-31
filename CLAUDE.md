# CLAUDE.md — Supplier Command Center
> Last updated: 2026-10-31 | Phase: Security Review (vendor-side TPRM) built on branch `claude/loving-rubin-fi9o7n` — not merged; verified against the real Supabase project

## CURRENT WORK — read first
Building the Security Review feature (vendor-side TPRM, modeled on SAFE Security's TPRM product).
**Read `docs/security-review-plan.md` before doing anything** — it has the status table, pipeline,
prompts, readiness rules, eval design, decisions, cut order, and SAFE mapping.
SAFE product and domain background (agents, how they evaluate AI, SOC 2/TPRM primer): `docs/safe-context.md`.
Sample data and gold labels: `test_data/tprm/README.md`, `test_data/tprm/gold.json`.
Rules: work only on `claude/loving-rubin-fi9o7n`; never merge or touch production until Pranav says so;
run tests after every step (`npm test`, `npm run tprm:verify-samples`, `npx tsc --noEmit -p tsconfig.server.json`,
`npx tsc --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run tprm:ui-check`) and confirm tests can fail.
Live checks (need `ANTHROPIC_API_KEY`): `npm run eval:tprm`, `npm run tprm:e2e`. Real DB: `npm run tprm:check-supabase`.

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
| AI | Claude API — claude-haiku-4-5, streaming, system prompt cached |
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
  assets/logo.svg    → app logo (also public/favicon.svg)
src/server/          → Express backend
  routes/            → one file per domain
  prompts/procurement.system.md  → AI brain, loaded once at startup
  services/claude.ts → Claude API wrapper (streaming, MAX_OUTPUT_TOKENS=2500)
  services/contextBuilder.ts → builds per-request context (contact, rate card, certs)
src/types/index.ts   → all shared TypeScript types
design-system/suppliercommandcenter/MASTER.md → read before ANY UI work
  services/tprm/     → security review pipeline (parse, analyze, evidence, answer, readiness, remediation, response)
  prompts/tprm/      → versioned security review prompts (*.vN.md)
src/client/pages/security-review/, components/security-review/ → security review UI
scripts/tprm/        → eval, e2e, UI check, dev API, Supabase check, demo recorder
test_data/           → synthetic data (suppliers/, buyer-requests/, documents/, compliance/, tprm/)
docs/schema.sql      → full DB schema
```

## Database
Tables: `suppliers` `supplier_contacts` `certifications` `buyer_relationships` `inbox_requests` `ai_responses`
All have RLS — users see only their own data via `user_id`. Full schema in `docs/schema.sql`.

## AI rules
- One system prompt: `src/server/prompts/procurement.system.md` — cached at startup
- All responses stream via SSE — never wait for full completion
- Never fabricate data — omit missing sections, never invent
- Prompt = system prompt + today's date + primary contact + supplier profile + rate card (RFQ) + request body + task instruction
- Cert status computed from expiry_date at request time — never trust DB status field
- MAX_OUTPUT_TOKENS = 2500 (claude.ts)

## Claude Code session rules
1. Read this file + `design-system/suppliercommandcenter/MASTER.md` before any UI work
2. Use `/plan` before writing code — think first, always
3. Use `/compact` every ~30 mins to save tokens
4. One task per session — finish, commit, done
5. Confirm before installing any new packages
6. Python: use `py -3.14` not `python` (Windows multi-version setup)

## Opening message for every Claude Code session
"Read CLAUDE.md. Task today: [specific task]. Check design-system/suppliercommandcenter/MASTER.md before writing any UI."

## Build slices
- [x] Slice 1 (Days 1–4): Auth + profile CRUD + app shell ✓
- [x] Slice 2 (Days 5–9): Smart inbox + request ingestion ✓ (attachments are listed, not parsed; the Security Review parses uploaded PDF/XLSX evidence)
- [x] Slice 3 (Days 10–15): AI response generator + streaming ✓
- [x] Slice 4 (Days 16–20): Compliance tracker + dashboard + deploy ✓

## AI Features built
- AI Response Generator — streaming RFP/RFQ/compliance/onboarding drafts via SSE
- RFP Gap Analyzer — GapAnalysisCard: profile vs requirements, tooltip on truncated items
- Buyer Tone Insight — ToneInsightCard: urgency/sentiment/risk, cached by request ID
- ESG Survey Auto-complete — SurveyAutoComplete: maps diversity certs to survey answers
- TipTap rich text editor — inline draft editing with Bold/Italic/Heading/List/Undo/Redo toolbar
- Open in email client — Gmail-aware (@gmail.com → Gmail compose URL); rich text HTML copied to clipboard; button state feedback + toast
- Security Review (vendor-side TPRM) — `/inbox/:id/security-review`: evidence upload + parsing, summary cards,
  questionnaire answering with code-verified citations, conflict detection, readiness rules, human review,
  remediation + Jira CSV, filled questionnaire export. Details: `docs/security-review-plan.md`

## DraftPanel behaviour
- View mode: ReactMarkdown (markdown) or dangerouslySetInnerHTML (after TipTap edit)
- Edit mode: TipTap editor; markdownToHtml() on enter, editor.getHTML() on exit
- Email button: copies HTML to clipboard (ClipboardItem text/html), opens Gmail or mailto; Gmail path shows "Opening Gmail..." button state for 2s before opening new tab
- Toast: "Draft copied — paste into email body to preserve formatting (Ctrl+V)"

## Decisions log
| Date | Decision | Reason |
|---|---|---|
| 2025-04-07 | Vite over Next.js | No SSR needed, simpler |
| 2025-04-07 | Supabase over Firebase | PostgreSQL + auth + storage in one |
| 2025-04-07 | Vertical slices | Every slice is independently demo-able |
| 2025-04-07 | claude-sonnet-4-6 | Best speed/quality for streaming |
| 2025-04-07 | py -3.14 for scripts | Multi-version Windows, other project uses older |
| 2025-04-08 | Email confirmation kept ON | Real auth flow; handle with empty state + Load demo data button on first login |
| 2025-04-08 | react-markdown + remark-gfm | Proper table rendering in AI draft panel; prose plugin for typography |
| 2025-04-08 | Haiku over Sonnet for drafts | 10x cheaper than Sonnet; quality sufficient for structured procurement drafts |
| 2025-04-08 | Prompt caching via cache_control ephemeral on system prompt | System prompt billed once per 5-min TTL window, not per call |
| 2025-04-08 | SSE streaming via fetch not EventSource | EventSource doesn't support custom headers; Bearer auth requires fetch + ReadableStream |
| 2025-04-08 | Minimal context per request type via contextBuilder.ts | Never send full profile; select only certs/contacts/buyers relevant to the request type |
| 2025-04-08 | tsconfig.server.json uses NodeNext not CommonJS | package.json has "type":"module" + server uses import.meta.url — CommonJS conflicts without extra workaround |
| 2025-04-08 | required_by seeded from compliance_tracker.json via fuzzy name match | Compliance tracker names differ slightly from cert names; substring match resolves all 8 items |
| 2025-04-08 | window.location.reload() after seed | Ensures AppShell re-initializes and sidebar picks up new company name |
| 2025-04-08 | TSX in production on Railway | Avoids compiled JS build step complexity; tsx runs TypeScript directly |
| 2025-04-08 | GapAnalysisCard returns null for non-RFP types | Avoid unnecessary API calls for compliance/survey requests |
| 2025-04-08 | ToneInsightCard cached by request ID via useRef | No re-fetch on panel reopen |
| 2025-04-08 | ESG auto-complete from diversity profile data | Maps supplier certs to survey answers automatically |
| 2026-04-19 | TipTap v3 for draft editing | Rich text editing with table support; markdownToHtml() converts AI output on entry |
| 2026-04-19 | Gmail-aware email client detection | @gmail.com → Gmail compose URL; others → mailto: fallback |
| 2026-04-19 | Rich text clipboard (ClipboardItem text/html) | Paste into Gmail preserves tables, bold, headings; avoids URL length limits |
| 2026-04-19 | Dynamic cert status from expiry_date | DB status field stale; compute Active/Expiring Soon/Expired at request time |
| 2026-04-19 | Structured response templates per type in system prompt | Consistent heading hierarchy and section order across all draft types |
| 2026-04-19 | Logo/favicon: public/favicon.svg | Navy rounded square, white building, blue lightning bolt; shown in sidebar + auth pages |
| 2026-04-19 | MAX_OUTPUT_TOKENS raised to 2500 | Longer structured drafts with tables were being cut off at 1500 |
| 2026-04-19 | Dynamic deadline countdown in RequestCard | Math.ceil days remaining; red≤7d, amber≤14d, slate≤30d, slate-400>30d |
| 2026-10-30 | Security review: pdfjs-dist + exceljs, no third-party parsing API | Deterministic page text for quote checks; no fourth-party exposure of vendor docs |
| 2026-10-30 | Own quote+locator citations, not Claude Citations API | Citations API is incompatible with structured outputs; code-verified quotes make hallucinated citations catchable |
| 2026-10-30 | Evidence gathering separated from answer drafting | Drafter can't skip contradicting documents, so conflicts surface |
| 2026-10-30 | Additive migration run on live Supabase | New tables only; existing code unaffected (see docs/migrations/) |
| 2026-10-30 | Readiness decided by code rules; Ready needs a "supported" verifier verdict | Model confidence is checked last and can only hold an answer back |
| 2026-10-30 | Added rules UNSUPPORTED_NUMBER and GAP_DISCLOSED (partial/no needs sign-off) | Invented numbers caught in code; a correct "partial" was otherwise auto-Ready |
| 2026-10-30 | Real quote cited to the wrong page is relocated only on a unique exact match in the same document | Bookkeeping errors fixed without letting invented or misattributed quotes pass |
| 2026-10-30 | Prompts get today's date | Model called past dates "future" when judging "within 12 months" |
| 2026-10-30 | Final response filtered in code; withheld answers never exported | Buyer only sees Ready or human-approved answers |
| 2026-10-30 | Sidebar becomes a menu drawer below md | Fixed 256px sidebar squeezed every page to ~87px at 375px |
| 2026-10-31 | Keep UNSUPPORTED_NUMBER and GAP_DISCLOSED readiness rules (owner decision) | They decide which answers may skip human review; zero cost on the eval |
| 2026-10-31 | Gold IAM-04 accepts Conflict or Needs Evidence (gold 2026-10-31.1, owner decision) | Same shape as VULN-02; both outcomes reach a human |
| 2026-10-30 | Prompt caching on the draft path does not fire (verified) | System prompt is ~1,100 tokens, under Haiku 4.5's 4,096 minimum; earlier "billed once per 5 min" note was wrong |

## Known issues (fix before demo)
- [x] "PDF parsing ✓" in Slice 2 was inaccurate (wording fixed; security review adds real parsing)
- [x] Prompt caching never fires on the draft path — verified (cache read/write 0); comments corrected, cache_control left in place
- [x] contextBuilder.ts cert fallback never ran (fixed: `services/certSelection.ts`, tested)
- [x] Migration `2026-10-31_security_review_additions.sql` applied; `npm run tprm:check-supabase` passed on the real project (2026-10-31, Windows, after the dependency update)
- [ ] Existing demo accounts lack inbox message req_006 (Clearfield security questionnaire); new seeds include it
- [x] `npm audit fix` applied 2026-10-31 (59 → 11 advisories, criticals gone; TipTap aligned at 3.32.2, editor covered by `tprm:ui-check`)
- [ ] Remaining `npm audit` highs need major upgrades: vite 5→8 (dev server only), zod 3→4 — not done
- [ ] `npm run lint` has no ESLint config in the repo (not needed to run; add after the demo)
- [ ] package.json now declares `engines.node >=22.13` (pdfjs-dist 6 needs it) — confirm Railway's Node version before merging
- [x] Sidebar "Loading..." persists after seed until reload (fix: window.location.reload() after seedAcme)
- [x] Settings shows cached email from previous session (fix: fresh supabase.auth.getUser() on mount)
- [x] AI draft shows [FLAGGED] placeholders for missing case studies (fix: update system prompt + seed data)

## Live URLs
- Frontend: https://supplier-command-center.vercel.app
- Backend: https://supplier-command-center-production.up.railway.app
- Repo: https://github.com/PranavCR01/supplier-command-center

## Updating this file
Check off slices when done. Add decisions. Update phase at top.
Detail lives in `/docs/` and slice brief files — not here.
