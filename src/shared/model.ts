import type { ExtractedSection, SectionResult, RiskFlag } from './messages'

type SummarizerBackend = 'builtin' | 'transformers' | 'none'

let backend: SummarizerBackend = 'none'
let transformersPipeline: any = null
let builtinSummarizer: any = null

const BUILTIN_RISK_TEMPLATE = `Read the following policy section. Identify which of these categories apply, if any:
data-sharing, arbitration, auto-renewal, unilateral-changes, liability-waiver, data-retention.
For each that applies, give a one-sentence reason. Respond as JSON array.

Section: {sectionText}`

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

export async function summarizeSection(section: ExtractedSection): Promise<string> {
  const prompt = `Summarize the following section of a legal/policy document in 2-3 plain-English sentences.
Focus on what it means for the user practically. Do not use legal jargon.

Section heading: "${section.headingText}"
Section text:
"""
${section.bodyText}
"""`

  return runModel(prompt)
}

export async function classifyRisk(bodyText: string): Promise<RiskFlag[]> {
  const prompt = BUILTIN_RISK_TEMPLATE.replace('{sectionText}', bodyText)
  const result = await runModel(prompt)
  return extractRiskFlags(result)
}

export async function explainDiff(oldText: string, newText: string): Promise<string> {
  const prompt = `A company changed this section of their policy. Explain in 1-2 plain-English sentences what
changed and why it matters to the user. Be specific about what is newly allowed, removed, or restricted.

Previous version:
"""
${oldText}
"""

New version:
"""
${newText}
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
