---
"@moxxy/desktop": minor
---

feat(desktop): redesign the document anonymizer as a guided import → settings → output flow

Simpler, clearer UX: a three-stage layout (Import / Settings / Output). Import has
an Upload-vs-Paste toggle with a friendly drag-drop dropzone + file picker; Settings
puts the redaction categories in a proper multi-select dropdown (checkboxes + All/None)
alongside the mode control and custom terms; Output shows per-category counts with
Copy + Save. The offline engine, on-device NER, document parsing, and the bytes-not-path
drag-drop security model are unchanged.
