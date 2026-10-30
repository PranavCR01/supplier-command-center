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

  constructor(private readonly replies: Record<string, FakeReply | ((input: string | undefined, context: string) => FakeReply)>) {}

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ task: req.task.version, input: req.input, context: req.context })
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
