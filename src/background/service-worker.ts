import type { ExtensionMessage, ExtractedSection, SectionResult, SectionRecord } from '../shared/messages'
import { upsertDocument, saveSections, getSections, saveChange, getAllDomains, setDocLastChanged, getDoc, getChangesForDoc } from '../shared/storage'
import { sha256 } from '../shared/hashing'

let offscreenReady = false
let offscreenReadyResolve: (() => void) | null = null
const offscreenReadyPromise = new Promise<void>((resolve) => {
  offscreenReadyResolve = resolve
})

async function ensureOffscreen(): Promise<void> {
  if (offscreenReady) return
  if (typeof chrome.offscreen !== 'undefined' && chrome.offscreen) {
    try {
      const existing = await chrome.offscreen.hasDocument?.()
      if (!existing) {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['WORKERS' as chrome.offscreen.Reason],
          justification: 'Run local model inference for policy summarization',
        })
      }
      await offscreenReadyPromise
    } catch (e) {
      console.warn('[Background] Offscreen doc error:', e)
    }
  }
}

chrome.runtime.onMessage.addListener((msg: ExtensionMessage, _sender, sendResponse) => {
  switch (msg.type) {
    case 'PAGE_DETECTED':
      handlePageDetected(msg, _sender.tab?.id)
      break
    case 'SUMMARIZE_RESULT':
      handleSummarizeResult(msg)
      break
    case 'DIFF_RESULT':
      handleDiffResult(msg)
      break
    case 'OFFSCREEN_READY':
      offscreenReady = true
      if (offscreenReadyResolve) {
        offscreenReadyResolve()
        offscreenReadyResolve = null
      }
      break
    case 'GET_ANALYSIS_FOR_TAB':
      getAnalysisForTab(msg.tabUrl).then(sendResponse)
      return true
    case 'GET_DASHBOARD_DATA':
      getAllDomains().then((domains) => {
        sendResponse({ type: 'DASHBOARD_DATA', domains } as ExtensionMessage)
      })
      return true
    case 'DELETE_ALL_DATA':
      deleteAllData().then(() => {
        sendResponse({ type: 'DATA_DELETED' } as ExtensionMessage)
      })
      return true
    case 'DELETE_MODEL_CACHE':
      deleteModelCache().then(() => {
        sendResponse({ type: 'MODEL_CACHE_DELETED' } as ExtensionMessage)
      })
      return true
  }
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

async function processChanges(docId: string, _domain: string, existing: SectionRecord[], newSections: ExtractedSection[], tabId?: number) {
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
        headingText: cs.headingText,
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
    headingText: r.headingText,
    bodyText: r.bodyText,
    bodyHash: r.bodyHash,
    summary: r.summary,
    riskFlags: r.riskFlags,
    savedAt: Date.now(),
  }))
  await saveSections(sectionRecords)
  const domain = msg.docId.split('::')[0]
  await updateBadgeForDomain(domain)
}

async function handleDiffResult(msg: { docId: string; sectionId: string; headingText: string; oldText: string; newText: string; diffSummary: string }) {
  await saveChange({
    docId: msg.docId,
    sectionId: msg.sectionId,
    headingText: msg.headingText,
    changedAt: Date.now(),
    oldText: msg.oldText,
    newText: msg.newText,
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

const CRAWL_CAP = 5

async function scheduleCrawl(domain: string, urls: string[]) {
  const capped = urls.slice(0, CRAWL_CAP)
  for (const url of capped) {
    const docId = `${domain}::${url}`
    const existing = await getDoc(docId)
    if (existing) continue
    try {
      const response = await fetch(url)
      const html = await response.text()
      const plainText = stripHtml(html)
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
        await ensureOffscreen()
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

function stripHtml(html: string): string {
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
          const docId = `${domain}::${tab.url}`
          const sections = await getSections(docId)
          const riskCount = sections.reduce((sum, s) => sum + s.riskFlags.length, 0)
          const text = riskCount > 0 ? String(riskCount) : '✓'
          chrome.action.setBadgeText({ tabId: tab.id, text })
          chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: riskCount > 0 ? '#ef4444' : '#22c55e' })
        }
      } catch {}
    }
  }
}

async function deleteAllData(): Promise<void> {
  const dbs = await indexedDB.databases()
  for (const dbInfo of dbs) {
    if (dbInfo.name === 'policylens') {
      indexedDB.deleteDatabase(dbInfo.name!)
    }
  }
}

async function deleteModelCache(): Promise<void> {
  const cacheNames = await caches.keys()
  for (const name of cacheNames) {
    await caches.delete(name)
  }
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.clear()
  }
}
