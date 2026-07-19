import type { ExtensionMessage, ExtractedSection, SectionResult } from '../shared/messages'
import { analyzeSection, explainDiff } from '../shared/model'
import { sha256 } from '../shared/hashing'

console.log('[Offscreen] Document loaded, signaling ready')
chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' } as ExtensionMessage)

chrome.runtime.onMessage.addListener((msg: ExtensionMessage, _sender, _sendResponse) => {
  console.log('[Offscreen] Received:', msg.type)
  switch (msg.type) {
    case 'SUMMARIZE_SECTIONS':
      handleSummarize(msg.docId, msg.sections)
      break
    case 'EXPLAIN_DIFF':
      handleExplainDiff(msg.docId, msg.sectionId, msg.oldText, msg.newText, msg.headingText)
      break
  }
})

async function handleSummarize(docId: string, sections: ExtractedSection[]) {
  console.log(`[Offscreen] Summarizing ${sections.length} sections for ${docId}`)
  const results: SectionResult[] = []

  for (const section of sections) {
    try {
      const analyzed = await analyzeSection(section)
      const bodyHash = await sha256(section.bodyText)
      results.push({
        ...analyzed,
        bodyHash,
      })
      console.log(`[Offscreen] Section "${section.headingText}" done (${analyzed.riskFlags.length} risks)`)
    } catch (e) {
      console.error(`[Offscreen] Section "${section.headingText}" failed:`, e)
      results.push({
        sectionId: section.id,
        headingText: section.headingText,
        bodyText: section.bodyText,
        bodyHash: '',
        summary: section.bodyText.slice(0, 200) + '...',
        riskFlags: [],
        modelUsed: false,
      })
    }
  }

  console.log(`[Offscreen] Sending ${results.length} results back`)
  chrome.runtime.sendMessage({ type: 'SUMMARIZE_RESULT', docId, results } as ExtensionMessage)
}

async function handleExplainDiff(docId: string, sectionId: string, oldText: string, newText: string, headingText: string) {
  try {
    const diffSummary = await explainDiff(oldText, newText)
    chrome.runtime.sendMessage({
      type: 'DIFF_RESULT', docId, sectionId, headingText, oldText, newText, diffSummary,
    } as ExtensionMessage)
  } catch (e) {
    console.error('[Offscreen] Diff explanation failed:', e)
    chrome.runtime.sendMessage({
      type: 'DIFF_RESULT', docId, sectionId, headingText, oldText, newText,
      diffSummary: 'This section was modified.',
    } as ExtensionMessage)
  }
}
