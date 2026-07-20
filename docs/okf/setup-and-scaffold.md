---
type: Playbook
title: Setup & Scaffold
description: Project scaffolding commands, folder structure, manifest config, and dev workflow for PolicyLens.
tags: [setup, scaffolding, crxjs, vite, react, chrome-extension]
timestamp: 2026-07-19T00:00:00Z
---

# Setup & Scaffold — CRXJS + Vite + React

Hand this whole file to your coding agent as the first thing to execute. Run commands in order.

## 1. Scaffold the Vite project

```bash
npm create vite@latest tc-summarizer -- --template react-ts
cd tc-summarizer
npm install
npm install @crxjs/vite-plugin@beta -D
npm install idb diff
npm install @huggingface/transformers
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

Note: `@crxjs/vite-plugin` MV3 support is on the `@beta` tag as of most recent releases — check
`npm info @crxjs/vite-plugin versions` and pin to the latest beta if `@beta` has moved on.

## 2. Folder structure to create

```
tc-summarizer/
├── manifest.config.ts        # CRXJS manifest as JS/TS, not a static json file
├── vite.config.ts
├── tailwind.config.js
├── src/
│   ├── background/
│   │   └── service-worker.ts
│   ├── offscreen/
│   │   ├── offscreen.html
│   │   └── offscreen.ts
│   ├── content/
│   │   └── content-script.ts
│   ├── popup/
│   │   ├── popup.html
│   │   ├── main.tsx
│   │   └── Popup.tsx
│   ├── dashboard/
│   │   ├── dashboard.html
│   │   ├── main.tsx
│   │   └── Dashboard.tsx
│   ├── shared/
│   │   ├── messages.ts        # typed message contract, see 04-DATA-MODEL
│   │   ├── storage.ts         # idb wrapper, schema from 04-DATA-MODEL
│   │   ├── hashing.ts          # SHA-256 helper
│   │   ├── diffing.ts          # jsdiff wrapper + section matcher
│   │   ├── model.ts            # Transformers.js ML inference
│   │   ├── detection.ts        # page-type heuristics
│   │   └── riskFlags.ts        # risk category definitions + colors
│   └── styles.css
└── public/
    ├── icons/ (16, 32, 48, 128 px png)
    ├── images/ (static images, logo)
    └── ort/ (ONNX Runtime WASM binaries, ~23MB)
```

## 3. `manifest.config.ts`

```ts
import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'PolicyLens: Local T&C & Privacy Summarizer',
  version: '0.1.0',
  description: 'Summarizes Terms & Conditions and privacy policies on-device, and tells you what changed since you last agreed.',
  icons: {
    16: 'public/icons/icon16.png',
    32: 'public/icons/icon32.png',
    48: 'public/icons/icon48.png',
    128: 'public/icons/icon128.png',
  },
  action: {
    default_popup: 'src/popup/popup.html',
    default_icon: 'public/icons/icon32.png',
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/content-script.ts'],
      run_at: 'document_idle',
    },
  ],
  permissions: [
    'storage',
    'activeTab',
    'scripting',
    'offscreen',
  ],
  host_permissions: ['<all_urls>'],
  options_page: 'src/dashboard/dashboard.html',
})
```

Notes for the agent:
- `options_page` is repurposed here so the dashboard is reachable via the standard extension
  options entry point (right-click icon -> Options) as well as a link from the popup. This avoids
  needing a separate tab-management flow for MVP.
- `<all_urls>` host permission is broad — fine for a hackathon demo, call it out as a known
  scope-down item for production (should be limited to domains the user has actually visited).
- The ONNX Runtime WASM binary is bundled locally in `public/ort/` (~23MB) — no CDN dependency.
  Model weights are downloaded from HuggingFace on first run and cached in the browser's Cache API.

## 4. `vite.config.ts`

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    rollupOptions: {
      input: {
        offscreen: 'src/offscreen/offscreen.html',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
})
```

## 5. Dev workflow

```bash
npm run dev
```

Then in Chrome:
1. Go to `chrome://extensions`
2. Enable Developer mode (top right)
3. Click "Load unpacked", select the `dist/` folder CRXJS generates
4. CRXJS HMR will now hot-reload the popup/dashboard on save; background/content-script changes
   still require clicking the refresh icon on the extension card in `chrome://extensions`

## 6. Offscreen document boilerplate to create first

`src/offscreen/offscreen.html`:
```html
<!doctype html>
<html>
  <body>
    <script type="module" src="./offscreen.ts"></script>
  </body>
</html>
```

`src/background/service-worker.ts` needs to create the offscreen document on demand:
```ts
async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument?.()
  if (existing) return
  await chrome.offscreen.createDocument({
    url: 'src/offscreen/offscreen.html',
    reasons: ['WORKERS' as chrome.offscreen.Reason],
    justification: 'Run local model inference for policy summarization',
  })
}
```

Have the agent confirm the correct `chrome.offscreen.Reason` enum value against the installed
`@types/chrome` version — this API's reason strings have shifted across Chrome releases.

## 7. Icons
Generate a simple placeholder icon set (16/32/48/128px) before first load — Chrome will refuse to
load the unpacked extension cleanly without files at the manifest's icon paths. A flat single-color
"shield" or "document" glyph is enough for a hackathon.

## Related

- [Architecture](./architecture.md) — what this scaffold produces
- [Build Plan](./build-plan.md) — what to build after scaffolding
