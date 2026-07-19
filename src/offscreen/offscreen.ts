import type { ExtensionMessage, ExtractedSection, SectionResult } from '../shared/messages'
import { initModel, summarizeSection, classifyRisk, explainDiff } from '../shared/model'
import { sha256 } from '../shared/hashing'

async function setup() {
  console.log('[Offscreen] Starting offscreen document')
  const backend = await initModel()
  console.log(`[Offscreen] Model backend: ${backend}`)

  chrome.runtime.onMessage.addListener(
    (msg: ExtensionMessage) => {
      switch (msg.type) {
        case 'SUMMARIZE_SECTIONS':
          handleSummarize(msg.docId, msg.sections)
          break
        case 'EXPLAIN_DIFF':
          handleExplainDiff(msg.docId, msg.sectionId, msg.oldText, msg.newText, msg.headingText)
          break
      }
    }
  )

  chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' } as ExtensionMessage)
}

async function handleSummarize(docId: string, sections: ExtractedSection[]) {
  const results: SectionResult[] = []
  for (const section of sections) {
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
  }
  chrome.runtime.sendMessage({
    type: 'SUMMARIZE_RESULT',
    docId,
    results,
  } as ExtensionMessage)
}

async function handleExplainDiff(docId: string, sectionId: string, oldText: string, newText: string, headingText: string) {
  const diffSummary = await explainDiff(oldText, newText)
  chrome.runtime.sendMessage({
    type: 'DIFF_RESULT',
    docId,
    sectionId,
    headingText,
    oldText,
    newText,
    diffSummary,
  } as ExtensionMessage)
}

setup()
