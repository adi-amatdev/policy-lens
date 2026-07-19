# Architecture

## Components

```
┌─────────────────────────────────────────────────────────────────────┐
│ Web page (any site)                                                  │
│                                                                       │
│  content-script.ts                                                   │
│   - detects policy-type page (heuristics, see below)                 │
│   - extracts DOM text + heading tree -> structured sections          │
│   - scans <a> tags for same-domain links matching policy keywords    │
│     (privacy, cookie, terms, dpa, gdpr, ccpa, acceptable-use, ...)    │
│   - postMessage -> chrome.runtime.sendMessage to background           │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ chrome.runtime messages
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ background/service-worker.ts (MV3 event page)                        │
│   - message router: page-detected, crawl-request, get-analysis        │
│   - "crawler": queues discovered same-domain policy URLs, fetches     │
│     them via fetch() (no CORS issue for GET on public pages the       │
│     user already has in a tab's context — same-origin fetch from a    │
│     background context; use host_permissions), passes HTML to the     │
│     offscreen doc for extraction+summarization identical to the       │
│     content-script path                                               │
│   - owns IndexedDB read/write (via idb wrapper)                       │
│   - owns hashing + diff orchestration                                 │
│   - delegates actual model inference to offscreen.ts (service workers │
│     cannot reliably host WebGPU / DOM-dependent inference)            │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ chrome.runtime messages
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ offscreen/offscreen.ts (chrome.offscreen document, DOM context)       │
│   - loads Transformers.js pipeline (fallback path) OR calls window.ai │
│     / Summarizer API (primary path, actually available from any       │
│     extension context with the right permission)                      │
│   - runs: summarize(section), classifyRisk(section), explainDiff(a,b) │
│   - streams results back to background                                │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ popup/  (React, opens on toolbar click)                              │
│   - reads current tab's analysis via chrome.runtime.sendMessage       │
│   - tabs: Summary | Risk flags | What changed                        │
│   - "Open full dashboard" link                                        │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ dashboard/ (React, full extension page, chrome-extension://.../       │
│             dashboard.html)                                           │
│   - reads all IndexedDB records                                       │
│   - per-domain cards: risk score, doc count, last-changed date        │
│   - global "recent changes" feed across all tracked domains           │
└─────────────────────────────────────────────────────────────────────┘
```

## Why an offscreen document, not just the service worker
MV3 service workers are DOM-less and get killed/suspended aggressively. Transformers.js needs a
DOM/Worker context for WebGPU and model caching to behave predictably, and Chrome's built-in
Summarizer/Prompt API is likewise designed to be called from a document context. `chrome.offscreen`
gives you a persistent, hidden document exactly for this kind of background compute — use it as the
single place model calls happen. The service worker just routes messages; it never touches the
model directly.

## Why CRXJS + Vite
- CRXJS's Vite plugin handles MV3's awkward parts for you: HMR that survives service worker
  reloads, automatic manifest processing from a JS/TS config object (no hand-maintained
  manifest.json for content scripts/background paths), and multi-entry bundling (popup, dashboard,
  background, offscreen, content script) from one Vite config.
- This matters most for hackathon velocity: you edit a component, the popup/dashboard hot-reload
  without you manually reloading the unpacked extension every time.

## Tech stack

| Concern | Choice | Why |
|---|---|---|
| Bundler/dev server | Vite + `@crxjs/vite-plugin` | MV3-aware HMR, single config for all entry points |
| UI | React + Tailwind | fast to build popup + dashboard with shared components |
| Local LLM (primary) | Chrome built-in Summarizer / Prompt API (Gemini Nano) | zero download owned by you, on-device, already in Chrome |
| Local LLM (fallback) | `@huggingface/transformers` (Transformers.js), e.g. `Xenova/distilbart-cnn-6-6` or a small instruct model | works in non-Chrome / when built-in API unavailable |
| Storage | IndexedDB via `idb` | chrome.storage.local has small quota; IndexedDB handles full document text + section history |
| Hashing | Web Crypto `crypto.subtle.digest('SHA-256', ...)` | native, no dependency |
| Diffing | `diff` (jsdiff), `diffWordsWithSpace` at the section level | mature, small, good for prose diffing |
| Messaging | `chrome.runtime.sendMessage` / `onMessage`, typed with a shared `messages.ts` contract | keeps background/content/popup/dashboard in sync without a framework |

## Page-type detection heuristic (content script)
Cheap and good enough for a hackathon — don't overbuild this:
1. URL path match: `/terms`, `/tos`, `/privacy`, `/cookie`, `/legal`, `/dpa`, `/gdpr`, `/data-processing`.
2. Page `<title>` / first `<h1>` text match against a keyword list (terms, conditions, privacy,
   policy, agreement).
3. Heuristic fallback: document body word count > 800 words AND contains ≥3 of: "you agree",
   "we collect", "arbitration", "third parties", "your data", "governing law".
Any single strong signal (1 or 2) is sufficient; heuristic 3 alone should just flag "possible
policy page" and let the user manually trigger summarization from the popup rather than auto-run.

## Crawler behavior (background)
On first detection of a policy page on a domain, the content script also returns any `<a href>`
whose text or href matches the same policy-keyword list, filtered to same-eTLD+1. The background
service worker queues these (dedup by URL, cap at ~5 per domain for MVP) and fetches+extracts+
summarizes them the same way, without needing the user to visit each page. This is what makes the
dashboard show "4 policies tracked for example.com" after the user only ever visited one page.

## Data flow for the diff feature
1. Every summarized section gets `sha256(sectionText)` computed and stored keyed by
   `(domain, docUrl, sectionId)`.
2. On any future extraction of the same `(domain, docUrl)`, recompute section hashes and compare
   against the last-stored hash per `sectionId`.
3. Unmatched-but-similar sections (heading reworded, content moved) — for MVP, match by heading
   text similarity first, fall back to position index. Don't build a full LCS section-aligner;
   simple heading-text match covers the demo cases.
4. For each changed section, run `diffWordsWithSpace(oldText, newText)` to get the literal delta,
   then pass both versions + the delta to the local model with a fixed prompt template (see
   04-DATA-MODEL-AND-MESSAGING.md) asking for a plain-English explanation of user-impact.
