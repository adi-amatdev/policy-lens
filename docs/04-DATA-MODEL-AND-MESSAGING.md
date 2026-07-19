# Data Model & Messaging Contract

## IndexedDB schema (via `idb`)

Database name: `policylens`, version 1.

### Object store: `documents`
Key path: `docId` (string, `` `${domain}::${docUrl}` ``)
```ts
interface DocumentRecord {
  docId: string
  domain: string          // eTLD+1, e.g. "example.com"
  docUrl: string           // full URL of the policy page
  docType: 'terms' | 'privacy' | 'cookies' | 'dpa' | 'other'
  discoveredVia: 'user-visit' | 'crawler'
  firstSeenAt: number      // epoch ms
  lastCheckedAt: number
  lastChangedAt: number | null
}
```

### Object store: `sections`
Key path: `sectionKey` (string, `` `${docId}::${sectionId}` ``), indexed on `docId`
```ts
interface SectionRecord {
  sectionKey: string
  docId: string
  sectionId: string        // stable-ish id derived from position + heading slug
  headingText: string
  bodyText: string          // raw extracted text, for re-diffing later
  bodyHash: string           // sha256(bodyText)
  summary: string            // model output
  riskFlags: RiskFlag[]
  savedAt: number
}

interface RiskFlag {
  category: 'data-sharing' | 'arbitration' | 'auto-renewal' | 'unilateral-changes'
          | 'liability-waiver' | 'data-retention'
  reason: string    // one-line model-generated justification
}
```

### Object store: `changes`
Key path: auto-increment `id`, indexed on `docId` and `changedAt`
```ts
interface ChangeRecord {
  id?: number
  docId: string
  domain: string
  sectionId: string
  headingText: string
  changedAt: number
  oldText: string
  newText: string
  diffSummary: string   // model's plain-English explanation of the change
}
```

## Message contract (`shared/messages.ts`)

Define as a discriminated union so every component imports the same types.

```ts
export type ExtensionMessage =
  | { type: 'PAGE_DETECTED'; url: string; domain: string; docType: DocType
      sections: ExtractedSection[]; discoveredLinks: string[] }
  | { type: 'SUMMARIZE_SECTIONS'; docId: string; sections: ExtractedSection[] }
  | { type: 'SUMMARIZE_RESULT'; docId: string; results: SectionResult[] }
  | { type: 'EXPLAIN_DIFF'; docId: string; sectionId: string; oldText: string; newText: string }
  | { type: 'DIFF_RESULT'; docId: string; sectionId: string; diffSummary: string }
  | { type: 'GET_ANALYSIS_FOR_TAB'; tabUrl: string }
  | { type: 'ANALYSIS_RESULT'; docId: string | null; sections: SectionRecord[]
      changes: ChangeRecord[] }
  | { type: 'GET_DASHBOARD_DATA' }
  | { type: 'DASHBOARD_DATA'; domains: DomainSummary[] }
  | { type: 'CRAWL_REQUEST'; domain: string; urls: string[] }

export interface ExtractedSection {
  id: string
  headingText: string
  bodyText: string
  order: number
}

export interface SectionResult {
  sectionId: string
  summary: string
  riskFlags: RiskFlag[]
}

export interface DomainSummary {
  domain: string
  docCount: number
  riskScore: number
  lastChangedAt: number | null
}
```

All `chrome.runtime.sendMessage` / `onMessage` calls should be typed against
`ExtensionMessage` — this is what keeps content script, background, offscreen, popup, and
dashboard from drifting out of sync as the agent builds each piece somewhat independently.

## Model prompt templates (`shared/model.ts` / used from offscreen)

Keep these as plain template strings, not a prompt-engineering framework — speed matters more
than elegance here.

**Section summary:**
```
Summarize the following section of a legal/policy document in 2-3 plain-English sentences.
Focus on what it means for the user practically. Do not use legal jargon.

Section heading: "{headingText}"
Section text:
"""
{bodyText}
"""
```

**Risk flag classification:**
```
Read the following policy section. Identify which of these categories apply, if any:
data-sharing, arbitration, auto-renewal, unilateral-changes, liability-waiver, data-retention.
For each that applies, give a one-sentence reason referencing the specific language.
Respond ONLY as JSON: [{"category": "...", "reason": "..."}]. If none apply, respond [].

Section text:
"""
{bodyText}
"""
```

**Diff explanation:**
```
A company changed this section of their policy. Explain in 1-2 plain-English sentences what
changed and why it matters to the user. Be specific about what is newly allowed, removed, or
restricted. Do not restate the full text.

Previous version:
"""
{oldText}
"""

New version:
"""
{newText}
"""
```

Have the agent wrap all three in a JSON-mode / structured-output path where the chosen model
backend supports it (Transformers.js text-generation with a JSON-constrained prompt, or the
Prompt API's structured output if available) — fall back to parsing plain text if not, since
hackathon time doesn't allow for building a robust output parser.
