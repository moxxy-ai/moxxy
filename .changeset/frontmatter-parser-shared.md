---
"@moxxy/sdk": minor
"@moxxy/core": patch
"@moxxy/plugin-memory": patch
"@moxxy/cli": patch
---

Move the copy-pasted Markdown + YAML-subset frontmatter mini-parser into
`@moxxy/sdk` as a single canonical, zero-dependency module
(`parseFrontmatterFile` / `parseFrontmatter` / `renderFrontmatter`). It was
duplicated almost line-for-line between `packages/core/src/skills/parse.ts` and
`packages/plugin-memory/src/parse.ts`, and the two copies had diverged: the
plugin-memory copy split inline arrays on bare commas and dropped null/float
typing.

The shared module keeps the more-correct `core` behavior — depth- and
quote-aware inline arrays, `null`/`~`, and float parsing — so both packages now
share one source of truth with identical parse output (same fields, same
missing/blank-frontmatter handling, same body offset). `core` and
`plugin-memory` re-export from the SDK under their existing public names
(`parseSkillFile`/`ParsedSkillFile`, `parseMdFile`/`ParsedFile`); call sites and
on-disk formats are unchanged. Adds golden tests pinning the prior behavior.
