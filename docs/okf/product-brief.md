---
type: Product Brief
title: PolicyLens — Local-First T&C / Privacy Policy Summarizer
description: A Chrome MV3 extension that detects, summarizes, and tracks changes to legal/policy pages entirely on-device.
tags: [chrome-extension, privacy, local-first, hackathon, mvp]
timestamp: 2026-07-19T00:00:00Z
resource: chrome-extension://policylens
---

# Product Brief — Local-First T&C / Privacy Policy Summarizer

## One-liner
A Chrome (Manifest V3) extension that detects Terms & Conditions, Privacy Policy, and related
legal/policy pages on any site, summarizes them **entirely on-device** using a local model, flags
risky clauses, and — on repeat visits — tells the user **what changed since they last accepted**.
A dashboard aggregates this across every site the user has visited.

## Why this and not the obvious version
Cloud-API T&C summarizers already exist (e.g. the reference repo this project was inspired by,
which calls the OpenAI API). The differentiators here are:

1. **Fully local inference.** No document text ever leaves the device. This is a real privacy
   claim, not a marketing one — it's provable by checking the network tab.
2. **Change detection since last acceptance.** Companies silently amend T&Cs after a user has
   already clicked "I agree." Nobody surfaces this. We hash and diff at the section level and
   explain, in plain English, what changed and why it matters.
3. **Cross-policy crawling.** Most tools summarize one document. This one discovers and indexes
   *all* policy documents linked from a site (Privacy Policy, Cookie Policy, Data Processing
   Addendum, Acceptable Use Policy, etc.) so the dashboard shows a full picture per service.

## MVP scope (build this, nothing more)

### In scope
- **Popup** (`action` popup, opens on click): shown whenever the current tab is a detected T&C
  or policy page. Shows: doc type, structured summary by section, risk-flag tags, and a
  "What changed" tab if a prior version is stored.
- **Content script**: detects policy-type pages, extracts main document text + heading structure,
  discovers same-site links to *other* policy documents (privacy, cookies, DPA, AUP), and reports
  both back to the background service worker.
- **Background service worker / offscreen document**: owns the local model, chunking, hashing,
  diffing, and storage. Orchestrates the "crawler" (fetching discovered same-site policy links in
  the background, not just the page the user is on).
- **Dashboard** (a full extension page, e.g. `dashboard.html`, opened via toolbar icon long-press
  or a "View full dashboard" link in the popup): lists every service/domain analyzed, per-domain
  risk score, last-changed date, and a timeline of changes across all tracked policies.
- **Local model summarization**: Chrome's built-in Summarizer API (Gemini Nano) as primary path,
  Transformers.js (WebGPU/WASM) as fallback when the built-in API is unavailable.
- **Section-level diffing**: SHA-256 hash per structural section, stored with a timestamp; on
  revisit, compare hashes, diff only the changed sections, and have the model explain the delta.
- **Risk flagging**: tag sections that match categories like data sharing/selling, arbitration
  clauses, auto-renewal, unilateral changes, liability waivers, data retention.

### Explicitly out of scope for MVP (say this in the pitch, don't build it)
- Universal parsing for every possible site layout — tune for demo sites, degrade gracefully
  elsewhere (show "couldn't confidently extract this document" rather than a bad summary).
- User accounts, sync across devices, or any server component. This is a local-only extension.
- Firefox/Edge store submission during the hackathon — build for Chrome MV3 first; deployment doc
  covers porting after the fact.
- Legal accuracy/liability guarantees. The popup must show a visible "not legal advice, AI-
  generated summary" disclaimer at all times.

## Core user flows

**Flow A — first visit to a policy page**
User lands on a ToS/privacy page → content script detects it → background summarizes locally →
badge on the extension icon shows a risk-count number → user clicks popup → sees sectioned
summary + flags → data + hash saved to IndexedDB → crawler discovers linked policy docs on the
same domain and queues them for background analysis (no user action needed).

**Flow B — return visit, nothing changed**
Same page loaded again → hash matches stored hash → popup shows cached summary immediately,
no model call needed, with a "last checked: no changes" note.

**Flow C — return visit, something changed**
Hash differs → background diffs section-by-section → only changed sections are re-summarized and
explained → popup opens (or badge alerts) with a "What changed" tab as the default view instead of
the full summary, so the user sees the delta first.

**Flow D — dashboard**
User opens dashboard → sees every domain tracked, a risk score per domain, and a combined
"recent changes across all your services" feed, sorted by date.

## Definition of done for the hackathon demo
- Works live, offline (airplane-mode-safe after first model load), on 2–3 pre-selected demo sites.
- One live demo shows Flow A end to end.
- One live demo shows Flow C (a policy edited between two loads — can be simulated by keeping a
  local HTML fixture with two versions of a ToS page, swapped between demo runs).
- Dashboard shows at least 2 domains with data.
- No network calls to any inference API are visible in the network tab during the demo.

## Related

- [Architecture](./architecture.md) — component design supporting these flows
- [Build Plan](./build-plan.md) — implementation checklist
