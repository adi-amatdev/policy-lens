# Deployment

## Local demo (hackathon day — do this, nothing else needs to work)
```bash
npm run build
```
This outputs a `dist/` folder. In Chrome: `chrome://extensions` → enable Developer mode → "Load
unpacked" → select `dist/`. This is the only deployment you need for the judging demo. Don't
spend hackathon time on store submission — do it after, if at all.

## Chrome Web Store (post-hackathon)
1. Run `npm run build`, then zip the contents of `dist/` (not the folder itself — the manifest.json
   must be at the root of the zip).
   ```bash
   cd dist && zip -r ../policylens.zip . && cd ..
   ```
2. Create a one-time $5 developer account at the Chrome Web Store Developer Dashboard
   (`chrome.google.com/webstore/devconsole`).
3. Upload the zip as a new item. Required assets: at least one 1280x800 or 640x400 screenshot,
   a 128x128 icon (already in `public/icons`), a short and detailed description, and a privacy
   practices disclosure — this last one matters for this extension specifically, since it requests
   `<all_urls>` host permission. Be explicit in the disclosure that no page content is transmitted
   off-device; this is your strongest selling point and also the thing Google's review will scrutinize
   most given the broad host permission.
4. Submission goes through review (can take from hours to a couple weeks). Scope down
   `host_permissions` from `<all_urls>` to only what's justified if review flags it — e.g.
   requesting `activeTab` + optional runtime-requested host permissions instead of blanket access,
   which also reads better in the store listing.

## Microsoft Edge Add-ons store
Edge is Chromium-based and accepts the same Manifest V3 package with no code changes in almost
all cases.
1. Same `dist/` zip as Chrome.
2. Submit via the Microsoft Partner Center (`partner.microsoft.com`, Edge Add-ons section) — free,
   no developer fee.
3. Review is typically faster than Chrome Web Store. Same privacy-disclosure considerations apply.

## Firefox Add-ons (AMO)
Firefox supports MV3 but with some API differences worth checking before porting:
1. `chrome.offscreen` is Chrome-specific — Firefox does not have an equivalent offscreen document
   API as of recent Firefox releases. The model-inference layer would need to run in the background
   script directly or in a hidden extension page loaded another way. Confirm current Firefox MV3
   support for this before committing time to a port.
2. Firefox does not ship an equivalent to Chrome's built-in Summarizer/Prompt API (Gemini Nano) —
   the Transformers.js fallback path becomes the *only* path on Firefox, not a fallback. This is
   exactly why the architecture treats Transformers.js as a real backend rather than an emergency
   fallback — porting to Firefox is mostly "does the offscreen-equivalent code work," not "add a
   new model integration."
3. Use `web-ext` (Mozilla's CLI tool) for local testing and packaging:
   ```bash
   npm install -g web-ext
   web-ext lint --source-dir=dist
   web-ext build --source-dir=dist
   ```
4. Submit the built zip at `addons.mozilla.org/developers` — free, requires source code
   submission for review since the extension bundles model-loading code (AMO reviewers may ask
   for the unminified source; keep a build without aggressive minification handy).

## Safari (optional, lowest priority)
Safari Web Extensions require converting via Xcode's `safari-web-extension-converter` and
distributing through the Mac App Store or notarized outside it. Given Safari doesn't support
`chrome.offscreen` or Chrome's built-in AI APIs either, this is a larger port than Firefox and
should only be pursued if there's a specific reason to target Safari users post-hackathon.
