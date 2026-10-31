import { PROMPTS } from '../analyze.js'
import { ANSWER_PROMPTS } from '../answer.js'
import { EVIDENCE_PROMPTS } from '../evidence.js'
import { LlmUsage, parseStructured, StructuredRequest, StructuredResult, TprmLlm } from '../llm.js'

// What a fake returns for one call: a value to serialize as the model's JSON output,
// raw text (to test malformed output), or an API failure.
export type FakeReply = { json: unknown } | { raw: string } | { apiError: string }

const USAGE: LlmUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// Test double for TprmLlm, keyed by prompt version. Output goes through the same zod
// validation as the real client, so schema failures behave the same way.
export class FakeTprmLlm implements TprmLlm {
  readonly model = 'fake-model'
  calls: { task: string; input: string | undefined; context: string }[] = []

  // delayMs makes each call take real time, for tests that need a run to be in flight
  constructor(
    private readonly replies: Record<string, FakeReply | ((input: string | undefined, context: string) => FakeReply)>,
    private readonly delayMs = 0,
  ) {}

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ task: req.task.version, input: req.input, context: req.context })
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs))
    const entry = this.replies[req.task.version]
    if (!entry) throw new Error(`FakeTprmLlm: no reply for ${req.task.version}`)
    const reply = typeof entry === 'function' ? entry(req.input, req.context) : entry
    if ('apiError' in reply) return { ok: false, error: 'api_error', message: reply.apiError, usage: null }
    const parsed = parseStructured(req.schema, 'raw' in reply ? reply.raw : JSON.stringify(reply.json))
    return parsed.ok
      ? { ok: true, data: parsed.data, usage: USAGE }
      : { ok: false, error: 'schema_invalid', message: parsed.message, usage: USAGE }
  }
}

// A fake for the whole pipeline on the sample documents (evidence ids D1-D5 by filename):
// the pen test yields two open findings (PT-01 Critical, PT-03 High) and the policy is typed as a
// policy, so remediation has something to work with; every question gets the SOC 2 VPN passage
// and a supported "yes"; IAM-01 gets a policy vs pen test conflict; IAM-04 cites access review
// row 27, so spreadsheet citations are exercised too. No API calls.
export function fakePipelineLlm(overrides: Record<string, FakeReply> = {}, delayMs = 0): FakeTprmLlm {
  const passage = (document: string, page: number, quote: string, stance: string) =>
    ({ document, location: { page, sheet: null, row: null }, quote, stance, note: '' })
  const VPN = passage('D5', 11, 'Multi-factor authentication is required for remote access to the production network via VPN', 'supports')
  const POLICY = passage('D2', 3, 'Multi-factor authentication is enforced for all interactive access to Acme systems', 'supports')
  const PENTEST = passage('D3', 3, 'accepts a username and password without requiring multi-factor authentication', 'contradicts')
  const ACCESS_ROW = { document: 'D1', location: { page: null, sheet: 'Q2-2026 Review', row: 27 }, quote: 'User: ctr.mbaker', stance: 'limits', note: '' }
  return new FakeTprmLlm({
    [PROMPTS.extract]: (_input, context) => {
      if (context.includes('filename="acme_pentest_summary_2026.pdf"')) {
        const finding = (ref: string, title: string, severity: string, quote: string) => ({
          kind: 'pentest_finding', ref, title, stated_severity: severity, status: 'open', detail: null,
          location: { page: 3, sheet: null, row: null }, quote,
        })
        return { json: { doc_type: 'pentest_summary', doc_type_reason: 'fake', findings: [
          finding('PT-01', 'VPN appliance firmware vulnerable to remote code execution', 'Critical', 'the finding remains open, 45 days after it was reported'),
          finding('PT-03', 'Administrative portal without multi-factor authentication', 'High', 'accepts a username and password without requiring multi-factor authentication'),
        ] } }
      }
      const isPolicy = context.includes('filename="acme_infosec_access_control_policy_v3.2.pdf"')
      return { json: { doc_type: isPolicy ? 'security_policy' : 'other', doc_type_reason: 'fake', findings: [] } }
    },
    [PROMPTS.summarize]: { json: { headline: 'fake', top_findings: [], key_exceptions: [], takeaways: [] } },
    [EVIDENCE_PROMPTS.gather]: (input) => ({ json: { passages:
      input?.includes('ref="IAM-01"') ? [POLICY, PENTEST] : input?.includes('ref="IAM-04"') ? [ACCESS_ROW] : [VPN] } }),
    [EVIDENCE_PROMPTS.conflict]: { json: { explanation: 'P1 commits to MFA everywhere; P2 found a portal without it.', conflict: true, a: 1, b: 2 } },
    [ANSWER_PROMPTS.draft]: { json: { response_text: 'Acme requires MFA for VPN access.', answer: 'yes', cited: [1], confidence: 0.9 } },
    [ANSWER_PROMPTS.verify]: { json: { reason: 'ok', verdict: 'supported' } },
    ...overrides,
  }, delayMs)
}
