import { detectDocType, extractSections, discoverPolicyLinks, countBodySignals } from '../shared/detection'
import type { ExtensionMessage } from '../shared/messages'

const doc = document
const url = window.location.href
const title = doc.title

function runDetection() {
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
    return true
  }

  const bodyText = doc.body.textContent || ''
  const signals = countBodySignals(bodyText)
  const wordCount = bodyText.split(/\s+/).length
  if (wordCount > 800 && signals >= 3) {
    console.log(`[Content] Possible policy page via body heuristic (${signals} signals, ${wordCount} words)`)
    const sections = extractSections(doc)
    const discoveredLinks = discoverPolicyLinks(doc, url)
    let domain: string
    try {
      domain = new URL(url).hostname
    } catch {
      domain = 'unknown'
    }
    if (sections.length > 0) {
      try {
        chrome.runtime.sendMessage({
          type: 'PAGE_DETECTED',
          url,
          domain,
          docType: 'other',
          sections,
          discoveredLinks,
        } as ExtensionMessage)
      } catch (e) {
        console.warn('[Content] Failed to send PAGE_DETECTED:', e)
      }
      return true
    }
  }

  return false
}

chrome.runtime.onMessage.addListener((msg: ExtensionMessage) => {
  if (msg.type === 'EXTRACT_AND_DETECT') {
    const detected = runDetection()
    if (!detected) {
      console.log('[Content] Heuristics did not match. Force-extracting anyway.')
      const sections = extractSections(doc)
      if (sections.length > 0) {
        let domain: string
        try {
          domain = new URL(url).hostname
        } catch {
          domain = 'unknown'
        }
        chrome.runtime.sendMessage({
          type: 'PAGE_DETECTED',
          url,
          domain,
          docType: 'other',
          sections,
          discoveredLinks: [],
        } as ExtensionMessage)
      }
    }
  }
})

runDetection()
