import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Loaded once at startup — cached in memory and sent with cache_control
const systemPromptText = fs.readFileSync(
  path.join(__dirname, '../prompts/procurement.system.md'),
  'utf-8'
)

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const MODEL = 'claude-haiku-4-5-20251001'
export const MAX_OUTPUT_TOKENS = 1500

// ~4 chars per token → 4000 token budget ≈ 16 000 chars
const MAX_INPUT_CHARS = 16_000

export function truncateToLimit(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_INPUT_CHARS) return { text, truncated: false }
  return {
    text: text.slice(0, MAX_INPUT_CHARS) + '\n\n[Document truncated to fit context window]',
    truncated: true,
  }
}

// One-shot JSON call — no streaming, used for analysis endpoints
export async function callJson(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 300
): Promise<string> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  })

  const block = message.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type')
  return block.text
}

export async function streamDraft(
  userMessage: string,
  onChunk: (text: string) => void
): Promise<{ inputTokens: number; outputTokens: number }> {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    // System prompt cached — billed once per 5-minute TTL window
    system: [
      {
        type: 'text',
        text: systemPromptText,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  })

  stream.on('text', (text) => onChunk(text))

  const final = await stream.finalMessage()
  return {
    inputTokens: final.usage.input_tokens,
    outputTokens: final.usage.output_tokens,
  }
}
