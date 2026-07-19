import type { ExtensionMessage, ExtractedSection, SectionResult, SectionRecord } from '../shared/messages'
import { upsertDocument, saveSections, getSections, saveChange, getAllDomains, setDocLastChanged, getDoc, getChangesForDoc } from '../shared/storage'
import { sha256 } from '../shared/hashing'

const OFFSCREEN_URL = 'src/offscreen/offscreen.html'
const ANALYSIS_TIMEOUT_MS = 120_000

const pendingAnalysis = new Map<string, { resolve: (results: SectionResult[]) => void; timer: ReturnType<typeof setTimeout> }>()

chrome.runtime.onMessage.addListener((msg: ExtensionMessage, sender, sendResponse) => {
  console.log('[BG] Received:', msg.type)

  switch (msg.type) {
    case 'EXTRACT_PAGE':
      handleExtractPage(msg.tabId).then(sendResponse).catch((e) => {
        console.error('[BG] EXTRACT_PAGE failed:', e)
        sendResponse({ sections: [] })
      })
      return true
    case 'SAVE_ANALYSIS':
      handleSaveAnalysis(msg.docId, msg.domain, msg.docType, msg.results).then(sendResponse).catch((e) => {
        console.error('[BG] SAVE_ANALYSIS failed:', e)
        sendResponse({ ok: false })
      })
      return true
    case 'ANALYZE_PAGE':
      handleAnalyzePage(msg.tabId).then(sendResponse).catch((e) => {
        console.error('[BG] ANALYZE_PAGE failed:', e)
        sendResponse({ ok: false, error: String(e) })
      })
      return true
    case 'GET_ANALYSIS_FOR_TAB':
      handleGetAnalysis(msg.tabUrl).then(sendResponse)
      return true
    case 'GET_DASHBOARD_DATA':
      getAllDomains().then((domains) => sendResponse({ type: 'DASHBOARD_DATA', domains }))
      return true
    case 'DELETE_ALL_DATA':
      deleteAllData().then(() => sendResponse({ type: 'DATA_DELETED' }))
      return true
    case 'DELETE_MODEL_CACHE':
      deleteModelCache().then(() => sendResponse({ type: 'MODEL_CACHE_DELETED' }))
      return true
    case 'SUMMARIZE_RESULT': {
      const key = `${msg.docId}`
      const pending = pendingAnalysis.get(key)
      if (pending) {
        clearTimeout(pending.timer)
        pending.resolve(msg.results)
        pendingAnalysis.delete(key)
        console.log(`[BG] Resolved pending analysis for ${key} (${msg.results.length} results)`)
      }
      break
    }
    case 'DIFF_RESULT': {
      console.log('[BG] Received diff result for', msg.docId, msg.sectionId)
      break
    }
  }
})

async function ensureOffscreenDocument(): Promise<void> {
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    })
    if (existingContexts.length > 0) {
      console.log('[BG] Offscreen document already exists')
      return
    }
  } catch {
    // getContexts may not exist in older Chrome versions; fall through to try create
  }

  await new Promise<void>((resolve, reject) => {
    const readyListener = (msg: ExtensionMessage) => {
      if (msg.type === 'OFFSCREEN_READY') {
        chrome.runtime.onMessage.removeListener(readyListener)
        console.log('[BG] Offscreen document ready')
        resolve()
      }
    }
    chrome.runtime.onMessage.addListener(readyListener)

    chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['DOM_SCRAPING' as any],
      justification: 'Runs Transformers.js WASM inference for policy analysis',
    }).then(() => {
      console.log('[BG] Offscreen document created, waiting for ready signal')
      // Timeout fallback in case ready signal never arrives
      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(readyListener)
        resolve()
      }, 5000)
    }).catch((e: any) => {
      chrome.runtime.onMessage.removeListener(readyListener)
      if (e.message?.includes('already exists')) {
        console.log('[BG] Offscreen document already exists')
        resolve()
      } else {
        reject(e)
      }
    })
  })
}

function extractPageContent() {
  const url = window.location.href
  const hostname = window.location.hostname
  const title = document.title

  function extractSectionsFromDOM(): ExtractedSection[] {
    const sections: ExtractedSection[] = []
    let order = 0
    const headingTags = ['h1', 'h2', 'h3', 'h4']
    const mainContent = document.querySelector('main, article, [role="main"], .content, #content, .post, .entry-content') || document.body
    let currentHeading = 'Introduction'
    let currentBody: string[] = []

    function flushSection() {
      if (currentBody.length > 0) {
        const bodyText = currentBody.join('\n').trim()
        if (bodyText.length > 20) {
          const slug = currentHeading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
          sections.push({ id: `${order}-${slug}`, headingText: currentHeading, bodyText, order })
          order++
        }
      }
      currentBody = []
    }

    function walk(node: Node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement
        if (['SCRIPT', 'STYLE', 'NAV', 'FOOTER'].includes(el.tagName)) return
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

  function detectDocType(): string {
    const text = `${url} ${title}`.toLowerCase()
    if (/(terms|conditions|tos)/i.test(text)) return 'terms'
    if (/(privacy)/i.test(text)) return 'privacy'
    if (/(cookie)/i.test(text)) return 'cookies'
    if (/(dpa|data.processing)/i.test(text)) return 'dpa'
    return 'other'
  }

  const sections = extractSectionsFromDOM()
  const docType = detectDocType()

  return { url, hostname, title, sections, docType }
}

async function handleExtractPage(tabId: number) {
  const [{ result: extracted }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractPageContent,
  })
  if (!extracted || !extracted.sections || extracted.sections.length === 0) {
    return { docId: null, domain: null, docType: null, sections: [] }
  }
  const { url, hostname, sections, docType } = extracted
  const docId = `${hostname}::${url}`
  return { docId, domain: hostname, docType, sections }
}

async function handleSaveAnalysis(docId: string, domain: string, docType: string, results: SectionResult[]) {
  await upsertDocument({ docId, domain, docUrl: docId.split('::')[1], docType, discoveredVia: 'user-visit' })

  const existing = await getSections(docId)
  if (existing.length > 0) {
    for (const old of existing) {
      const newResult = results.find((r) => r.sectionId === old.sectionId)
      if (newResult && newResult.bodyHash && newResult.bodyHash !== old.bodyHash) {
        await setDocLastChanged(docId, Date.now())
        const oldSentences = new Set((old.bodyText.match(/[^.!?]+[.!?]+/g) || []).map((x) => x.trim().toLowerCase()))
        const added = (newResult.bodyText.match(/[^.!?]+[.!?]+/g) || []).map((x) => x.trim()).filter((x) => !oldSentences.has(x.toLowerCase()))
        const diffSummary = added.length > 0 ? `New content added: ${added.slice(0, 2).join(' ').slice(0, 300)}` : 'This section was modified.'
        await saveChange({ docId, sectionId: old.sectionId, headingText: old.headingText, changedAt: Date.now(), oldText: old.bodyText, newText: newResult.bodyText, diffSummary, domain })
        break
      }
    }
  }

  const records: SectionRecord[] = results.map((r) => ({
    sectionKey: `${docId}::${r.sectionId}`,
    docId, sectionId: r.sectionId, headingText: r.headingText,
    bodyText: r.bodyText, bodyHash: r.bodyHash, summary: r.summary,
    riskFlags: r.riskFlags, modelUsed: r.modelUsed, savedAt: Date.now(),
  }))
  await saveSections(records)
  await updateBadgeForDomain(domain)
  return { ok: true }
}

async function handleAnalyzePage(tabId: number): Promise<{ ok: boolean; docId?: string; sections?: SectionRecord[]; changes?: any[]; error?: string }> {
  const [{ result: extracted }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractPageContent,
  })
  if (!extracted || !extracted.sections || extracted.sections.length === 0) {
    return { ok: false, sections: [], changes: [], error: 'No policy content found on this page' }
  }
  const { url, hostname, sections, docType } = extracted
  const docId = `${hostname}::${url}`

  await upsertDocument({ docId, domain: hostname, docUrl: url, docType, discoveredVia: 'user-visit' })

  // Detect changes against previously saved sections
  const existing = await getSections(docId)
  if (existing.length > 0) {
    for (const old of existing) {
      const newSec = sections.find((n) => n.id === old.sectionId)
      if (newSec) {
        const newHash = await sha256(newSec.bodyText)
        if (newHash && newHash !== old.bodyHash) {
          await setDocLastChanged(docId, Date.now())
          const oldSentences = new Set((old.bodyText.match(/[^.!?]+[.!?]+/g) || []).map((x) => x.trim().toLowerCase()))
          const added = (newSec.bodyText.match(/[^.!?]+[.!?]+/g) || []).map((x) => x.trim()).filter((x) => !oldSentences.has(x.toLowerCase()))
          const diffSummary = added.length > 0 ? `New content added: ${added.slice(0, 2).join(' ').slice(0, 300)}` : 'This section was modified.'
          await saveChange({ docId, sectionId: old.sectionId, headingText: old.headingText, changedAt: Date.now(), oldText: old.bodyText, newText: newSec.bodyText, diffSummary, domain: hostname })
          break
        }
      }
    }
  }

  // Route analysis through offscreen document (hosts Transformers.js)
  await ensureOffscreenDocument()

  const results = await new Promise<SectionResult[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingAnalysis.delete(docId)
      reject(new Error('Analysis timed out'))
    }, ANALYSIS_TIMEOUT_MS)

    pendingAnalysis.set(docId, { resolve, timer })
    console.log(`[BG] Sending ${sections.length} sections to offscreen for analysis`)
    chrome.runtime.sendMessage({ type: 'SUMMARIZE_SECTIONS', docId, sections } as ExtensionMessage)
  })

  // Save results
  await saveResults(docId, results)
  await updateBadgeForDomain(hostname)

  // Return full data so popup can display immediately
  const savedSections = await getSections(docId)
  const changes = await getChangesForDoc(docId)
  return { ok: true, docId, sections: savedSections, changes }
}

async function handleGetAnalysis(tabUrl: string): Promise<ExtensionMessage> {
  let domain: string
  try { domain = new URL(tabUrl).hostname } catch {
    return { type: 'ANALYSIS_RESULT', docId: null, sections: [], changes: [] } as ExtensionMessage
  }
  const docId = `${domain}::${tabUrl}`
  const doc = await getDoc(docId)
  if (!doc) {
    return { type: 'ANALYSIS_RESULT', docId: null, sections: [], changes: [] } as ExtensionMessage
  }
  const sections = await getSections(docId)
  const changes = await getChangesForDoc(docId)
  return { type: 'ANALYSIS_RESULT', docId, sections, changes }
}

async function saveResults(docId: string, results: SectionResult[]) {
  const records: SectionRecord[] = results.map((r) => ({
    sectionKey: `${docId}::${r.sectionId}`,
    docId, sectionId: r.sectionId, headingText: r.headingText,
    bodyText: r.bodyText, bodyHash: r.bodyHash, summary: r.summary,
    riskFlags: r.riskFlags, modelUsed: r.modelUsed, savedAt: Date.now(),
  }))
  await saveSections(records)
}

async function updateBadgeForDomain(domain: string) {
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (tab.url && tab.id) {
      try {
        if (new URL(tab.url).hostname === domain) {
          const sections = await getSections(`${domain}::${tab.url}`)
          const riskCount = sections.reduce((sum, s) => sum + s.riskFlags.length, 0)
          chrome.action.setBadgeText({ tabId: tab.id, text: riskCount > 0 ? String(riskCount) : '✓' })
          chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: riskCount > 0 ? '#ef4444' : '#22c55e' })
        }
      } catch {}
    }
  }
}

async function deleteAllData() {
  const dbs = await indexedDB.databases()
  for (const db of dbs) {
    if (db.name === 'policylens') indexedDB.deleteDatabase(db.name!)
  }
}

async function deleteModelCache() {
  for (const name of await caches.keys()) await caches.delete(name)
  await chrome.storage.local.clear()
}
