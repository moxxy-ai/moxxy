---
---

Bring `apps/mobile` up to repo TypeScript strictness: set `noUncheckedIndexedAccess` and `verbatimModuleSyntax` explicitly (it extends `expo/tsconfig.base`, which lacks both), fix the surfaced errors, and migrate the app off `expo-file-system/legacy` onto the modern SDK 54 File API. Releases nothing.
