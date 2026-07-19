import type { ExtensionMessage, ExtractedSection, SectionResult } from '../shared/messages'
import { summarizeSection, classifyRisk, explainDiff, loadModelInBackground } from '../shared/model'
import { sha256 } from '../shared/hashing'

console.log('[Offscreen] Document loaded')

chrome.runtime.onMessage.addListener((msg: ExtensionMessage) => {
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

chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' } as ExtensionMessage)
console.log('[Offscreen] Sent OFFSCREEN_READY')

loadModelInBackground()

async function handleSummarize(docId: string, sections: ExtractedSection[]) {
  console.log(`[Offscreen] Summarizing ${sections.length} sections for ${docId}`)
  const results: SectionResult[] = []

  for (const section of sections) {
    try {
      const summary = await summarizeSection(section)
      const riskFlags = await classifyRisk(section.bodyText)
      const bodyHash = await sha256(section.bodyText)
      results.push({
        sectionId: section.id,
        headingText: section.headingText,
        bodyText: section.bodyText,
        bodyHash,
        summary,
        riskFlags,
      })
      console.log(`[Offscreen] Section "${section.headingText}" done (${riskFlags.length} risks)`)
    } catch (e) {
      console.error(`[Offscreen] Section "${section.headingText}" failed:`, e)
      results.push({
        sectionId: section.id,
        headingText: section.headingText,
        bodyText: section.bodyText,
        bodyHash: '',
        summary: section.bodyText.slice(0, 200) + '...',
        riskFlags: [],
      })
    }
  }

  console.log(`[Offscreen] Sending ${results.length} results`)
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
