import type { ExtensionMessage, ExtractedSection, SectionResult, SectionRecord, ChangeRecord } from '../shared/messages'
import { upsertDocument, saveSections, getSections, saveChange, getAllDomains, setDocLastChanged, getDoc, getChangesForDoc } from '../shared/storage'
import { sha256 } from '../shared/hashing'
import { extractPlainText } from '../shared/detection'

let offscreenReady = false

async function ensureOffscreen() {
  if (offscreenReady) return
  if (typeof chrome.offscreen !== 'undefined' && chrome.offscreen) {
    try {
      const existing = await chrome.offscreen.hasDocument?.()
      if (!existing) {
        await chrome.offscreen.createDocument({
          url: 'src/offscreen/offscreen.html',
          reasons: ['WORKERS' as chrome.offscreen.Reason],
          justification: 'Run local model inference for policy summarization',
        })
      }
      offscreenReady = true
    } catch (e) {
      console.warn('[Background] Offscreen doc error:', e)
    }
  }
}

chrome.runtime.onMessage.addListener(async (msg: ExtensionMessage, sender) => {
  switch (msg.type) {
    case 'PAGE_DETECTED':
      await handlePageDetected(msg, sender.tab?.id)
      break
    case 'SUMMARIZE_RESULT':
      await handleSummarizeResult(msg)
      break
    case 'DIFF_RESULT':
      await handleDiffResult(msg)
      break
    case 'OFFSCREEN_READY':
      offscreenReady = true
      break
  }
})

chrome.runtime.onMessage.addListener((msg: ExtensionMessage, sender, sendResponse) => {
  if (msg.type === 'GET_ANALYSIS_FOR_TAB') {
    getAnalysisForTab(msg.tabUrl).then(sendResponse)
    return true
  }
  if (msg.type === 'GET_DASHBOARD_DATA') {
    getAllDomains().then((domains) => {
      sendResponse({ type: 'DASHBOARD_DATA', domains } as ExtensionMessage)
    })
    return true
  }
  return false
})

async function handlePageDetected(msg: { url: string; domain: string; docType: string; sections: ExtractedSection[]; discoveredLinks: string[] }, tabId?: number) {
  const docId = `${msg.domain}::${msg.url}`

  await upsertDocument({
    docId,
    domain: msg.domain,
    docUrl: msg.url,
    docType: msg.docType,
    discoveredVia: 'user-visit',
  })

  if (msg.sections.length > 0) {
    const existing = await getSections(docId)
    if (existing.length > 0) {
      await processChanges(docId, msg.domain, existing, msg.sections, tabId)
    }

    await ensureOffscreen()
    chrome.runtime.sendMessage({
      type: 'SUMMARIZE_SECTIONS',
      docId,
      sections: msg.sections,
    } as ExtensionMessage)

    updateBadge(tabId, '...')
  }

  if (msg.discoveredLinks.length > 0) {
    scheduleCrawl(msg.domain, msg.discoveredLinks)
  }
}

async function processChanges(docId: string, domain: string, existing: SectionRecord[], newSections: ExtractedSection[], tabId?: number) {
  const newHashes = new Map<string, string>()
  for (const s of newSections) {
    newHashes.set(s.id, await sha256(s.bodyText))
  }

  const changedSections: { oldText: string; newText: string; sectionId: string; headingText: string }[] = []

  for (const oldRecord of existing) {
    const newHash = newHashes.get(oldRecord.sectionId)
    if (newHash && newHash !== oldRecord.bodyHash) {
      const newSection = newSections.find((s) => s.id === oldRecord.sectionId)
      if (newSection) {
        changedSections.push({
          oldText: oldRecord.bodyText,
          newText: newSection.bodyText,
          sectionId: oldRecord.sectionId,
          headingText: oldRecord.headingText,
        })
      }
    }
  }

  if (changedSections.length > 0) {
    await setDocLastChanged(docId, Date.now())
    for (const cs of changedSections) {
      await ensureOffscreen()
      chrome.runtime.sendMessage({
        type: 'EXPLAIN_DIFF',
        docId,
        sectionId: cs.sectionId,
        oldText: cs.oldText,
        newText: cs.newText,
      } as ExtensionMessage)
    }
    updateBadge(tabId, '!')
  }
}

async function handleSummarizeResult(msg: { docId: string; results: SectionResult[] }) {
  const sectionRecords: SectionRecord[] = msg.results.map((r) => ({
    sectionKey: `${msg.docId}::${r.sectionId}`,
    docId: msg.docId,
    sectionId: r.sectionId,
    headingText: '',
    bodyText: '',
    bodyHash: '',
    summary: r.summary,
    riskFlags: r.riskFlags,
    savedAt: Date.now(),
  }))
  await saveSections(sectionRecords)
  const domain = msg.docId.split('::')[0]
  updateBadgeForDomain(domain)
}

async function handleDiffResult(msg: { docId: string; sectionId: string; diffSummary: string }) {
  await saveChange({
    docId: msg.docId,
    sectionId: msg.sectionId,
    headingText: '',
    changedAt: Date.now(),
    oldText: '',
    newText: '',
    diffSummary: msg.diffSummary,
    domain: msg.docId.split('::')[0],
  })
}

async function getAnalysisForTab(tabUrl: string): Promise<ExtensionMessage> {
  let domain: string
  try {
    domain = new URL(tabUrl).hostname
  } catch {
    return { type: 'ANALYSIS_RESULT', docId: null, sections: [], changes: [] } as ExtensionMessage
  }
  const docId = `${domain}::${tabUrl}`
  const doc = await getDoc(docId)
  if (!doc) {
    return { type: 'ANALYSIS_RESULT', docId: null, sections: [], changes: [] } as ExtensionMessage
  }
  const sections = await getSections(docId)
  const changes = await getChangesForDoc(docId)
  return { type: 'ANALYSIS_RESULT', docId, sections, changes } as ExtensionMessage
}

async function scheduleCrawl(domain: string, urls: string[]) {
  for (const url of urls) {
    const docId = `${domain}::${url}`
    const existing = await getDoc(docId)
    if (existing) continue
    try {
      const response = await fetch(url)
      const html = await response.text()
      const plainText = extractPlainText(html)
      const sections: ExtractedSection[] = [
        { id: 'full-doc', headingText: 'Full Document', bodyText: plainText, order: 0 },
      ]
      await upsertDocument({
        docId,
        domain,
        docUrl: url,
        docType: 'other',
        discoveredVia: 'crawler',
      })
      if (sections.length > 0) {
        chrome.runtime.sendMessage({
          type: 'SUMMARIZE_SECTIONS',
          docId,
          sections,
        } as ExtensionMessage)
      }
    } catch (e) {
      console.warn(`[Background] Failed to crawl ${url}:`, e)
    }
  }
}

function updateBadge(tabId: number | undefined, text: string) {
  if (tabId !== undefined) {
    chrome.action.setBadgeText({ tabId, text })
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#6366f1' })
  }
}

async function updateBadgeForDomain(domain: string) {
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (tab.url && tab.id) {
      try {
        const tabDomain = new URL(tab.url).hostname
        if (tabDomain === domain) {
          chrome.action.setBadgeText({ tabId: tab.id, text: chr() })
          chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#22c55e' })
        }
      } catch {}
    }
  }
}

let badgeCounter = 0
function chr(): string {
  badgeCounter++
  return ['✓', '✔', '✱'][badgeCounter % 3]
}
