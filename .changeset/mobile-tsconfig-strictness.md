---
---

Bring `apps/mobile` up to repo TypeScript strictness: set `noUncheckedIndexedAccess` and `verbatimModuleSyntax` explicitly (it extends `expo/tsconfig.base`, which lacks both) and fix the surfaced errors. Types-only change, releases nothing.
