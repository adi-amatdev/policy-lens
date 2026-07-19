export type DocType = 'terms' | 'privacy' | 'cookies' | 'dpa' | 'other'

export interface RiskFlag {
  category:
    | 'data-sharing'
    | 'arbitration'
    | 'auto-renewal'
    | 'unilateral-changes'
    | 'liability-waiver'
    | 'data-retention'
  reason: string
  snippet: string
}

export interface ExtractedSection {
  id: string
  headingText: string
  bodyText: string
  order: number
}

export interface SectionResult {
  sectionId: string
  headingText: string
  bodyText: string
  bodyHash: string
  summary: string
  riskFlags: RiskFlag[]
  modelUsed: boolean
}

export interface DomainSummary {
  domain: string
  docCount: number
  riskScore: number
  lastChangedAt: number | null
}

export interface SectionRecord {
  sectionKey: string
  docId: string
  sectionId: string
  headingText: string
  bodyText: string
  bodyHash: string
  summary: string
  riskFlags: RiskFlag[]
  modelUsed: boolean
  savedAt: number
}

export interface ChangeRecord {
  id?: number
  docId: string
  domain: string
  sectionId: string
  headingText: string
  changedAt: number
  oldText: string
  newText: string
  diffSummary: string
}

export type ExtensionMessage =
  | { type: 'PAGE_DETECTED'; url: string; domain: string; docType: DocType; sections: ExtractedSection[]; discoveredLinks: string[] }
  | { type: 'SUMMARIZE_SECTIONS'; docId: string; sections: ExtractedSection[] }
  | { type: 'SUMMARIZE_RESULT'; docId: string; results: SectionResult[] }
  | { type: 'EXPLAIN_DIFF'; docId: string; sectionId: string; oldText: string; newText: string; headingText: string }
  | { type: 'DIFF_RESULT'; docId: string; sectionId: string; headingText: string; oldText: string; newText: string; diffSummary: string }
  | { type: 'GET_ANALYSIS_FOR_TAB'; tabUrl: string }
  | { type: 'ANALYSIS_RESULT'; docId: string | null; sections: SectionRecord[]; changes: ChangeRecord[] }
  | { type: 'ANALYZE_PAGE'; tabId: number }
  | { type: 'EXTRACT_PAGE'; tabId: number }
  | { type: 'SAVE_ANALYSIS'; docId: string; domain: string; docType: string; results: SectionResult[] }
  | { type: 'EXTRACT_AND_DETECT' }
  | { type: 'ANALYSIS_COMPLETE' }
  | { type: 'GET_DASHBOARD_DATA' }
  | { type: 'DASHBOARD_DATA'; domains: DomainSummary[] }
  | { type: 'CRAWL_REQUEST'; domain: string; urls: string[] }
  | { type: 'OFFSCREEN_READY' }
  | { type: 'DELETE_ALL_DATA' }
  | { type: 'DATA_DELETED' }
  | { type: 'DELETE_MODEL_CACHE' }
  | { type: 'MODEL_CACHE_DELETED' }
