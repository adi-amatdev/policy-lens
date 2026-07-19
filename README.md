# PolicyLens

**If you care about your privacy, do not accept the terms that can quietly cost you control. PolicyLens reads policies on your device, flags clauses affecting your data and money, and shows what changed before it becomes your problem.**

PolicyLens detects policy pages in your browser, extracts and summarizes each section into plain English using local ML models, flags risky clauses (forced arbitration, unilateral data sharing, liability waivers), and tracks changes over time so you're never blindsided by an update to a policy you already accepted.

## Features

- **Local-first AI:** Summaries run on-device via Chrome's built-in Summarizer API or Transformers.js (Xenova/distilbart-cnn-6-6). No data leaves your browser. Built primarily for Chrome, which provides the native on-device Summarizer API; other Chromium-based browsers fall back to Transformers.js. A dedicated build is required for Firefox (see [Deployment](docs/okf/deployment.md)).
- **Change detection:** Stores a snapshot of every policy you visit. When a policy is updated, PolicyLens diffs the old and new versions and highlights exactly what changed.
- **Risk flags:** Automatically flags clauses for data sharing, forced arbitration, auto-renewal, unilateral changes, liability waivers, and excessive data retention.
- **Dashboard:** A dedicated tab (`chrome://extensions` → PolicyLens options) showing every tracked policy, its risk profile, and a history of changes.
- **Auto-detection:** Recognizes policy pages by URL patterns (`/terms`, `/privacy`, `/legal`, etc.) and page structure (heading density + policy-specific keywords).

## Screenshots

> _Screenshots coming soon._

<!-- 
![Popup showing a summarized Terms of Service](docs/screenshots/popup.png)
![Dashboard with risk flags](docs/screenshots/dashboard.png)
![Change detection diff view](docs/screenshots/diff.png)
-->

## Install from Source

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/), npm, or yarn
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
| On-device ML | Chrome Summarizer API (primary), Transformers.js + distilbart-cnn-6-6 (fallback) |
| Diffing | `diff` (word-level diff for policy changes) |
| Storage | Chrome `storage` API + IndexedDB (`idb`) |
| Linting | Oxlint |
| Build | Vite 8, TypeScript |

## Project Structure

```
src/
  background/     Service worker: orchestrates tab visits and storage
  content/        Content script: extracts policy text from the DOM
  offscreen/      Offscreen document for model inference
  popup/          Browser action popup: quick summary + risk flags
  dashboard/      Options page: full policy history and change log
  shared/         Core logic: detection, diffing, hashing, risk flags, model, storage
demo/             Fixture HTML files for testing change detection
```

## How It Works

1. A content script runs on every page and checks if the URL/page content looks like a policy document.
2. If detected, it extracts sections (by heading) and stores a hashed snapshot.
3. On the next visit, it compares the new content against the stored snapshot using word-level diffing.
4. Changed sections are summarized and presented as a diff with plain-English explanations.
5. Risk flags are classified for each section using the local ML model.

## Future Scope

- **Broader browser support** - Port to Firefox and Safari by replacing the Chrome-specific offscreen document with a platform-agnostic model host (hidden extension page or Web Worker). The Transformers.js inference path already works cross-browser; the main work is providing it a compatible execution context on each platform.
- **Mobile and edge devices** - Extend beyond desktop browsers into a standalone mobile app (e.g. via Capacitor or a native WebView wrapper) that intercepts in-app browser sessions and policy links. On-device models like distilled Gemma or Phi-3 can run on mobile GPUs, keeping the local-first guarantee intact on phones and tablets.

## License

MIT
