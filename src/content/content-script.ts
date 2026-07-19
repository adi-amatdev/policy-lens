import { detectDocType, extractSections, discoverPolicyLinks, countBodySignals, isPolicyByBody } from '../shared/detection'
import type { ExtensionMessage } from '../shared/messages'

const doc = document
const url = window.location.href
const title = doc.title

const detection = detectDocType(url, title)

if (detection.isPolicy || isPolicyByBody(doc.body.textContent || '')) {
  const sections = extractSections(doc)
  const discoveredLinks = discoverPolicyLinks(doc, url)
  const bodySignals = countBodySignals(doc.body.textContent || '')

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
    bodySignals,
  })

  if (sections.length > 0 || discoveredLinks.length > 0) {
    chrome.runtime.sendMessage({
      type: 'PAGE_DETECTED',
      url,
      domain,
      docType: detection.docType,
      sections,
      discoveredLinks,
    } as ExtensionMessage)
  }
}
