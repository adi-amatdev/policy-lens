import type { ExtractedSection, RiskFlag, SectionResult } from './messages'

const SUMMARY_MAX_SENTENCES = 5
const SUMMARY_MAX_CHARS = 700
const MAX_MODEL_SENTENCES = 24
const MAX_SENTENCE_CHARS = 480
const EMBEDDING_MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
const EMBEDDING_DTYPE = 'q8'

type FeatureExtractor = (texts: string | string[], options?: { pooling?: 'mean'; normalize?: boolean }) => Promise<{
  data: Float32Array | number[]
  dims: number[]
}>

interface RiskDefinition {
  category: RiskFlag['category']
  semanticLabel: string
  reason: string
  keywords: string[]
  anchors: string[]
}

const RISK_DEFINITIONS: RiskDefinition[] = [
  {
    category: 'arbitration',
    semanticLabel:
      'mandatory binding arbitration, class action waiver, jury trial waiver, disputes must be resolved outside court',
    reason: 'Requires arbitration or limits court/class-action rights for disputes.',
    keywords: ['arbitration', 'binding arbitration', 'class action', 'class-action', 'jury trial', 'waive the right', 'waiver of class'],
    anchors: ['arbitr', 'class action', 'jury', 'court', 'dispute', 'claim', 'waiv'],
  },
  {
    category: 'data-sharing',
    semanticLabel:
      'personal data may be shared, disclosed, sold, transferred, or provided to third parties, advertisers, affiliates, partners, or service providers',
    reason: 'Allows personal data to be shared, disclosed, sold, or transferred to other parties.',
    keywords: ['share your data', 'share personal', 'disclose personal', 'third parties', 'third-party', 'sell your data', 'advertising partners', 'affiliates'],
    anchors: ['data', 'information', 'personal', 'share', 'disclos', 'sell', 'third', 'partner', 'affiliate', 'advertis'],
  },
  {
    category: 'auto-renewal',
    semanticLabel:
      'subscription automatically renews, recurring charges continue until cancellation, renewal fees are charged automatically',
    reason: 'Creates automatic renewal or recurring payment obligations unless you cancel.',
    keywords: ['auto-renew', 'automatically renew', 'automatic renewal', 'subscription renew', 'recurring', 'charged automatically'],
    anchors: ['renew', 'subscription', 'recurring', 'billing', 'charge', 'cancel'],
  },
  {
    category: 'unilateral-changes',
    semanticLabel:
      'company may change, modify, update, amend, suspend, or replace terms at its sole discretion without notice',
    reason: 'Lets the company change terms or service rules with broad discretion.',
    keywords: ['we reserve the right to modify', 'we may change', 'at our sole discretion', 'without notice', 'modify these terms', 'update these terms'],
    anchors: ['modify', 'change', 'update', 'amend', 'sole discretion', 'without notice', 'reserve the right'],
  },
  {
    category: 'liability-waiver',
    semanticLabel:
      'company disclaims warranties, service is provided as is, liability is limited, damages are excluded, user indemnifies company',
    reason: 'Limits company liability, excludes warranties, or shifts responsibility to you.',
    keywords: ['not liable', 'no liability', 'as-is', 'as is', 'without warranty', 'limitation of liability', 'indemnify', 'damages'],
    anchors: ['liable', 'liability', 'warranty', 'warranties', 'as is', 'as-is', 'damages', 'indemnif'],
  },
  {
    category: 'data-retention',
    semanticLabel:
      'personal data is stored, retained, kept, archived, backed up, or preserved after account deletion or for an unspecified period',
    reason: 'Allows data to be stored or retained, sometimes after deletion or without a clear retention period.',
    keywords: ['retain', 'retention', 'store your data', 'data stored', 'keep your data', 'account deletion', 'backup copies'],
    anchors: ['retain', 'retention', 'store', 'stored', 'keep', 'kept', 'delete', 'deletion', 'backup', 'archive'],
  },
]

const IMPORTANT_WORDS = new Set([
  'you', 'your', 'we', 'our', 'data', 'information', 'personal', 'privacy',
  'collect', 'share', 'use', 'store', 'retain', 'delete', 'remove',
  'agree', 'consent', 'accept', 'terms', 'policy', 'notice',
  'arbitration', 'lawsuit', 'class action', 'waive', 'liability',
  'third party', 'third parties', 'advertiser', 'government',
  'cookies', 'tracking', 'analytics', 'log', 'device', 'ip address',
  'security', 'breach', 'encrypt', 'protect',
  'subscribe', 'cancel', 'refund', 'auto-renew', 'charge', 'payment',
  'modify', 'change', 'update', 'amend', 'reserve the right',
  'terminate', 'suspend', 'restrict', 'block', 'ban',
  'jurisdiction', 'governing law', 'dispute', 'claim',
])

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
}

function sentenceScore(sentence: string, totalSentences: number, index: number, wordFreq: Map<string, number>): number {
  let score = 0
  const words = tokenize(sentence)
  const lower = sentence.toLowerCase()

  for (const w of words) {
    const freq = wordFreq.get(w) || 0
    if (freq > 0) score += 1 / freq
  }

  for (const iw of IMPORTANT_WORDS) {
    if (lower.includes(iw)) score += 2
  }

  if (index === 0) score += 3
  if (index === 1) score += 1.5
  if (index === totalSentences - 1) score += 2
  if (index === totalSentences - 2) score += 1

  if (words.length >= 8 && words.length <= 40) score += 1

  return score
}

function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+/g) || [])
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 15)
}

function trimForModel(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_SENTENCE_CHARS)
}

export function extractiveSummarize(text: string, _heading?: string): string {
  const sentences = splitSentences(text)
  if (sentences.length === 0) return text.slice(0, SUMMARY_MAX_CHARS) || 'No content extracted.'
  if (sentences.length <= 2) return sentences.map(compressSentence).join(' ')

  const allWords = tokenize(text)
  const wordFreq = new Map<string, number>()
  for (const w of allWords) {
    wordFreq.set(w, (wordFreq.get(w) || 0) + 1)
  }

  const scored = sentences.map((s, i) => ({
    sentence: s,
    score: sentenceScore(s, sentences.length, i, wordFreq),
    index: i,
  }))

  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, SUMMARY_MAX_SENTENCES)
  top.sort((a, b) => a.index - b.index)

  const parts = top.map((t) => {
    let compressed = compressSentence(t.sentence)
    if (compressed.length > 180) compressed = compressed.slice(0, 177).trim() + '...'
    return compressed
  })

  let result = parts.join(' ')
  if (result.length > SUMMARY_MAX_CHARS) result = result.slice(0, SUMMARY_MAX_CHARS - 3).trim() + '...'
  return result
}

export function extractiveDiffSummary(oldText: string, newText: string): string {
  const oldSentences = new Set(
    (oldText.match(/[^.!?]+[.!?]+/g) || []).map((s) => s.trim().toLowerCase())
  )
  const newSentences = (newText.match(/[^.!?]+[.!?]+/g) || []).map((s) => s.trim())
  const added = newSentences.filter((s) => !oldSentences.has(s.toLowerCase()))
  if (added.length > 0) {
    return `New content added: ${added.slice(0, 3).join(' ').slice(0, 400)}`
  }
  const removed = [...oldSentences].filter((s) => !newSentences.some((ns) => ns.toLowerCase() === s))
  if (removed.length > 0) {
    return `Content removed: ${removed.slice(0, 3).join(' ').slice(0, 400)}`
  }
  return 'This section was modified.'
}

let extractorPromise: Promise<FeatureExtractor | null> | null = null
let riskLabelEmbeddingPromise: Promise<number[][] | null> | null = null

async function getExtractor(): Promise<FeatureExtractor | null> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      try {
        console.log('[PolicyLens] Loading Transformers.js model:', EMBEDDING_MODEL_ID, 'dtype:', EMBEDDING_DTYPE)
        const { pipeline, env, LogLevel } = await import('@huggingface/transformers')
        env.allowLocalModels = false
        env.allowRemoteModels = true
        env.useBrowserCache = true
        env.useWasmCache = true
        env.cacheKey = 'policylens-transformers-cache'
        env.logLevel = LogLevel.WARNING

        const ortMjs = chrome.runtime.getURL('ort/ort-wasm-simd-threaded.asyncify.mjs')
        const ortWasm = chrome.runtime.getURL('ort/ort-wasm-simd-threaded.asyncify.wasm')
        console.log('[PolicyLens] Setting local WASM paths:', ortMjs)
        if (env.backends.onnx?.wasm) {
          env.backends.onnx.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm }
        }

        const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, {
          dtype: EMBEDDING_DTYPE,
        }) as FeatureExtractor
        console.log('[PolicyLens] Model loaded successfully')
        return extractor
      } catch (error: any) {
        console.error('[PolicyLens] ═══ MODEL LOAD FAILED ═══')
        console.error('[PolicyLens] Error name:', error?.name)
        console.error('[PolicyLens] Error message:', error?.message)
        console.error('[PolicyLens] Full error:', error)
        if (error?.cause) console.error('[PolicyLens] Cause:', error.cause)
        return null
      }
    })()
  }
  return extractorPromise
}

function tensorRows(tensor: Awaited<ReturnType<FeatureExtractor>>): number[][] {
  const [rows, cols] = tensor.dims
  const data = Array.from(tensor.data)
  const vectors: number[][] = []
  for (let row = 0; row < rows; row++) {
    vectors.push(data.slice(row * cols, (row + 1) * cols))
  }
  return vectors
}

async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const extractor = await getExtractor()
  if (!extractor || texts.length === 0) return null
  const output = await extractor(texts.map(trimForModel), { pooling: 'mean', normalize: true })
  return tensorRows(output)
}

async function getRiskLabelEmbeddings(): Promise<number[][] | null> {
  if (!riskLabelEmbeddingPromise) {
    riskLabelEmbeddingPromise = embedTexts(RISK_DEFINITIONS.map((def) => def.semanticLabel))
  }
  return riskLabelEmbeddingPromise
}

function dot(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) sum += a[i] * b[i]
  return sum
}

function keywordHits(sentence: string, keywords: string[]): string[] {
  const lower = sentence.toLowerCase()
  return keywords.filter((kw) => lower.includes(kw))
}

function hasAnchor(sentence: string, anchors: string[]): boolean {
  const lower = sentence.toLowerCase()
  return anchors.some((anchor) => lower.includes(anchor))
}

function chooseCandidateSentences(text: string): string[] {
  const sentences = splitSentences(text)
  if (sentences.length <= MAX_MODEL_SENTENCES) return sentences

  const allWords = tokenize(text)
  const wordFreq = new Map<string, number>()
  for (const w of allWords) wordFreq.set(w, (wordFreq.get(w) || 0) + 1)

  return sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: sentenceScore(sentence, sentences.length, index, wordFreq),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MODEL_SENTENCES)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence)
}

function keywordRiskFlags(bodyText: string): RiskFlag[] {
  const sentences = splitSentences(bodyText)
  const fallbackSentences = sentences.length > 0 ? sentences : [bodyText]
  const flags: RiskFlag[] = []

  for (const def of RISK_DEFINITIONS) {
    const match = fallbackSentences.find((sentence) => keywordHits(sentence, def.keywords).length > 0)
    if (match) {
      flags.push({
        category: def.category,
        reason: def.reason,
        snippet: match.trim().slice(0, 280),
      })
    }
  }

  return flags
}

function mergeRiskFlags(primary: RiskFlag[], fallback: RiskFlag[]): RiskFlag[] {
  const byCategory = new Map<RiskFlag['category'], RiskFlag>()
  for (const flag of [...primary, ...fallback]) {
    if (!byCategory.has(flag.category)) byCategory.set(flag.category, flag)
  }
  return Array.from(byCategory.values())
}

function cosineSim(a: number[], b: number[]): number {
  const d = dot(a, b)
  let normA = 0, normB = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) { normA += a[i] * a[i]; normB += b[i] * b[i] }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : d / denom
}

function compressSentence(s: string): string {
  let result = s
  const redundantPatterns = [
    /\b(the company|we|our company|the service provider)\s+(may|might|will|shall|can|reserves? the right to)\s*/gi,
    /\byou (agree|acknowledge|consent|understand|agree that)\s+/gi,
    /\bin (the )?event (that )?/gi,
    /\bfor (the )?(purpose|avoidance) of\b/gi,
    /\bwith respect to\b/gi,
    /\bin accordance with\b/gi,
    /\bpursuant to\b/gi,
    /\bnotwithstanding\b/gi,
  ]
  for (const pattern of redundantPatterns) {
    result = result.replace(pattern, '')
  }
  result = result.replace(/\s+/g, ' ').trim()
  if (result.length > 0) result = result.charAt(0).toUpperCase() + result.slice(1)
  return result
}

function mmrSelect(
  embeddings: number[][],
  sentences: string[],
  count: number,
  lambda = 0.6,
): { sentence: string; index: number }[] {
  const selected: { sentence: string; index: number; embedding: number[] }[] = []
  const candidates = sentences.map((s, i) => ({ sentence: s, index: i, embedding: embeddings[i] }))

  const centroid = new Array(embeddings[0].length).fill(0)
  for (const v of embeddings) { for (let i = 0; i < v.length; i++) centroid[i] += v[i] }
  for (let i = 0; i < centroid.length; i++) centroid[i] /= embeddings.length

  for (let round = 0; round < Math.min(count, candidates.length); round++) {
    let bestScore = -Infinity
    let bestIdx = -1

    for (let c = 0; c < candidates.length; c++) {
      const cand = candidates[c]
      if (selected.some((s) => s.index === cand.index)) continue

      const relevance = cosineSim(cand.embedding, centroid)
      let maxSimToSelected = 0
      for (const s of selected) {
        const sim = cosineSim(cand.embedding, s.embedding)
        if (sim > maxSimToSelected) maxSimToSelected = sim
      }
      const mmrScore = lambda * relevance - (1 - lambda) * maxSimToSelected

      if (mmrScore > bestScore) { bestScore = mmrScore; bestIdx = c }
    }

    if (bestIdx === -1) break
    selected.push(candidates[bestIdx])
  }

  return selected.sort((a, b) => a.index - b.index)
}

function semanticSummary(sentences: string[], embeddings: number[][], _riskLabelEmbeddings: number[][] | null): string {
  if (sentences.length === 0) return 'No content extracted.'
  if (sentences.length <= 2) return sentences.map(compressSentence).join(' ')

  const selected = mmrSelect(embeddings, sentences, SUMMARY_MAX_SENTENCES)

  const parts = selected.map(({ sentence }) => {
    let compressed = compressSentence(sentence)
    if (compressed.length > 180) compressed = compressed.slice(0, 177).trim() + '...'
    return compressed
  })

  let result = parts.join(' ')
  if (result.length > SUMMARY_MAX_CHARS) result = result.slice(0, SUMMARY_MAX_CHARS - 3).trim() + '...'

  return result
}

async function semanticRiskFlags(sentences: string[], embeddings: number[][]): Promise<RiskFlag[]> {
  const riskLabelEmbeddings = await getRiskLabelEmbeddings()
  if (!riskLabelEmbeddings) return []

  const flags: RiskFlag[] = []

  for (const [definitionIndex, def] of RISK_DEFINITIONS.entries()) {
    let best: { sentence: string; score: number; keywordScore: number } | null = null
    for (const [sentenceIndex, sentence] of sentences.entries()) {
      if (!hasAnchor(sentence, def.anchors)) continue
      const semanticScore = dot(embeddings[sentenceIndex], riskLabelEmbeddings[definitionIndex])
      const keywordScore = keywordHits(sentence, def.keywords).length
      const score = semanticScore + keywordScore * 0.08
      if (!best || score > best.score) best = { sentence, score, keywordScore }
    }

    if (best && (best.score >= 0.38 || best.keywordScore > 0)) {
      flags.push({
        category: def.category,
        reason: def.reason,
        snippet: best.sentence.trim().slice(0, 280),
      })
    }
  }

  return flags
}

export async function analyzeSection(section: ExtractedSection): Promise<SectionResult> {
  const bodyHash = ''
  const sentences = chooseCandidateSentences(section.bodyText)
  const fallbackFlags = keywordRiskFlags(section.bodyText)

  try {
    const embeddings = await embedTexts(sentences)
    if (!embeddings) {
      console.warn(`[PolicyLens] No embeddings for "${section.headingText}"; using deterministic fallback.`)
      return {
        sectionId: section.id,
        headingText: section.headingText,
        bodyText: section.bodyText,
        bodyHash,
        summary: extractiveSummarize(section.bodyText, section.headingText),
        riskFlags: fallbackFlags,
        modelUsed: false,
      }
    }

    console.log(`[PolicyLens] ML model active for "${section.headingText}" (${sentences.length} sentences embedded)`)
    const riskLabelEmbeddings = await getRiskLabelEmbeddings()
    const semanticFlags = await semanticRiskFlags(sentences, embeddings)
    return {
      sectionId: section.id,
      headingText: section.headingText,
      bodyText: section.bodyText,
      bodyHash,
      summary: semanticSummary(sentences, embeddings, riskLabelEmbeddings),
      riskFlags: mergeRiskFlags(semanticFlags, fallbackFlags),
      modelUsed: true,
    }
  } catch (error) {
    console.warn(`[PolicyLens] Semantic analysis failed for "${section.headingText}"; using fallback.`, error)
    return {
      sectionId: section.id,
      headingText: section.headingText,
      bodyText: section.bodyText,
      bodyHash,
      summary: extractiveSummarize(section.bodyText, section.headingText),
      riskFlags: fallbackFlags,
      modelUsed: false,
    }
  }
}

export async function summarizeSection(section: ExtractedSection): Promise<string> {
  return (await analyzeSection(section)).summary
}

export async function classifyRisk(bodyText: string): Promise<RiskFlag[]> {
  const section: ExtractedSection = { id: 'ad-hoc', headingText: '', bodyText, order: 0 }
  return (await analyzeSection(section)).riskFlags
}

export async function explainDiff(oldText: string, newText: string): Promise<string> {
  return extractiveDiffSummary(oldText, newText)
}
