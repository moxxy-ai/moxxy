---
'@moxxy/cli': minor
'@moxxy/sdk': minor
'@moxxy/desktop': patch
---

Moxxy now requires Node.js 22.19 or newer; Node 24 LTS is the recommended and default version. Node 20 reached end of life in April 2026, and the updated `openai`, `undici`, `officeparser` and `vitest` no longer support it.

Dependencies are updated in one batch: `@modelcontextprotocol/sdk` 1.31 (fixes a high-severity advisory), `openai` 7, `undici` 8, `officeparser` 8, `vitest` 5 with `@vitest/coverage-v8` 5, plus the non-major group (Anthropic SDK, turbo, typescript-eslint, Expo patch releases and others). Document text extraction drops an option officeparser 8 removed; behavior is unchanged.

Stopping `moxxy mobile` on macOS and Linux now ends the Expo server too, not only the npm process that started it; before, Expo could keep running in the background and hold port 8081.
