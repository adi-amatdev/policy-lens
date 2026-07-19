import type { ExtensionMessage, ExtractedSection, SectionResult, SectionRecord, RiskFlag } from '../shared/messages'
import { upsertDocument, saveSections, getSections, saveChange, getAllDomains, setDocLastChanged, getDoc, getChangesForDoc } from '../shared/storage'
import { sha256 } from '../shared/hashing'

chrome.runtime.onMessage.addListener((msg: ExtensionMessage, sender, sendResponse) => {
  console.log('[BG] Received:', msg.type)
  switch (msg.type) {
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
  }
})

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

async function handleAnalyzePage(tabId: number): Promise<{ ok: boolean; sectionCount: number }> {
  console.log(`[BG] ANALYZE_PAGE tab=${tabId}`)

  const [{ result: extracted }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractPageContent,
  })

  if (!extracted || !extracted.sections || extracted.sections.length === 0) {
    console.warn('[BG] No sections extracted from page')
    return { ok: false, sectionCount: 0 }
  }

  const { url, hostname, sections, docType } = extracted
  const docId = `${hostname}::${url}`
  console.log(`[BG] Extracted ${sections.length} sections from ${hostname}`)

  await upsertDocument({
    docId, domain: hostname, docUrl: url, docType, discoveredVia: 'user-visit',
  })

  const existing = await getSections(docId)
  if (existing.length > 0) {
    await processChanges(docId, hostname, existing, sections)
  }

  const results = summarizeSectionsDirectly(sections)
  await saveResults(docId, results)
  await updateBadgeForDomain(hostname)

  console.log(`[BG] ANALYZE_PAGE complete: ${results.length} sections saved`)
  return { ok: true, sectionCount: results.length }
}

function summarizeSectionsDirectly(sections: ExtractedSection[]): SectionResult[] {
  return sections.map((section) => {
    const summary = extractiveSummarize(section.bodyText)
    const riskFlags = keywordRiskFlags(section.bodyText)
    return {
      sectionId: section.id,
      headingText: section.headingText,
      bodyText: section.bodyText,
      bodyHash: '',
      summary,
      riskFlags,
    }
  })
}

function extractiveSummarize(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || []
  if (sentences.length === 0) return text.slice(0, 300) || 'No content extracted.'
  return sentences.slice(0, 3).map((s) => s.trim()).join(' ')
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

async function saveResults(docId: string, results: SectionResult[]) {
  const records: SectionRecord[] = results.map((r) => ({
    sectionKey: `${docId}::${r.sectionId}`,
    docId, sectionId: r.sectionId, headingText: r.headingText,
    bodyText: r.bodyText, bodyHash: r.bodyHash, summary: r.summary,
    riskFlags: r.riskFlags, savedAt: Date.now(),
  }))
  await saveSections(records)
}

async function processChanges(docId: string, domain: string, existing: SectionRecord[], newSections: ExtractedSection[], tabId?: number) {
  const newHashes = new Map<string, string>()
  for (const s of newSections) {
    newHashes.set(s.id, await sha256(s.bodyText))
  }
  for (const old of existing) {
    const newHash = newHashes.get(old.sectionId)
    if (newHash && newHash !== old.bodyHash) {
      const s = newSections.find((n) => n.id === old.sectionId)
      if (s) {
        await setDocLastChanged(docId, Date.now())
        const oldSentences = new Set((old.bodyText.match(/[^.!?]+[.!?]+/g) || []).map((x) => x.trim().toLowerCase()))
        const added = (s.bodyText.match(/[^.!?]+[.!?]+/g) || []).map((x) => x.trim()).filter((x) => !oldSentences.has(x.toLowerCase()))
        const diffSummary = added.length > 0 ? `New content added: ${added.slice(0, 2).join(' ').slice(0, 300)}` : 'This section was modified.'
        await saveChange({ docId, sectionId: old.sectionId, headingText: old.headingText, changedAt: Date.now(), oldText: old.bodyText, newText: s.bodyText, diffSummary, domain })
        break
      }
    }
  }
}

async function handleGetAnalysis(tabUrl: string): Promise<ExtensionMessage> {
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
