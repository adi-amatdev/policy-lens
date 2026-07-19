import type { ExtractedSection, RiskFlag } from './messages'
import { RISK_CATEGORIES } from './riskFlags'

let transformersPipeline: any = null
let modelReady = false
let modelLoading = false

const MODEL_CHUNK_CHARS = 800

export function isModelReady(): boolean {
  return modelReady
}

export function isModelLoading(): boolean {
  return modelLoading
}

export function loadModelInBackground() {
  if (modelLoading || modelReady) return
  modelLoading = true
  console.log('[Model] Starting background model load...')
  import('@huggingface/transformers')
    .then(({ pipeline }) =>
      pipeline('summarization', 'Xenova/distilbart-cnn-6-6', {
        progress_callback: (p: any) => {
          if (p.status === 'progress') console.log(`[Model] Download: ${Math.round(p.progress || 0)}%`)
          if (p.status === 'done') console.log('[Model] Model download complete')
        },
      })
    )
    .then((pipe) => {
      transformersPipeline = pipe
      modelReady = true
      console.log('[Model] Transformers.js model loaded and ready')
    })
    .catch((e) => {
      console.error('[Model] Background model load failed:', e)
    })
    .finally(() => {
      modelLoading = false
    })
}

export async function summarizeSection(section: ExtractedSection): Promise<string> {
  if (modelReady && transformersPipeline) {
    try {
      const input = section.bodyText.slice(0, MODEL_CHUNK_CHARS)
      const result = await transformersPipeline(input, {
        max_length: 150,
        min_length: 20,
        do_sample: false,
      })
      if (Array.isArray(result) && result[0]?.summary_text) {
        return result[0].summary_text
      }
    } catch (e) {
      console.warn('[Model] Transformers inference failed, using extractive:', e)
    }
  }

  return extractiveSummarize(section.bodyText, section.headingText)
}

export async function classifyRisk(bodyText: string): Promise<RiskFlag[]> {
  return keywordRiskFlags(bodyText)
}

export async function explainDiff(oldText: string, newText: string): Promise<string> {
  if (modelReady && transformersPipeline) {
    try {
      const prompt = `What changed and why it matters:\nOld: ${oldText.slice(0, MODEL_CHUNK_CHARS)}\nNew: ${newText.slice(0, MODEL_CHUNK_CHARS)}`
      const result = await transformersPipeline(prompt, { max_length: 100, min_length: 10, do_sample: false })
      if (Array.isArray(result) && result[0]?.summary_text) return result[0].summary_text
    } catch {}
  }

  return extractiveDiffSummary(oldText, newText)
}

function extractiveSummarize(text: string, heading: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || []
  if (sentences.length === 0) return text.slice(0, 300) || 'No content extracted.'
  const picked = sentences.slice(0, 3).map((s) => s.trim())
  return picked.join(' ')
}

function extractiveDiffSummary(oldText: string, newText: string): string {
  const oldSentences = new Set(
    (oldText.match(/[^.!?]+[.!?]+/g) || []).map((s) => s.trim().toLowerCase())
  )
  const newSentences = (newText.match(/[^.!?]+[.!?]+/g) || []).map((s) => s.trim())
  const added = newSentences.filter((s) => !oldSentences.has(s.toLowerCase()))
  if (added.length > 0) {
    return `New content added: ${added.slice(0, 2).join(' ').slice(0, 300)}`
  }
  return 'This section was modified.'
}

function keywordRiskFlags(bodyText: string): RiskFlag[] {
  const lower = bodyText.toLowerCase()
  const flags: RiskFlag[] = []

  const checks: [RiskFlag['category'], string[], string][] = [
    ['arbitration', ['arbitration', 'mandatory arbitration', 'binding arbitration', 'class action waiver'], 'Requires binding arbitration — you waive your right to sue in court or join a class action'],
    ['data-sharing', ['share your data', 'third-party', 'third parties', 'data sharing', 'sell your data', 'advertising partners'], 'Your data may be shared with or sold to third parties for advertising or other purposes'],
    ['auto-renewal', ['auto-renew', 'automatically renew', 'subscription renew'], 'Subscriptions renew automatically — you may be charged unless you cancel before the renewal date'],
    ['unilateral-changes', ['we reserve the right to modify', 'we may change', 'at our sole discretion', 'without notice'], 'The company can change these terms at any time without notifying you'],
    ['liability-waiver', ['not liable', 'no liability', 'as-is', 'without warranty', 'limitation of liability'], 'The company disclaims liability — you cannot hold them responsible for damages or losses'],
    ['data-retention', ['retain', 'retention', 'store your data', 'data stored', 'keep your data'], 'Your data is stored and retained — the policy may not specify when it is deleted'],
  ]

  const sentences = bodyText.match(/[^.!?]+[.!?]+/g) || []

  for (const [category, keywords, reason] of checks) {
    for (const kw of keywords) {
      const idx = lower.indexOf(kw)
      if (idx !== -1) {
        let snippet = ''
        for (const sentence of sentences) {
          if (sentence.toLowerCase().includes(kw)) {
            snippet = sentence.trim()
            break
          }
        }
        if (!snippet) {
          const start = Math.max(0, idx - 50)
          const end = Math.min(bodyText.length, idx + kw.length + 50)
          snippet = bodyText.slice(start, end).trim()
          if (start > 0) snippet = '...' + snippet
          if (end < bodyText.length) snippet = snippet + '...'
        }
        flags.push({ category, reason, snippet })
        break
      }
    }
  }

  return flags
}
