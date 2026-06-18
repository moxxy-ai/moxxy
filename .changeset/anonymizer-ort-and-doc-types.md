---
"@moxxy/desktop-ipc-contract": patch
"@moxxy/desktop-host": patch
"@moxxy/client-core": patch
"@moxxy/desktop": patch
---

fix(desktop): anonymizer NER runs fully offline + reads every common document type

Two fixes to the offline document anonymizer:

- **ORT wasm backend no longer hits a CDN.** The NER model failed with
  `no available backend found … Failed to fetch … cdn.jsdelivr.net/…/ort-wasm-simd-threaded.jsep.mjs`:
  transformers.js / onnxruntime-web resolved its WASM runtime glue from jsdelivr
  by default, which broke the offline guarantee and failed outright (CSP-blocked /
  offline). The onnxruntime-web artifacts (`ort-wasm-simd-threaded.jsep.{mjs,wasm}`)
  are now shipped as part of the app shell (copied from `@huggingface/transformers`
  into the renderer build at `/ort/`, served from the app's own origin in dev,
  loopback, and `file://`), and the worker pins `env.backends.onnx.wasm.wasmPaths`
  at that local base before the ORT session is created — nothing is fetched from a
  CDN. The renderer CSP already permits this (it all rides on `'self'`); no real
  network origin was opened.

- **Reads all common document types.** The anonymizer now accepts PDF, Word
  (`.doc`/`.docx`), RTF, OpenDocument (`.odt`/`.ods`/`.odp`), spreadsheets,
  slides, and plain text. PDF/Office/ODF go through the existing officeparser
  pipeline; legacy binary `.doc` and `.rtf` (which officeparser doesn't handle)
  get dependency-free local extractors in a shared `parseBufferToText` core (so
  chat attachments benefit too). The "Open document" pane also accepts
  drag-and-drop: the renderer reads the dropped file's BYTES (which it already
  holds — no filesystem access) and sends them to a new host-only
  `anonymizer.parseDocumentBytes` IPC for extraction. It deliberately sends bytes
  rather than a path, so a compromised renderer can't forge a path to read an
  arbitrary file — the picker's provenance gate (which guards `parseDocument`)
  stays the only way main ever opens a renderer-named path. Everything stays
  local — no provider, runner, or network.
