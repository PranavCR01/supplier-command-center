import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as z from 'zod/v4'

// Model is config so the eval can compare models; defaults to the app's Haiku 4.5
export const DEFAULT_TPRM_MODEL = 'claude-haiku-4-5-20251001'

const PROMPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../prompts/tprm')

export interface Prompt {
  version: string   // file stem, e.g. "classify_and_extract.v1" — stored with every output
  text: string
}

// A prompt change is a code change: prompts live in versioned files and the version
// string is recorded next to whatever the prompt produced.
export function loadPrompt(version: string): Prompt {
  return { version, text: fs.readFileSync(path.join(PROMPTS_DIR, `${version}.md`), 'utf-8').trim() }
}

export interface LlmUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export interface StructuredRequest<T> {
  system: Prompt
  task: Prompt
  // Large shared input (documents) sent first and marked cacheable
  context: string
  // Small per-call input appended after the task prompt
  input?: string
  schema: z.ZodType<T>
  maxTokens: number
}

export type LlmFailure = 'api_error' | 'refusal' | 'truncated' | 'schema_invalid'

export type StructuredResult<T> =
  | { ok: true; data: T; usage: LlmUsage }
  | { ok: false; error: LlmFailure; message: string; usage: LlmUsage | null }

export interface TprmLlm {
  readonly model: string
  structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>
}

// Structured outputs accept a subset of JSON Schema; zod emits a few keywords it rejects
const UNSUPPORTED_KEYS = new Set(['$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minLength', 'maxLength', 'maxItems', 'pattern', 'format'])

function stripUnsupported(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupported)
  if (node === null || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) {
    if (UNSUPPORTED_KEYS.has(k)) continue
    if (k === 'minItems' && typeof v === 'number' && v > 1) continue
    out[k] = stripUnsupported(v)
  }
  return out
}

export function toOutputSchema(schema: z.ZodType): Record<string, unknown> {
  return stripUnsupported(z.toJSONSchema(schema, { io: 'output' })) as Record<string, unknown>
}

// Shared by the real client and test fakes so both validate model output the same way
export function parseStructured<T>(schema: z.ZodType<T>, raw: string): { ok: true; data: T } | { ok: false; message: string } {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (err) {
    return { ok: false, message: `not JSON: ${err instanceof Error ? err.message : String(err)}` }
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  }
  return { ok: true, data: parsed.data }
}

export class AnthropicTprmLlm implements TprmLlm {
  private readonly client: Anthropic

  constructor(readonly model: string = process.env.TPRM_MODEL || DEFAULT_TPRM_MODEL, apiKey = process.env.ANTHROPIC_API_KEY) {
    this.client = new Anthropic({ apiKey })
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    let message: Anthropic.Message
    try {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: req.maxTokens,
        temperature: 0,
        system: req.system.text,
        output_config: { format: { type: 'json_schema', schema: toOutputSchema(req.schema) } },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: req.context, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: req.input ? `${req.task.text}\n\n${req.input}` : req.task.text },
          ],
        }],
      })
    } catch (err) {
      return { ok: false, error: 'api_error', message: err instanceof Error ? err.message : String(err), usage: null }
    }

    const usage: LlmUsage = {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
    }
    if (message.stop_reason === 'refusal') return { ok: false, error: 'refusal', message: 'model refused', usage }
    if (message.stop_reason === 'max_tokens') {
      return { ok: false, error: 'truncated', message: `output hit max_tokens (${req.maxTokens})`, usage }
    }

    const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const parsed = parseStructured(req.schema, text)
    return parsed.ok
      ? { ok: true, data: parsed.data, usage }
      : { ok: false, error: 'schema_invalid', message: parsed.message, usage }
  }
}
