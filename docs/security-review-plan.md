# Security Review (vendor-side TPRM) — Build Plan

> Source of truth for the security review feature. Read this before working on it.
> Branch: `claude/loving-rubin-fi9o7n`. Do not merge to `main` until Pranav says so.
> Deadline: working end to end by **Sunday Nov 1, 2026 afternoon** (backup video + slides).
> SAFE product and domain background: `docs/safe-context.md`.

## Why this exists

SAFE (safe.security) sells TPRM AI agents that read vendor security questionnaires, SOC 2 reports,
pen tests and policies on the **buyer** side. This feature is the **vendor** side: a supplier receives
a security questionnaire, uploads its evidence, and the app drafts every answer with citations it can
defend — running the same checks a buyer's agent would, so the vendor finds contradictions first.

The core question this feature answers: how do you use technical understanding to challenge and
adapt AI-based responses? The answer is the challenge layer below: deterministic checks first, a second model
opinion second, the model's own confidence last, and a human for anything unresolved.

## Status

| Step | What | Status |
|---|---|---|
| 0 | Synthetic documents + gold set (`test_data/tprm/`) | Done |
| 1 | Upload, storage, parsing API (`/api/security-review`) | Done |
| 2 | Document classification, findings extraction, summary cards | Done (results below) |
| 3 | Per question: gather evidence → quote check → conflict check | **Next** |
| 4 | Draft answer → verify support → readiness | |
| 5 | Eval script (`npm run eval:tprm`) — first checkpoint: numbers for a slide | |
| 6 | Question run route + SSE progress + persistence | |
| 7 | Security review page (Documents, Answers, conflict view, evidence drawer) | |
| 8 | Remediation items + Jira-style CSV/JSON export | |
| 9 | Final response assembled from Ready answers only | |
| 10 | Seed message, end-to-end run, 375px check, CLAUDE.md fixes, record | |

**Before step 6 (needs the real DB):** run `docs/migrations/2026-10-31_document_analysis.sql` on Supabase
(adds `security_documents.analysis_status/analysis_error`, allows finding kind `access_review_exception`).
Not run yet — this environment has no Supabase credentials.

### Step 2 results (real model, `npm run tprm:analyze-samples`, Haiku 4.5, 2026-10-30)

Prompts `classify_and_extract.v1` + `summarize_document.v2`; ~50 s for 5 documents, ~30k input / 10k output tokens.

| Metric | Result |
|---|---|
| Classification | 5/5 |
| Field accuracy (per record) | SOC 2 25/25 (21 controls, 2 exceptions with page, no invented exceptions, AWS carve-out) · pen test 7/7 (severity as stated + status) · phishing 4/4 · access review 1/1 (exactly rows 27–28) |
| Summary coverage (gold `summaries`) | 7/7 (v1 was 5/7: SOC 2 card described both exceptions but without the CC6.2/CC8.1 IDs) |
| Quotes verified by code | findings 59/59; summary items 39/40 |
| Summary items flagged for numbers not on the cited page | 4/40 |

What the code checks caught on real output (the honest part — the score alone hides these):
- A summary quote that joined two sentences and skipped the one between them ("a third campaign was
  cancelled") → `QUOTE_NOT_FOUND`.
- v1 cards contained a computed number ("exceeded the deadline by 31 days": 41 − 10, and wrong because
  the SLA is business days) and a false count ("two high findings remain open"; only PT-03 is). v2 forbids
  arithmetic and requires each item's quote to support the whole sentence; `numbersNotInSource` now flags
  digits the cited page/rows don't contain. **Limit:** spelled-out numbers ("two") are not checked, and
  summary cards have no verifier call — a human reads them.
- Remaining flags are claims stitched from two pages, and one takeaway that added "SOC 2 report" to a policy
  page that never says it (model background knowledge).
- One run each; gold was not changed. The eval is circular (see Eval below).

**Rule from Pranav:** after every step, run tests and confirm the change works. Check that tests can
fail (break something on purpose, confirm a test catches it, restore).

**Cut order if behind** (agreed): spreadsheet evidence citations → repeat eval runs → answer editing
(keep approve/reject) → remediation UI (keep API export) → timeline UI (keep logging events).
**Never cut:** conflict detection, linked evidence, readiness states, the eval.

## Decisions (made with Pranav)

| Decision | Choice | Why |
|---|---|---|
| Model | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`, already in `services/claude.ts`) | Stay on the stack. Make the model a config value so the eval can compare models later. |
| Evidence retrieval | No vector DB. All evidence, page-tagged, in one **cached** prompt block | ~30k tokens fits the 200k context. Caching makes the per-question calls cheap. |
| Citations | Our own quote + location, verified by code. **Not** the Claude Citations API | Citations API can't be combined with structured outputs (400). Our approach makes invented quotes catchable — the demo moment. Mention Citations API as the production alternative. |
| Structured output | `output_config.format` JSON schema, validated with zod | Haiku 4.5 supports it. If SDK 0.89 lacks it, fall back to strict tool use. |
| Parsing | `pdfjs-dist` (page text), `exceljs` (rows). No third-party parsing API | Deterministic text is what quote verification checks against. Sending a vendor's SOC 2 to another vendor is a fourth-party risk (SAFE sells a Fourth-Party Agent). Scanned pages are flagged `low_text` → Needs Evidence. |
| Upload | `express.raw()`, no multer | One less dependency. |
| Database | Additive migration on the live Supabase project (already run, verified) | New tables only; existing code never reads them. |
| Separate API key | Dev key in its own workspace with a spend cap | Revocable without touching production. |
| JSON schema from zod | Schemas written with `zod/v4` (bundled in zod 3.25, no new package); `toOutputSchema` converts and strips keywords the API rejects | SDK 0.89's `zodOutputFormat` turns string enums into descriptions, so `doc_type` would not be constrained. Output is re-validated with zod either way. |
| Analysis trigger | Explicit `POST /requests/:id/analyze` (and per document), not automatic on upload | Keeps upload fast and deterministic; the UI calls analyze after upload (step 7). |
| Severity guard | A stated severity is kept only if the word appears on the cited page | "Copy severity as stated; never infer" enforced in code, not just the prompt. |
| Summary number guard | Digits in a summary sentence must appear on its cited page/rows (IDs like PT-01 excluded); flagged, not hidden | Catches computed and invented numbers that a verified quote alone does not. |

## Known issues found in the existing app (fix before demo, step 10)

- CLAUDE.md says "PDF parsing ✓" for Slice 2, but attachments were never parsed (`contextBuilder.ts`
  says "Attachments referenced (not parsed)"). This feature adds real parsing.
- Prompt caching on the existing draft path likely never fires: Haiku 4.5's minimum cacheable prefix
  is 4,096 tokens and `procurement.system.md` is ~1,100. Verify with `usage.cache_read_input_tokens`.
  The security review prompts *do* cache (the evidence block is ~30k tokens).
- `contextBuilder.ts:162`: `.slice(0, 5) || certs.slice(0, 5)` — empty array is truthy, so the fallback
  never runs.
- `pdfjs-dist@6.4.299` needs Node >= 22.13. Add `engines` before merging; check Railway's Node version.
- `npm audit`: axios (high), @tiptap/core (high), @anthropic-ai/sdk (moderate) predate this work.

## Pipeline

```
Per document (on upload / "use samples"):
  bytes → sniff type → sha256 de-dup → store original → parse into units → save     [step 1, done]
  → classify doc type → extract findings → summary card → propose remediation items  [step 2, 8]

Per question (one run per questionnaire):
  1. gather_evidence   neutral; all evidence in cached block; returns passages from EVERY doc that
                       addresses the topic, including ones that limit or contradict. Never answers.
  2. quote check       code: matchQuote() — exact or approximate (>= 0.9 token LCS in a window);
                       any number in the quote missing from the source = fail.
  3. detect_conflict   only when verified evidence spans 2+ documents
  4. draft_answer      sees ONLY verified passages, not the full documents
  5. verify_support    does the answer claim more than the passages say?
  6. readiness         code rules below

Then: human review → final response built from Ready answers only (server-side filter, not a prompt)
```

**Why gather evidence separately from drafting:** a drafter on the vendor side is incentivized to
present favorably and will cite the policy ("MFA everywhere") and skip the pen test. Separating
retrieval from advocacy is what makes conflict detection work.

Cost/latency: ~3–4 calls per question × 22 questions ≈ 70–90 Haiku calls per run. Warm the cache with
one call first, then run 4 in parallel (parallel cold calls each write the cache). Expect 2–3 minutes,
a few cents.

## Readiness rules (code, not prompt; first match wins)

| # | Condition | Readiness | Reason code |
|---|---|---|---|
| 1 | Conflict detected between documents | **Conflict** | `CONFLICT` |
| 2 | Schema invalid | Needs Evidence | `SCHEMA_INVALID` |
| 3 | No evidence / answer `not_addressed` | Needs Evidence | `NO_EVIDENCE` |
| 4 | Cited location doesn't exist | Needs Evidence | `PAGE_OUT_OF_RANGE` |
| 5 | Quote not found at the cited location | Needs Evidence | `QUOTE_NOT_FOUND` |
| 6 | Cited page is a scan with no text | Needs Evidence | `LOW_TEXT` |
| 7 | Answer relies on an auditor exception or open critical/high finding | Needs Evidence | `CONTROL_EXCEPTION` |
| 8 | Answer relies on a subservice carve-out (e.g. AWS physical security) | Needs Evidence | `CARVE_OUT` |
| 9 | Verifier says unsupported / partially supported | Needs Evidence | `VERIFIER_UNSUPPORTED` / `VERIFIER_PARTIAL` |
| 10 | Model confidence < 0.7 | Needs Evidence | `LOW_CONFIDENCE` |
| — | Everything passed | **Ready** | — |

Confidence is last on purpose: self-reported confidence is poorly calibrated, so it can never make an
answer Ready on its own. If a quote fails (rule 5), skip the verifier call.

Human actions: approve (→ Ready, logged as human-approved), edit then approve, resolve a conflict
(pick passage A, pick B, or write text + note), reject. Every action goes to `activity_events`.

## Prompts

Versioned files in `src/server/prompts/tprm/<name>.v1.md`. Each run stores `prompt_versions`; eval
results are keyed by prompt version. A prompt change is a code change.

1. **classify_and_extract.v1** — per document: doc type + findings in the schema for that type
   (SOC 2 controls with result/exception, carve-outs; pen test findings with stated severity and status;
   phishing metrics). Copy severity as stated; never infer. `exceptions_noted` only when the auditor
   records an exception, not a management response.
2. **summarize_document.v2** — per document, from findings + text: top findings, key exceptions,
   takeaways; each item has a locator + verbatim quote (verified by code). v2 over v1: start items with
   the control/finding ID, one quote must support the whole sentence, no arithmetic or self-counted totals.
3. **gather_evidence.v1** — per question, against cached evidence. Return every relevant passage from
   every document with stance `supports | limits | contradicts`. Never write an answer.
4. **detect_conflict.v1** — verified passages only. Conflict = incompatible claims about the same control
   and scope. Different wording that is compatible, or a policy stricter than what was tested, is NOT a
   conflict. Output: `{conflict, a, b, explanation}`.
5. **draft_answer.v1** — verified passages only. Answer `yes | no | partial | not_addressed`. Disclose
   exceptions. Never cite outside the given passages. Never invent numbers (RTO/RPO trap).
6. **verify_support.v1** — question + answer + full text of cited units. Verdict
   `supported | partially_supported | unsupported` + reason. Scope mismatch (one business day vs
   24 hours; production-only vs all users) = partially supported.

## Data model

Migration: `docs/migrations/2026-10-30_security_review.sql` (run on live Supabase, verified).
Rollback: `docs/migrations/2026-10-30_security_review.down.sql`.
Step 2 migration: `docs/migrations/2026-10-31_document_analysis.sql` (**not run yet**; rollback `.down.sql`).

`security_documents`, `document_units`, `document_findings`, `questionnaire_runs`,
`questionnaire_answers`, `remediation_items`, `activity_events` (append-only: UPDATE blocked by trigger,
no DELETE policy). Private bucket `security-docs`. All tables carry `supplier_id` with RLS; the server
uses the service role, so routes check ownership themselves (see `routes/securityReview.ts`).

## Code map

| Path | Purpose |
|---|---|
| `src/server/services/tprm/parsers.ts` | PDF/XLSX parsing, questionnaire parsing, `matchQuote`, `isLowText` |
| `src/server/services/tprm/ingest.ts` | Upload pipeline: sniff, de-dup, store, parse, log |
| `src/server/services/tprm/store.ts` | `SecurityReviewStore` interface + Supabase implementation |
| `src/server/services/tprm/memoryStore.ts` | In-memory store for tests and DB-free eval runs |
| `src/server/services/tprm/llm.ts` | `TprmLlm` interface, Anthropic implementation (structured outputs, cached context block), versioned prompt loader |
| `src/server/services/tprm/citations.ts` | `checkCitation` (location exists → not low-text → quote at that page/row), `renderDocument` |
| `src/server/services/tprm/analyze.ts` | Step 2: classify + extract (code-checked findings), summary card, events |
| `src/server/services/tprm/scoreAnalysis.ts` | Scores step 2 output against gold (reused by the step 5 eval) |
| `src/server/services/tprm/testing/fakeLlm.ts` | Fake `TprmLlm` for offline tests (same zod validation path) |
| `src/server/prompts/tprm/*.vN.md` | Versioned prompts; old versions kept |
| `scripts/tprm/analyze-samples.ts` | Live step 2 run on the samples + score (`npm run tprm:analyze-samples`) |
| `src/server/routes/securityReview.ts` | Router factory (auth + store injected so tests need no credentials) |
| `scripts/tprm/generate_samples.py` | Regenerates synthetic documents (`py -3.14` on Windows) |
| `scripts/tprm/verify-samples.ts` | Checks every gold anchor against parsed documents |
| `test_data/tprm/gold.json` | Expected answers, readiness, evidence locations, conflicts, findings, remediation |

Commands: `npm test`, `npm run tprm:verify-samples`, `npx tsc --noEmit -p tsconfig.server.json`,
`npx tsc --noEmit`. Live (needs `ANTHROPIC_API_KEY`; costs a few cents): `npm run tprm:analyze-samples`.
Results go to `eval-results/` (git-ignored).

API (step 2): `POST /requests/:id/analyze`, `POST /documents/:id/analyze`, `PATCH /documents/:id`
`{doc_type}` (vendor correction, kept on re-analysis), `GET /requests/:id/findings`. Analysis routes
return 503 when no API key is configured; everything else still works.

## Eval (`npm run eval:tprm`, step 5)

Runs the pipeline with the in-memory store, writes `eval-results/<prompt-version>-<timestamp>.json`.

Headline:
- **Unsafe Ready** — answers marked Ready whose gold readiness is not Ready, or whose answer is wrong.
  Target 0.
- **Conflict recall** — seeded conflicts caught (IAM-01, VULN-02, TRN-02; TRN-01 accepts Conflict or
  Needs Evidence).
- **Conflict false positives** — decoys flagged (IAM-02, IAM-04, DATA-01).
- **Needs Evidence recall** — planted gaps caught.

Secondary: answer accuracy, citation accuracy (cited location in gold set), findings field accuracy per
doc type (SAFE defines field accuracy per document; with one document per type we report per record —
say so), summary coverage of known exceptions, quote verification rate, `must_mention` checks.

Honesty rules: gold was written before prompts. Never edit gold to match model output. The eval is
circular (same author wrote docs, labels, prompts) — present it as a regression harness, not a
benchmark, and report misses alongside the score.

## Remediation rules (step 8)

Create items for open pen test findings with stated severity Critical/High, and for every SOC 2
exception (severity `high` by rule; the report states none). Remediated and Medium/Low findings don't
create items. Due dates from the vendor's own policy SLA (critical 15, high 30, medium 90 days) counted
from the finding date when known — so PT-01 shows as overdue. Owner defaults to the technical contact.
Export: CSV with Jira import columns (Summary, Description, Priority, Assignee, Due Date, Labels) + JSON.

## UI (steps 7–9)

Compliance requests in the inbox get an "Open security review" button → `/inbox/:id/security-review`
(the side panel is too narrow for side-by-side passages). Tabs: Documents (upload, "Use sample
documents", summary cards) · Answers (filter Ready / Needs Evidence / Conflict; conflict view two-column
on desktop, stacked at 375px) · Remediation · Activity · Response. Evidence drawer shows the unit text
with the quote highlighted; "Open original" uses the signed URL + `#page=N` (not supported on iOS
Safari, hence the text drawer is primary). Follow `design-system/suppliercommandcenter/MASTER.md`.

## How it maps to SAFE (analogous capabilities, not the same product)

| Feature | SAFE parallel |
|---|---|
| Multi-document intake | TPRM due diligence on SOC 2, questionnaires, evidence |
| Summary cards | SnapShot (AI summaries); Evidence Analyzer agents |
| Questionnaire answering mapped to evidence | Questioneer |
| Conflict detection | Evidence Analyzer "flag discrepancies" |
| Readiness + human review | "Review, approve, or override any agent-driven action" |
| Activity timeline | Human-in-the-loop audit trail |
| Remediation + Jira export | CTEM "track remediation to verified closure"; ITSM integrations |
| Gold set, field accuracy, versioned prompts | SAFE's published approach: gold standards, field accuracy, prompts versioned like code |

In one line: SAFE's agents check vendor evidence on the buyer side; this runs the same kind of checks
on the vendor side, so the vendor finds the MFA contradiction before the buyer does.

## Environment notes

- In the cloud environment the key is exposed as `TPRM_ANTHROPIC_API_KEY`; test/eval commands map it
  (`ANTHROPIC_API_KEY="$TPRM_ANTHROPIC_API_KEY" npm run …`). App code reads only `ANTHROPIC_API_KEY`.
- Cloud sessions need `ANTHROPIC_API_KEY` as an **environment variable** (not a Network secret:
  `api.anthropic.com` bypasses the proxy). Env changes only reach new sessions.
- Supabase credentials are not in the cloud environment; Supabase store code is exercised locally.
- Commits: `feat(scope): …` / `fix(scope): …`. Push to `claude/loving-rubin-fi9o7n` only.
