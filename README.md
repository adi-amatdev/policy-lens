# PolicyLens

**If you care about your privacy, do not accept the terms that can quietly cost you control. PolicyLens reads policies on your device, flags clauses affecting your data and money, and shows what changed before it becomes your problem.**

PolicyLens detects policy pages in your browser, extracts and analyzes each section using a local ML model, flags risky clauses (forced arbitration, unilateral data sharing, liability waivers), and tracks changes over time so you're never blindsided by an update to a policy you already accepted.

## Features

- **Local-first AI:** All analysis runs on-device via Transformers.js (`Xenova/all-MiniLM-L6-v2`, 23MB quantized ONNX). Summaries are extractive with semantic ranking (MMR for diversity). No data leaves your browser.
- **Change detection:** Stores a snapshot of every policy you visit. When a policy is updated, PolicyLens diffs the old and new versions and highlights exactly what changed.
- **Risk flags:** Hybrid detection combining semantic embedding similarity against risk category definitions with deterministic keyword anchors. Flags data sharing, forced arbitration, auto-renewal, unilateral changes, liability waivers, and excessive data retention.
- **Dashboard:** A dedicated tab (`chrome://extensions` → PolicyLens options) showing every tracked policy, its risk profile, and a history of changes. Includes a search chat for querying analyzed policies.
- **Auto-detection:** Recognizes policy pages by URL patterns (`/terms`, `/privacy`, `/legal`, etc.) and page structure (heading density + policy-specific keywords).
- **Model observability:** UI badge shows whether ML inference ran or fell back to keyword-only mode.

## Screenshots

> _Screenshots coming soon._

## Install from Source

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- npm
- Google Chrome >= 120

### Steps

```bash
# Clone the repo
git clone https://github.com/namaste-dev/terms-no-conditions.git
cd terms-no-conditions

# Install dependencies
npm install

# Build the extension
npm run build

# The output is in dist/. Load it as an unpacked extension:
# 1. Open chrome://extensions
# 2. Enable "Developer mode" (top right)
# 3. Click "Load unpacked"
# 4. Select the dist/ folder
```

For development with hot reload:

```bash
npm run dev
```

This starts a Vite dev server and outputs an unpacked extension to `dist/` that auto-rebuilds on change.

## Tech Stack

| Layer | Tool |
|---|---|
| Extension | Chrome Manifest V3, `@crxjs/vite-plugin` |
| UI | React 19, TypeScript, Tailwind CSS v4 |
| On-device ML | Transformers.js v4 + `Xenova/all-MiniLM-L6-v2` (ONNX q8, ~23MB) |
| WASM runtime | ONNX Runtime Web (bundled locally, no CDN dependency) |
| Diffing | `diff` (word-level diff for policy changes) |
| Storage | Chrome `storage` API + IndexedDB (`idb`) |
| Linting | Oxlint |
| Build | Vite 8, TypeScript |

## Architecture

```
Popup ──ANALYZE_PAGE──► Background Service Worker
                           │
                           ├─ extractPageContent() via chrome.scripting
                           ├─ createOffscreenDocument()
                           └─ SUMMARIZE_SECTIONS ──► Offscreen Document
                                                        │
                                                        ├─ Transformers.js loads Xenova/all-MiniLM-L6-v2
                                                        ├─ Embeds sentences (semantic feature extraction)
                                                        ├─ MMR sentence selection for summaries
                                                        ├─ Semantic + keyword risk classification
                                                        └─ SUMMARIZE_RESULT ──► Background
                                                                                   │
                                                                                   ├─ Save to IndexedDB
                                                                                   ├─ Update badge
                                                                                   └─ Return to Popup
```

- **Popup** never imports `model.ts` — all ML runs in the offscreen document
- **Offscreen document** hosts Transformers.js WASM inference (safe from popup destruction)
- **ONNX Runtime WASM** files are bundled locally in `public/ort/` — no CDN required
- **CSP** requires `'wasm-unsafe-eval'` for WebAssembly compilation

## Project Structure

```
src/
  background/     Service worker: orchestrates extraction, offscreen lifecycle, storage
  content/        Content script: detects policy pages, extracts sections from DOM
  offscreen/      Offscreen document: hosts Transformers.js for ML inference
  popup/          Browser action popup: triggers analysis, displays results
  dashboard/      Options page: full policy history, change log, search chat
  shared/         Core logic: detection, diffing, hashing, risk flags, model, storage
public/
  ort/            ONNX Runtime WASM binaries (bundled locally, ~23MB)
demo/             Fixture HTML files for testing change detection
```

## How It Works

1. A content script runs on every page and checks if the URL/page content looks like a policy document.
2. If detected, it notifies the background service worker.
3. When the user clicks "Analyze This Page", the background extracts sections and sends them to the offscreen document.
4. The offscreen document loads the ML model (first run downloads ~23MB, then cached) and embeds each section.
5. **Summaries:** MMR (Maximum Marginal Relevance) selects diverse, representative sentences. Redundant filler phrases are compressed out.
6. **Risk flags:** Each sentence is scored against category embeddings (semantic similarity) plus keyword anchors (deterministic catch-all). Scores above threshold produce flags.
7. Changed sections are detected by comparing content hashes against stored snapshots, with word-level diffing.

## First Run

On first analysis, the extension downloads the ONNX model weights from Hugging Face (~23MB). This takes 5-15 seconds depending on connection. After that, the model is cached in the browser's Cache API and loads near-instantly.

## License

MIT
