---
"@moxxy/desktop-host": patch
"@moxxy/desktop": patch
---

fix(desktop): robust PDF text extraction for the anonymizer + Office-doc previews in the Files pane

- **Anonymizer "Could not extract text from this document" on real PDFs.**
  officeparser's stale bundled pdf.js silently returns an EMPTY string for many
  ordinary text-layer PDFs, surfacing as a generic extraction failure. PDF
  extraction now runs through `pdfjs-dist` (pure-JS, offline, in the main
  process — no native deps, no network): it concatenates every page's text
  layer AND pulls AcroForm field values (fillable personal-details forms keep
  their data in form fields, not the content stream). officeparser remains a
  fallback only when pdfjs cannot open the file. A genuinely image-only /
  scanned PDF (no text layer, no form fields) now gets a clear "looks like a
  scanned image — needs OCR" message instead of a blank failure.
- **Files explorer preview for Office/ODF docs.** `.docx`/`.xlsx`/`.pptx`/
  `.odt`/`.ods`/`.odp`/`.rtf`/`.doc` opened in the Files pane now preview as
  their EXTRACTED text rather than the confirm-gated "binary file" prompt that
  would only ever show garbled zip bytes. (Images and PDFs already preview
  natively — `<img>` and Chromium's PDF viewer — via the existing image/pdf
  `workspace.readFile` branches.)
