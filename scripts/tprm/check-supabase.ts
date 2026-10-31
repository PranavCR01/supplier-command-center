// Exercises the Supabase store end to end against your real project: migration columns,
// storage upload/download/signed URL, documents, units, findings, a full questionnaire run,
// answers and activity events.
//
// Usage (locally, with .env holding VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
//   npm run tprm:check-supabase -- <inbox_request_id>            fake model (free); deletes what it created
//   npm run tprm:check-supabase -- <inbox_request_id> --keep     fake model; keep the data to inspect it
//   npm run tprm:check-supabase -- <inbox_request_id> --real     Haiku (needs ANTHROPIC_API_KEY); keeps the data
//   npm run tprm:check-supabase -- <inbox_request_id> --cleanup  delete ALL security review data for the request
//
// The fake model writes placeholder analysis (doc type "other", empty summaries). A real run would
// reuse it, so fake mode only runs on a request with no security review data and removes its own
// rows afterwards, also when a check fails. Activity events are append-only and never deleted.

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { todayIso } from '../../src/server/services/tprm/answer.js'
import { ingestDocument } from '../../src/server/services/tprm/ingest.js'
import { AnthropicTprmLlm, TprmLlm } from '../../src/server/services/tprm/llm.js'
import { executeRun, prepareRun } from '../../src/server/services/tprm/run.js'
import { SupabaseSecurityReviewStore } from '../../src/server/services/tprm/store.js'
import { fakePipelineLlm } from '../../src/server/services/tprm/testing/fakeLlm.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DOCS = path.join(ROOT, 'test_data/tprm/documents')
const [requestId, ...flags] = process.argv.slice(2)
const real = flags.includes('--real')

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}
const ok = (message: string) => console.log(`✓ ${message}`)

if (!requestId) fail('Pass an inbox request id: npm run tprm:check-supabase -- <inbox_request_id>')
const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) fail('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env)')
if (real && !process.env.ANTHROPIC_API_KEY) fail('--real needs ANTHROPIC_API_KEY')

const db = createClient(url, key)
const store = new SupabaseSecurityReviewStore(db)

const { data: request, error: requestError } = await db.from('inbox_requests').select('id, supplier_id').eq('id', requestId).maybeSingle()
if (requestError || !request) fail(`inbox request ${requestId} not found${requestError ? `: ${requestError.message}` : ''}`)
const supplierId = request.supplier_id as string
ok(`request ${requestId} belongs to supplier ${supplierId}`)

// Deletes runs (answers cascade) and documents (units, findings cascade) plus stored files
async function removeSecurityReviewData(): Promise<string> {
  const runs = await db.from('questionnaire_runs').delete().eq('request_id', requestId).select('id')
  const docs = await db.from('security_documents').delete().eq('request_id', requestId).select('id, storage_path')
  if (runs.error || docs.error) fail(`cleanup failed: ${runs.error?.message ?? docs.error?.message}`)
  const paths = (docs.data ?? []).map((d) => d.storage_path as string | null).filter((p): p is string => Boolean(p))
  if (paths.length) await db.storage.from('security-docs').remove(paths)
  return `deleted ${runs.data?.length ?? 0} run(s), ${docs.data?.length ?? 0} document(s) and ${paths.length} stored file(s); activity events kept`
}

if (flags.includes('--cleanup')) {
  ok(await removeSecurityReviewData())
  process.exit(0)
}
if (!real && (await store.listDocuments(requestId)).length > 0) {
  fail('this request already has security review data; the fake model would mix placeholder analysis into it. ' +
    'Use another request, --real, or --cleanup first.')
}

// From here on, fake mode owns every security review row on this request (the check above made
// sure there were none), so a failure removes them too and the request is ready for a re-run.
const ownsData = !real && !flags.includes('--keep')
async function abort(message: string): Promise<never> {
  console.error(`✗ ${message}`)
  if (ownsData) console.error(`  cleanup: ${await removeSecurityReviewData()}`)
  process.exit(1)
}

// 1. Migration columns (2026-10-31_security_review_additions.sql)
for (const [table, column] of [['security_documents', 'analysis_status'], ['questionnaire_runs', 'as_of'], ['questionnaire_answers', 'question_row'], ['questionnaire_answers', 'final_answer']]) {
  const { error } = await db.from(table).select(column).limit(1)
  if (error) await abort(`${table}.${column} missing — run docs/migrations/2026-10-31_security_review_additions.sql (${error.message})`)
}
ok('migration columns present')

// 2. Upload, store and parse the sample documents (re-running is a no-op: sha256 de-dup)
const ctx = { store, supplierId, requestId, userId: null }
for (const file of fs.readdirSync(DOCS).filter((f) => /\.(pdf|xlsx)$/.test(f)).sort()) {
  const r = await ingestDocument(ctx, { filename: file, data: new Uint8Array(fs.readFileSync(path.join(DOCS, file))) })
  if (r.document.parse_status !== 'parsed') await abort(`${file}: ${r.document.parse_status} ${r.document.parse_error ?? ''}`)
  if (!r.document.storage_path) await abort(`${file}: original not stored (check the security-docs bucket)`)
}
const docs = await store.listDocuments(requestId)
ok(`${docs.length} documents stored and parsed`)
const questionnaire = docs.find((d) => d.role === 'questionnaire')!
const bytes = await store.downloadOriginal(questionnaire.storage_path!)
const link = await store.signedUrl(questionnaire.storage_path!, 60)
ok(`storage round trip: downloaded ${bytes.byteLength} bytes; signed URL ${link.slice(0, 40)}…`)

// 3. Full run: analysis (findings + summaries), answers, run record, events
const llm: TprmLlm = real ? new AnthropicTprmLlm() : fakePipelineLlm()
const prepared = await prepareRun({ ...ctx, llm }).catch((err: Error) => abort(`run rejected: ${err.message}`))
let answers = 0
const run = await executeRun({ ...ctx, llm }, prepared, {
  asOf: todayIso(),
  onEvent: (e) => {
    if (e.type === 'analysis') console.log(`  analyzed ${e.filename}: ${e.status}`)
    if (e.type === 'answer') answers = e.done
  },
})
if (run.status !== 'completed') await abort(`run ${run.id} ${run.status}: ${run.error}`)
ok(`run ${run.id} completed with ${model(llm)}: ${answers} answers (ready ${run.stats?.ready}, needs evidence ${run.stats?.needs_evidence}, conflict ${run.stats?.conflict})`)

// 4. Read everything back through the store
const saved = await store.listAnswers(run.id)
const findings = await store.listFindings(docs.map((d) => d.id))
const analyzed = (await store.listDocuments(requestId)).filter((d) => d.analysis_status === 'analyzed').length
const events = await store.listEvents(requestId)
if (saved.length !== prepared.questions.length) await abort(`expected ${prepared.questions.length} saved answers, found ${saved.length}`)
ok(`read back: ${saved.length} answers, ${findings.length} findings, ${analyzed} analyzed documents, ${events.length} activity events`)
ok(`latest events: ${events.slice(0, 3).map((e) => e.event_type).join(', ')}`)
if (!real && !flags.includes('--keep')) ok(`fake-model data removed: ${await removeSecurityReviewData()}`)
console.log(`\nAll Supabase checks passed.${real || flags.includes('--keep') ? ' Data kept; remove it with --cleanup.' : ''}`)

function model(l: TprmLlm) {
  return real ? l.model : 'the fake model'
}
