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
| 3 | Per question: gather evidence → quote check → conflict check | Done (results below) |
| 4 | Draft answer → verify support → readiness | Done (results below) |
| 5 | Eval script (`npm run eval:tprm`) — first checkpoint: numbers for a slide | Done — `docs/eval/2026-10-30.md` |
| 6 | Question run route + SSE progress + persistence | **Next** |
| 7 | Security review page (Documents, Answers, conflict view, evidence drawer) | |
| 8 | Remediation items + Jira-style CSV/JSON export | |
| 9 | Final response assembled from Ready answers only | |
| 10 | Seed message, end-to-end run, 375px check, CLAUDE.md fixes, record | |

**Before step 6 (needs the real DB):** run `docs/migrations/2026-10-31_security_review_additions.sql` on Supabase
(adds `security_documents.analysis_status/analysis_error`, allows finding kind `access_review_exception`,
adds `questionnaire_runs.as_of` and `questionnaire_answers.unsupported_numbers/errors`).
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

### Step 3 results (real model, `npm run tprm:evidence-samples`, Haiku 4.5, 2026-10-30)

Prompts `gather_evidence.v1` + `detect_conflict.v2` (gather moved to v2 in step 4; step 5 re-measures); 22 questions in ~40 s after step 2; cache read ~193k
tokens vs ~9k written per run (the warm-up call writes, the rest read).

| Metric | v1 conflict prompt | **v2 (kept; same result on 2 runs)** |
|---|---|---|
| Conflict recall (IAM-01, VULN-02, TRN-02) | 3/3, correct pairs | **3/3, correct pairs** |
| TRN-01 (Conflict or Needs Evidence both OK) | no conflict | conflict |
| Conflict false positives | 4 (IAM-02, IAM-04, DATA-02, VULN-03) | **2 (IAM-02, IAM-04)** |
| DATA-01 decoy | ok | ok |
| "Supports" evidence on not-addressed traps (DATA-04, BCP-02) | none | none |
| Evidence recall (gold locations cited with a verified quote) | 42/47 | **44/47** |
| Quotes verified | 67/74 | **72/74** (5 relocated) |

What changed and why:
- **Reasoning before verdict.** In v1 the schema put `conflict` before `explanation`; structured output is
  generated in schema order, so the model committed first and then wrote explanations arguing *against*
  its own verdict (IAM-02, VULN-03). v2 puts `explanation` first. Removed 2 false positives.
- **Citation relocation (code).** Most missed evidence was a real quote cited to the wrong page. If the
  exact quote is at exactly one other location in the same document, `checkCitation` corrects the
  locator and records `relocated_from`. Approximate matches, ambiguous matches, nonexistent pages and
  other documents never relocate (GOV-02's pen test date attributed to the SOC 2 stays unverified).
- **Tried and reverted:** a v3 rule "judge only the scope the question names" did not clear IAM-02 and
  lost TRN-02 (recall 2/3). Not kept.

Remaining misses, stated plainly:
- **IAM-02 (decoy):** the policy/pen-test MFA clash is real but about the admin portal; the question asks
  about VPN and console. Routes to Conflict → a human sees it; not an unsafe Ready.
- **IAM-04 (decoy):** flagged as policy (removal within 10 business days) vs access review (41 days). Gold
  calls this an auditor exception, not a conflict; the model's reading is defensible and resembles VULN-02,
  which gold labels a conflict. Gold not changed; label worth a second look by a human.
- Every prompt change above was judged on the same 22 questions it will be scored on (circular).

### Step 5: eval checkpoint (`npm run eval:tprm`, RUNS=3, 2026-10-30) — numbers for the slide

Full pipeline (steps 2–4), Haiku 4.5, as-of 2026-10-30, ~115 s and ~105k input / 24k output tokens per
run plus ~200k cache-read tokens. Full table and misses: `docs/eval/2026-10-30.md`.

| Headline | Result (3 runs, identical) |
|---|---|
| Unsafe Ready (target 0) | **0** |
| Conflict recall (IAM-01, VULN-02, TRN-02) | **3/3** |
| Conflict false positives | **1** (IAM-02 decoy) |
| Needs Evidence recall (planted gaps) | **6/6** |
| Readiness matches gold | 19/22 · Ready 9 (gold 12) |
| Answer accuracy · citation accuracy · must_mention | 18/22 · 53/63 · 11/11 |
| Findings field accuracy · doc classification · summary coverage | 37/37 · 5/5 · 7/7 |
| Consistency | 22/22 same readiness across runs |

Read with care:
- Circular: one author wrote documents, gold and prompts, and prompts were adjusted while looking at
  these 22 questions. A regression harness, not a benchmark.
- Consistency is weak evidence: temperature 0, three runs minutes apart on a warm cache. Across prompt
  versions IAM-04 did flip between Conflict and Needs Evidence.
- Citation accuracy counts any location not listed in gold as wrong, even when the passage is relevant
  (e.g. SOC 2 p.8 for GOV-01).
- The 3 readiness misses all fail safe (held back, not pushed to Ready): IAM-02, DATA-02, BCP-01.

`npm run eval:tprm` exits 1 if any answer is unsafely Ready, so it can gate prompt changes.

### Step 4 results (real model, full pipeline steps 2–4, 22 questions, as-of 2026-10-30)

One run each, scratch comparison against gold; the formal eval is step 5. ~65 s for 22 questions.

| | First run (draft v1, verify v1, gather v1) | **After fixes (draft v2, verify v2, gather v2)** |
|---|---|---|
| Readiness matches gold (incl. acceptable) | 13/22 | **19/22** |
| Unsafe Ready | **1 (IAM-03)** | **0** |
| Ready | 4 | 10 (gold: 12) |

Causes found and fixed (general rules, not per-question patches):
- **No date in prompts.** The model called June 30, 2026 "a future date" (GOV-02, BCP-01). Drafter and
  verifier now get `<today>`; runs take an `asOf` date (the eval pins 2026-10-30).
- **"SOC 2 Type 2" counted as the number 2** by the number check → framework names excluded.
- **Carve-out attached to unrelated questions** (encryption, data location) because the gather prompt
  listed carve-outs as a generic `limits` example → v2 limits a carve-out to the carved-out controls.
- **Remediated finding treated as a current gap** (TLS 1.0 on SMTP relay) → draft v2: remediated and
  verified is history.
- **IAM-03 unsafe Ready:** the drafter correctly said `partial`, the verifier correctly said supported,
  so nothing held it back → new rule `GAP_DISCLOSED` (below).

Remaining differences (all fail safe): IAM-02 Conflict (known false positive), DATA-02 verifier objected
to unrelated open findings on the cited pen test page, BCP-01 carve-out still attached to DR. DATA-05
readiness right but labelled `not_addressed` instead of `partial`. IAM-04 was Needs Evidence this run
(Conflict in step 3 runs): the conflict call varies between runs on this question.

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
| Citation relocation | Exact quote at exactly one other location in the same document → locator corrected, `relocated_from` kept | Wrong page numbers are bookkeeping; invented quotes and wrong-document quotes still fail. |
| Conflict schema order | `explanation` before `conflict` | Structured output follows schema order; verdict-first produced self-contradicting explanations. |
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
| 6a | A digit in the answer is not on any cited page or in the question (added step 4) | Needs Evidence | `UNSUPPORTED_NUMBER` |
| 7 | Answer relies on an auditor exception or open critical/high finding | Needs Evidence | `CONTROL_EXCEPTION` |
| 8 | Answer relies on a subservice carve-out (e.g. AWS physical security) | Needs Evidence | `CARVE_OUT` |
| 8a | Answer is `partial` or `no`: the vendor is admitting a gap (added step 4) | Needs Evidence | `GAP_DISCLOSED` |
| 9 | Verifier says unsupported / partially supported | Needs Evidence | `VERIFIER_UNSUPPORTED` / `VERIFIER_PARTIAL` |
| 10 | Model confidence < 0.7 | Needs Evidence | `LOW_CONFIDENCE` |
| — | Everything passed **and** the verifier said `supported` | **Ready** | — |

How the rules get their inputs (`services/tprm/answer.ts`, `readiness.ts`):
- Rules 4–6 apply to the passages the answer stands on. The drafter only sees verified passages, so
  they fire when nothing verified, or when a `limits`/`contradicts` passage failed its quote check (an
  adverse passage must not vanish because its quote was wrong).
- Rules 7–8 use step 2 findings: a cited passage, or any verified adverse passage the drafter saw,
  whose quote overlaps the finding's quote on the same page/row. Same page alone is not enough (SOC 2
  p.11 has both the clean MFA control and the CC6.2 exception).
- All rules that apply are stored in `reasons`; the first sets readiness. A skipped or failed verifier
  never yields Ready.

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
3. **gather_evidence.v2** — per question, against cached evidence (v2: carve-outs limit only carved-out controls). Return every relevant passage from
   every document with stance `supports | limits | contradicts`. Never write an answer.
4. **detect_conflict.v2** — verified passages only; explanation generated before the verdict. Conflict = incompatible claims about the same control
   and scope. Different wording that is compatible, or a policy stricter than what was tested, is NOT a
   conflict. Output: `{conflict, a, b, explanation}`.
5. **draft_answer.v2** — verified passages only; gets `<today>`; remediated + verified findings are history. Answer `yes | no | partial | not_addressed`. Disclose
   exceptions. Never cite outside the given passages. Never invent numbers (RTO/RPO trap).
6. **verify_support.v2** — question + answer + full text of cited units + `<today>`; reason before verdict. Verdict
   `supported | partially_supported | unsupported` + reason. Scope mismatch (one business day vs
   24 hours; production-only vs all users) = partially supported.

## Data model

Migration: `docs/migrations/2026-10-30_security_review.sql` (run on live Supabase, verified).
Rollback: `docs/migrations/2026-10-30_security_review.down.sql`.
Step 2 migration: `docs/migrations/2026-10-31_security_review_additions.sql` (**not run yet**; rollback `.down.sql`).

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
| `src/server/services/tprm/evidence.ts` | Step 3: cached evidence context, gather → quote check → conflict check per question |
| `src/server/services/tprm/scoreEvidence.ts` | Scores step 3 against gold: evidence recall, conflict recall/pairs, false positives, traps |
| `src/server/services/tprm/answer.ts` | Step 4: draft from verified passages → number check → verifier → readiness inputs |
| `src/server/services/tprm/readiness.ts` | Readiness rules as a pure function |
| `src/server/services/tprm/scoreAnswers.ts` | Scores answers: unsafe Ready, conflict recall/FPs, Needs Evidence recall, accuracy |
| `scripts/tprm/eval.ts` | `npm run eval:tprm`: whole pipeline, all scorers, RUNS for consistency, JSON + Markdown |
| `src/server/services/tprm/pool.ts` | Bounded concurrency with a cache warm-up call first |
| `scripts/tprm/evidence-samples.ts` | Live steps 2–3 on the samples + score (`npm run tprm:evidence-samples`, `ONLY=IAM-01,…`) |
| `src/server/services/tprm/testing/fakeLlm.ts` | Fake `TprmLlm` for offline tests (same zod validation path) |
| `src/server/prompts/tprm/*.vN.md` | Versioned prompts; old versions kept |
| `scripts/tprm/analyze-samples.ts` | Live step 2 run on the samples + score (`npm run tprm:analyze-samples`) |
| `src/server/routes/securityReview.ts` | Router factory (auth + store injected so tests need no credentials) |
| `scripts/tprm/generate_samples.py` | Regenerates synthetic documents (`py -3.14` on Windows) |
| `scripts/tprm/verify-samples.ts` | Checks every gold anchor against parsed documents |
| `test_data/tprm/gold.json` | Expected answers, readiness, evidence locations, conflicts, findings, remediation |

Commands: `npm test`, `npm run tprm:verify-samples`, `npx tsc --noEmit -p tsconfig.server.json`,
`npx tsc --noEmit`, `npx tsc -p tsconfig.scripts.json` (scripts are outside the other two configs). Live (needs `ANTHROPIC_API_KEY`; costs a few cents): `npm run eval:tprm` (whole pipeline, `RUNS=3` for
consistency), `npm run tprm:analyze-samples` (step 2 only), `npm run tprm:evidence-samples` (steps 2–3).
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
