import { detectDocType, extractSections, discoverPolicyLinks, isPolicyByBody } from '../shared/detection'
import type { ExtensionMessage } from '../shared/messages'

const doc = document
const url = window.location.href
const title = doc.title

const detection = detectDocType(url, title)

if (detection.isPolicy) {
  const sections = extractSections(doc)
  const discoveredLinks = discoverPolicyLinks(doc, url)

  let domain: string
  try {
    domain = new URL(url).hostname
  } catch {
    domain = 'unknown'
  }

  console.log('[Content] Policy page detected:', {
    url,
    domain,
    docType: detection.docType,
    sections: sections.length,
    discoveredLinks,
    confidence: detection.confidence,
  })

  if (sections.length > 0 || discoveredLinks.length > 0) {
    try {
      chrome.runtime.sendMessage({
        type: 'PAGE_DETECTED',
        url,
        domain,
        docType: detection.docType,
        sections,
        discoveredLinks,
      } as ExtensionMessage)
    } catch (e) {
      console.warn('[Content] Failed to send PAGE_DETECTED:', e)
    }
  }
} else if (isPolicyByBody(doc.body.textContent || '')) {
  console.log('[Content] Possible policy page detected via body heuristic. Visit a known policy URL for reliable summarization.')
}
