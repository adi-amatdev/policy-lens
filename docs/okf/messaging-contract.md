---
type: API Contract
title: PolicyLens Messaging Contract
description: Typed discriminated union for chrome.runtime messages and model prompt templates.
tags: [messaging, typescript, chrome-api, prompts, contract]
timestamp: 2026-07-19T00:00:00Z
---

# Messaging Contract

Define as a discriminated union so every component imports the same types.

## Message Types

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
```

## Supporting Interfaces

```ts
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

## Model Prompt Templates

Keep these as plain template strings, not a prompt-engineering framework — speed matters more
than elegance here.

### Section summary
```
Summarize the following section of a legal/policy document in 2-3 plain-English sentences.
Focus on what it means for the user practically. Do not use legal jargon.

Section heading: "{headingText}"
Section text:
"""
{bodyText}
"""
```

### Risk flag classification
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

### Diff explanation
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

## Related

- [Data Model](./data-model.md) — schema for `SectionRecord`, `ChangeRecord`, `RiskFlag`
- [Architecture](./architecture.md) — component diagram showing message flow
