import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'PolicyLens: Local T&C & Privacy Summarizer',
  version: '0.1.0',
  description:
    'Summarizes Terms & Conditions and privacy policies on-device, and tells you what changed since you last agreed.',
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
  permissions: ['storage', 'activeTab', 'scripting', 'offscreen'],
  host_permissions: ['<all_urls>'],
  options_page: 'src/dashboard/dashboard.html',
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
  web_accessible_resources: [
    {
      resources: ['src/popup/popup.html'],
      matches: ['<all_urls>'],
    },
  ],
})
