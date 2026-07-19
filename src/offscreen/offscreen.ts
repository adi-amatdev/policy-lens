import type { ExtensionMessage, ExtractedSection, SectionResult } from '../shared/messages'
import { initModel, summarizeSection, classifyRisk, explainDiff } from '../shared/model'

async function setup() {
  console.log('[Offscreen] Starting offscreen document')
  const backend = await initModel()
  console.log(`[Offscreen] Model backend: ${backend}`)

  chrome.runtime.onMessage.addListener(
    (msg: ExtensionMessage, sender, sendResponse) => {
      switch (msg.type) {
        case 'SUMMARIZE_SECTIONS':
          handleSummarize(msg.docId, msg.sections).then(sendResponse)
          return true
        case 'EXPLAIN_DIFF':
          handleExplainDiff(msg.docId, msg.sectionId, msg.oldText, msg.newText).then(sendResponse)
          return true
        default:
          return false
      }
    }
  )

  chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' } as any)
}

async function handleSummarize(docId: string, sections: ExtractedSection[]): Promise<ExtensionMessage> {
  const results: SectionResult[] = []
  for (const section of sections) {
    const summary = await summarizeSection(section)
    const riskFlags = await classifyRisk(section.bodyText)
    results.push({
      sectionId: section.id,
      summary,
      riskFlags,
    })
  }
  return {
    type: 'SUMMARIZE_RESULT',
    docId,
    results,
  } as ExtensionMessage
}

async function handleExplainDiff(docId: string, sectionId: string, oldText: string, newText: string): Promise<ExtensionMessage> {
  const diffSummary = await explainDiff(oldText, newText)
  return {
    type: 'DIFF_RESULT',
    docId,
    sectionId,
    diffSummary,
  } as ExtensionMessage
}

setup()
