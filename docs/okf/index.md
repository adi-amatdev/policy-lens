---
okf_version: "0.1"
---

# PolicyLens Knowledge Bundle

Local-first Chrome extension for summarizing Terms & Conditions and privacy policies on-device. Built primarily for Chrome, which provides the Summarizer API for on-device inference; a Transformers.js fallback covers other Chromium-based browsers. Firefox requires a dedicated build — the offscreen document API used for model hosting is Chrome-specific (see [Deployment](./deployment.md)).

- [Product Brief](./product-brief.md) — Vision, MVP scope, and core user flows
- [Architecture](./architecture.md) — Component design, tech stack, and data flow
- [Setup & Scaffold](./setup-and-scaffold.md) — Project scaffolding and dev workflow
- [Build Plan](./build-plan.md) — Hour-by-hour task checklist for hackathon execution
- [Data Model](./data-model.md) — IndexedDB schema and storage interface definitions
- [Messaging Contract](./messaging-contract.md) — Typed message contract between extension components
- [Deployment](./deployment.md) — Local demo, Chrome Web Store, Edge, Firefox, and Safari porting
