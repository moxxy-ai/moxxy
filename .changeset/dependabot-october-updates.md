---
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

Dependency updates: the OpenAI and Anthropic SDKs, Electron, Playwright, ESLint and the other minor and patch updates, plus jsdom 30, pdfjs-dist 6 and @huggingface/transformers 4. PDF text extraction follows the pdfjs 6 API. The anonymizer now ships the onnxruntime-web `asyncify` WASM files that transformers 4 loads, still served from the app itself and never from a CDN. `http-cache-semantics` 4.3.0 fixes GHSA-ch52-4w7c-c8xp, so that advisory is no longer on the accepted list. The GitHub Actions are updated as well, and Dependabot no longer proposes major `@expo/*` updates, which only move with an Expo SDK upgrade.
