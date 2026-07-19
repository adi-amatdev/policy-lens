---
type: Playbook
title: Build Plan — Compressed to ~8 Hours
description: Hour-by-hour task checklist for hackathon execution, ordered by priority tier.
tags: [build-plan, hackathon, tasks, implementation]
timestamp: 2026-07-19T00:00:00Z
---

# Build Plan — Compressed to ~8 Hours

Give this file to your coding agent as the task list to execute in order. Each block is checkable.
Priority tiers (from scope discussion): **Tier 1 = diff/change-detection, Tier 2 = risk-flag
polish, Tier 3 = broad site coverage.** If time runs out, cut from the bottom of the list up —
never cut Tier 1 tasks to save Tier 3 tasks.

## Hour 0–1: Scaffold + skeleton pass
- [ ] Run all commands in [Setup & Scaffold](./setup-and-scaffold.md)
- [ ] Confirm `npm run dev` + "Load unpacked" shows the extension icon in Chrome with no console errors
- [ ] Stub every file listed in the folder structure with a minimal export so imports resolve
- [ ] Verify on the actual demo machine whether Chrome's Summarizer/Prompt API is available
      without flags — record the answer, it decides which model path is "primary" for the rest of
      the build

## Hour 1–2: Extraction + detection (shallow, all 3 demo sites)
- [ ] `shared/detection.ts`: implement the 3-tier heuristic from the [Architecture](./architecture.md)
- [ ] `content/content-script.ts`: extract document text into a heading-based section tree
      (`{ id, headingText, bodyText, order }[]`)
- [ ] Same file: scan `<a>` tags for same-domain policy-keyword links, return as `discoveredLinks[]`
- [ ] Message background with `{ type: 'PAGE_DETECTED', url, sections, discoveredLinks }`
- [ ] Test against all 3 pre-selected demo sites — confirm section extraction is non-garbage on all 3

## Hour 2–3: Model abstraction + first end-to-end summary
- [ ] `shared/model.ts`: implement `summarize(text): Promise<string>` with two backends
      (Summarizer API call, Transformers.js pipeline), chosen by feature-detection at runtime
- [ ] `offscreen/offscreen.ts`: receive `SUMMARIZE_SECTIONS` messages, run each section through
      `model.ts`, return summaries
- [ ] `background/service-worker.ts`: wire `PAGE_DETECTED` -> offscreen summarize -> store result
- [ ] `popup/Popup.tsx`: render the summary for the active tab (basic list, no styling yet)
- [ ] Confirm: load a demo site, click the icon, see a real local-model summary. This is your
      first real checkpoint — do not proceed until this works.

## Hour 3–5: Tier 1 — diffing and change detection (deepen first)
- [ ] `shared/hashing.ts`: `sha256(text): Promise<string>` via Web Crypto
- [ ] `shared/storage.ts`: [IndexedDB schema](./data-model.md); store
      `{ domain, docUrl, sectionId, headingText, sectionHash, summary, savedAt }` per section
- [ ] On every extraction: compare new section hashes against last-stored hashes for the same
      `(domain, docUrl, sectionId)` (match by `sectionId`, fall back to `headingText` similarity
      if IDs shift)
- [ ] `shared/diffing.ts`: `diffWordsWithSpace(oldText, newText)` wrapper; also expose a simple
      heading-similarity matcher (Levenshtein or even substring match is fine for MVP)
- [ ] For every changed section, call the model with the "explain this change" prompt template
      (see [Messaging Contract](./messaging-contract.md)) instead of a plain summarize call
- [ ] `popup/Popup.tsx`: add a "What changed" tab; if any section changed since last save, this
      tab is the default view on open instead of "Summary"
- [ ] Build a two-version local HTML fixture (same fake ToS page, v1 and v2 with 2–3 clauses
      edited) to demonstrate this live without depending on a real site changing during the demo

## Hour 5–6: Tier 2 — risk flags + popup polish
- [ ] `shared/riskFlags.ts`: define categories (data sharing/selling, arbitration, auto-renewal,
      unilateral changes, liability waiver, data retention) as a prompt template asking the model
      to tag which categories apply per section, plus a one-line reason
- [ ] `popup/Popup.tsx`: "Risk flags" tab — colored tag chips per category, click to jump to the
      relevant section summary
- [ ] Add the required "AI-generated summary, not legal advice" disclaimer, always visible
- [ ] Add extension badge text (small number on the toolbar icon) showing risk-flag count for the
      current tab

## Hour 6–7: Dashboard + crawler wiring
- [ ] `background/service-worker.ts`: when `discoveredLinks[]` arrives, dedup against already-
      tracked URLs for that domain, cap at 5, fetch each via `fetch()`, parse with a lightweight
      HTML-to-text pass (e.g. `DOMParser` inside the offscreen doc, not the service worker), run
      the same detection -> extraction -> summarize -> store pipeline as a normal page visit
- [ ] `dashboard/Dashboard.tsx`: query [IndexedDB](./data-model.md) for all domains; render one card per domain with
      doc count, combined risk score (simple sum/average of flags across its docs), last-changed
      date
- [ ] Dashboard: global "recent changes" feed — list of `(domain, docUrl, changedAt, oneLineWhy)`
      sorted descending, pulled from the diff results stored in Hour 3–5
- [ ] Link "Open full dashboard" from the popup to `chrome-extension://<id>/dashboard.html`

## Hour 7–8: Tier 3 (best effort) + demo prep
- [ ] Best-effort pass on 1–2 additional real-world site formats; if extraction breaks, show a
      graceful "couldn't confidently parse this page" state rather than a garbled summary — do
      not spend remaining time chasing full generality
- [ ] Full run-through on all planned demo sites + the v1/v2 diff fixture
- [ ] Screenshot/record a backup demo video in case of live-demo/model-loading flakiness
- [ ] Write the top-level README (one paragraph pitch, screenshot, "local-first" claim clearly
      stated, install-from-source instructions for judges who want to try it)

## Related

- [Setup & Scaffold](./setup-and-scaffold.md) — Hour 0 prerequisites
- [Architecture](./architecture.md) — component details
- [Data Model](./data-model.md) — storage schema
- [Messaging Contract](./messaging-contract.md) — message types
