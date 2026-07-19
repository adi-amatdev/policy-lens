import type { ExtractedSection, RiskFlag } from './messages'
import { RISK_FLAG_PROMPT } from './riskFlags'

type SummarizerBackend = 'builtin' | 'transformers' | 'none'

let backend: SummarizerBackend = 'none'
let transformersPipeline: any = null
let builtinSummarizer: any = null

const MAX_CHUNK_CHARS = 3000

export async function initModel(): Promise<SummarizerBackend> {
  if (backend !== 'none') return backend

  try {
    if (typeof (window as any).ai !== 'undefined' && (window as any).ai?.summarizer) {
      builtinSummarizer = await (window as any).ai.summarizer.create()
      backend = 'builtin'
      console.log('[Model] Using Chrome built-in Summarizer API')
      return backend
    }
  } catch {
    console.log('[Model] Built-in API not available, trying Transformers.js')
  }

  try {
    const { pipeline } = await import('@huggingface/transformers')
    transformersPipeline = await pipeline('summarization', 'Xenova/distilbart-cnn-6-6')
    backend = 'transformers'
    console.log('[Model] Using Transformers.js with distilbart-cnn-6-6')
    return backend
  } catch (e) {
    console.warn('[Model] Transformers.js failed to load:', e)
    backend = 'none'
    return backend
  }
}

function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const chunks: string[] = []
  const sentences = text.split(/(?<=[.!?])\s+/)
  let current = ''
  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChars && current.length > 0) {
      chunks.push(current)
      current = sentence
    } else {
      current = current ? current + ' ' + sentence : sentence
    }
  }
  if (current) chunks.push(current)
  return chunks
}

export async function summarizeSection(section: ExtractedSection): Promise<string> {
  const chunks = chunkText(section.bodyText, MAX_CHUNK_CHARS)
  if (chunks.length === 1) {
    const prompt = `Summarize the following section of a legal/policy document in 2-3 plain-English sentences.
Focus on what it means for the user practically. Do not use legal jargon.

Section heading: "${section.headingText}"
Section text:
"""
${section.bodyText}
"""`
    return runModel(prompt)
  }

  const summaries: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const prompt = `Summarize the following chunk of a legal/policy document section in 1-2 plain-English sentences.
Section heading: "${section.headingText}" (part ${i + 1}/${chunks.length})
Section text:
"""
${chunks[i]}
"""`
    const result = await runModel(prompt)
    summaries.push(result)
  }
  const combined = summaries.join(' ')
  const finalPrompt = `Combine these partial summaries into one concise 2-3 sentence summary:
${combined}`
  return runModel(finalPrompt)
}

export async function classifyRisk(bodyText: string): Promise<RiskFlag[]> {
  const truncated = bodyText.length > MAX_CHUNK_CHARS ? bodyText.slice(0, MAX_CHUNK_CHARS) : bodyText
  const prompt = RISK_FLAG_PROMPT.replace('{bodyText}', truncated)
  const result = await runModel(prompt)
  return extractRiskFlags(result)
}

export async function explainDiff(oldText: string, newText: string): Promise<string> {
  const oldTruncated = oldText.length > MAX_CHUNK_CHARS ? oldText.slice(0, MAX_CHUNK_CHARS) : oldText
  const newTruncated = newText.length > MAX_CHUNK_CHARS ? newText.slice(0, MAX_CHUNK_CHARS) : newText
  const prompt = `A company changed this section of their policy. Explain in 1-2 plain-English sentences what
changed and why it matters to the user. Be specific about what is newly allowed, removed, or restricted.
Do not restate the full text.

Previous version:
"""
${oldTruncated}
"""

New version:
"""
${newTruncated}
"""`

  return runModel(prompt)
}

async function runModel(prompt: string): Promise<string> {
  if (backend === 'builtin' && builtinSummarizer) {
    return runBuiltin(prompt)
  }
  if (backend === 'transformers' && transformersPipeline) {
    return runTransformers(prompt)
  }
  return '[Model not available]'
}

async function runBuiltin(prompt: string): Promise<string> {
  try {
    const result = await builtinSummarizer.summarize(prompt)
    return typeof result === 'string' ? result : result?.text || '[No result]'
  } catch {
    return '[Built-in summarization failed]'
  }
}

async function runTransformers(prompt: string): Promise<string> {
  try {
    const result = await transformersPipeline(prompt, {
      max_length: 150,
      min_length: 30,
      do_sample: false,
    })
    if (Array.isArray(result) && result[0]?.summary_text) {
      return result[0].summary_text
    }
    if (typeof result === 'string') return result
    return '[Could not summarize]'
  } catch {
    return '[Transformers summarization failed]'
  }
}

function extractRiskFlags(raw: string): RiskFlag[] {
  try {
    const jsonStart = raw.indexOf('[')
    const jsonEnd = raw.lastIndexOf(']')
    if (jsonStart === -1 || jsonEnd === -1) return []
    const json = raw.slice(jsonStart, jsonEnd + 1)
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (f: any) => f?.category && f?.reason
      ) as RiskFlag[]
    }
    return []
  } catch {
    return []
  }
}
