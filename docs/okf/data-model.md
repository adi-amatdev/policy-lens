---
type: Data Model
title: PolicyLens IndexedDB Schema
description: Object stores, key paths, indexes, and interface definitions for local storage.
tags: [storage, indexeddb, schema, typescript, data]
timestamp: 2026-07-19T00:00:00Z
---

# Data Model — IndexedDB Schema

Database name: `policylens`, version 1.

## Object store: `documents`
Key path: `docId` (string, `` `${domain}::${docUrl}` ``)

| Column | Type | Description |
|--------|------|-------------|
| `docId` | string | Composite key: `{domain}::{docUrl}` |
| `domain` | string | eTLD+1, e.g. "example.com" |
| `docUrl` | string | Full URL of the policy page |
| `docType` | enum | `'terms'` \| `'privacy'` \| `'cookies'` \| `'dpa'` \| `'other'` |
| `discoveredVia` | enum | `'user-visit'` \| `'crawler'` |
| `firstSeenAt` | number | Epoch ms of first detection |
| `lastCheckedAt` | number | Epoch ms of most recent check |
| `lastChangedAt` | number \| null | Epoch ms of last detected change, or null |

```ts
interface DocumentRecord {
  docId: string
  domain: string
  docUrl: string
  docType: 'terms' | 'privacy' | 'cookies' | 'dpa' | 'other'
  discoveredVia: 'user-visit' | 'crawler'
  firstSeenAt: number
  lastCheckedAt: number
  lastChangedAt: number | null
}
```

## Object store: `sections`
Key path: `sectionKey` (string, `` `${docId}::${sectionId}` ``), indexed on `docId`

| Column | Type | Description |
|--------|------|-------------|
| `sectionKey` | string | Composite key: `{docId}::{sectionId}` |
| `docId` | string | FK to [documents](./data-model.md) store |
| `sectionId` | string | Stable ID derived from position + heading slug |
| `headingText` | string | Human-readable section heading |
| `bodyText` | string | Raw extracted text, for re-diffing later |
| `bodyHash` | string | SHA-256 hex digest of `bodyText` |
| `summary` | string | Model-generated plain-English summary |
| `riskFlags` | RiskFlag[] | Array of flagged risk categories |
| `modelUsed` | boolean | Whether ML inference ran (true) or fell back to keyword-only (false) |
| `savedAt` | number | Epoch ms of last save |

```ts
interface SectionRecord {
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
```

## RiskFlag interface
```ts
interface RiskFlag {
  category: 'data-sharing' | 'arbitration' | 'auto-renewal' | 'unilateral-changes'
          | 'liability-waiver' | 'data-retention'
  reason: string    // one-line model-generated justification
  snippet: string   // excerpt from the source text
}
```

## Object store: `changes`
Key path: auto-increment `id`, indexed on `docId` and `changedAt`

| Column | Type | Description |
|--------|------|-------------|
| `id` | number | Auto-increment primary key |
| `docId` | string | FK to [documents](./data-model.md) store |
| `domain` | string | eTLD+1 for display |
| `sectionId` | string | Which section changed |
| `headingText` | string | Heading of changed section |
| `changedAt` | number | Epoch ms when change was detected |
| `oldText` | string | Previous section text |
| `newText` | string | Updated section text |
| `diffSummary` | string | Model's plain-English explanation of the change |

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
  diffSummary: string
}
```

## Related

- [Messaging Contract](./messaging-contract.md) — how data flows between components
- [Architecture](./architecture.md) — where storage sits in the component diagram
