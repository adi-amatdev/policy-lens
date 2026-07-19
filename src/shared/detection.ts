import type { ExtractedSection, DocType } from './messages'
import { headingSimilarity } from './diffing'

const POLICY_URL_PATTERNS = [
  /\/terms(\/|$)/i,
  /\/tos(\/|$)/i,
  /\/privacy(\/|$)/i,
  /\/cookie(\/|$)/i,
  /\/legal(\/|$)/i,
  /\/dpa(\/|$)/i,
  /\/gdpr(\/|$)/i,
  /\/data-processing(\/|$)/i,
  /\/acceptable.use/i,
]

const POLICY_TITLE_KEYWORDS = [
  'terms of service',
  'terms and conditions',
  'terms of use',
  'privacy policy',
  'cookie policy',
  'data processing',
  'legal notice',
  'acceptable use',
  'end user license',
  'service agreement',
]

const POLICY_BODY_SIGNALS = [
  'you agree',
  'we collect',
  'arbitration',
  'third parties',
  'your data',
  'governing law',
  'disclaimer',
  'liability',
  'indemnify',
  'termination',
]

const POLICY_LINK_KEYWORDS = [
  'privacy',
  'terms',
  'conditions',
  'cookie',
  'dpa',
  'gdpr',
  'ccpa',
  'legal',
  'acceptable use',
  'data processing',
]

export function detectDocType(url: string, title: string): { isPolicy: boolean; docType: DocType; confidence: 'high' | 'medium' | 'low' } {
  for (const pattern of POLICY_URL_PATTERNS) {
    if (pattern.test(url)) {
      const type = inferDocType(url, title)
      return { isPolicy: true, docType: type, confidence: 'high' }
    }
  }

  const lowerTitle = title.toLowerCase()
  for (const keyword of POLICY_TITLE_KEYWORDS) {
    if (lowerTitle.includes(keyword)) {
      const type = inferDocType(url, title)
      return { isPolicy: true, docType: type, confidence: 'high' }
    }
  }

  return { isPolicy: false, docType: 'other', confidence: 'low' }
}

function inferDocType(url: string, title: string): DocType {
  const text = `${url} ${title}`.toLowerCase()
  if (/(terms|conditions|tos)/i.test(text)) return 'terms'
  if (/(privacy)/i.test(text)) return 'privacy'
  if (/(cookie)/i.test(text)) return 'cookies'
  if (/(dpa|data.processing)/i.test(text)) return 'dpa'
  return 'other'
}

export function countBodySignals(text: string): number {
  const lower = text.toLowerCase()
  return POLICY_BODY_SIGNALS.filter((s) => lower.includes(s)).length
}

export function isPolicyByBody(text: string): boolean {
  const wordCount = text.split(/\s+/).length
  return wordCount > 800 && countBodySignals(text) >= 3
}

export function extractSections(doc: Document): ExtractedSection[] {
  const sections: ExtractedSection[] = []
  let order = 0

  const headingTags = ['h1', 'h2', 'h3', 'h4']
  const mainContent = doc.querySelector('main, article, [role="main"], .content, #content, .post, .entry-content') || doc.body

  let currentHeading = 'Introduction'
  let currentBody: string[] = []

  function flushSection() {
    if (currentBody.length > 0) {
      const bodyText = currentBody.join('\n').trim()
      if (bodyText.length > 20) {
        sections.push({
          id: `${order}-${slugify(currentHeading)}`,
          headingText: currentHeading,
          bodyText,
          order,
        })
        order++
      }
    }
    currentBody = []
  }

  function walk(node: Node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NAV' || el.tagName === 'FOOTER') return
      if (headingTags.includes(el.tagName.toLowerCase())) {
        flushSection()
        currentHeading = el.textContent?.trim() || 'Untitled'
        return
      }
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim()
      if (text) currentBody.push(text)
    }
    node.childNodes.forEach(walk)
  }

  walk(mainContent)
  flushSection()

  return sections
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function discoverPolicyLinks(doc: Document, baseUrl: string): string[] {
  const links: string[] = []
  let baseDomain: string
  try {
    baseDomain = new URL(baseUrl).hostname
  } catch {
    return []
  }

  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href')
    if (!href) return
    try {
      const url = new URL(href, baseUrl)
      if (url.hostname !== baseDomain) return
      const text = a.textContent?.toLowerCase() || ''
      const path = url.pathname.toLowerCase()
      for (const keyword of POLICY_LINK_KEYWORDS) {
        if (text.includes(keyword) || path.includes(keyword)) {
          links.push(url.href)
          return
        }
      }
    } catch {
      // invalid URL, skip
    }
  })

  return [...new Set(links)]
}

export function extractPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function matchSectionsByHeading(
  oldSections: { sectionId: string; headingText: string }[],
  newSections: ExtractedSection[],
  threshold = 0.5
): Map<string, string> {
  const matched = new Map<string, string>()
  const used = new Set<string>()

  for (const old of oldSections) {
    let bestMatch = newSections.find((n) => n.id === old.sectionId)
    if (bestMatch && !used.has(bestMatch.id)) {
      matched.set(old.sectionId, bestMatch.id)
      used.add(bestMatch.id)
      continue
    }

    let bestScore = 0
    let bestId: string | null = null
    for (const n of newSections) {
      if (used.has(n.id)) continue
      const score = headingSimilarity(old.headingText, n.headingText)
      if (score > bestScore) {
        bestScore = score
        bestId = n.id
      }
    }
    if (bestId && bestScore >= threshold) {
      matched.set(old.sectionId, bestId)
      used.add(bestId)
    }
  }

  return matched
}
