---
name: add-a-changeset
description: Add the changeset every PR requires (CI-enforced) and pick the right packages/bump — use on every PR, including docs-only ones.
---

# Add a changeset

Every PR needs a `.changeset/*.md` — the CI job "Changeset present" fails the
PR without one. Changesets drive ALL releases: npm publish, version bumps, AND
the desktop installer.

Hand-write `.changeset/<kebab-name>.md` (note: bare `pnpm changeset` does NOT
work here — @changesets/cli isn't a workspace dep; it's `pnpm dlx
@changesets/cli` or, simpler, write the file yourself):

```md
---
'@moxxy/sdk': patch
'@moxxy/cli': patch
---

One-line summary of the change (becomes the changelog entry).
```

Which packages to name:
- **Published to npm:** only `@moxxy/sdk` and `@moxxy/cli`. Everything else is
  `private` and tsup-bundled into the CLI binary — a change in any bundled
  package (core, plugins, modes, …) ships via a **`@moxxy/cli`** bump.
- **SDK type/API surface changed** → also name `@moxxy/sdk` (minor for new
  exports, patch for fixes).
- **`@moxxy/desktop`** is private but rides changesets: naming it cuts a
  desktop installer release; a cli/sdk bump cascades a patch to it
  automatically (`updateInternalDependencies: patch`).
- **Releases nothing** (docs / CI / tests / .claude tooling) → empty changeset:
  a file with an empty `---\n---` header + a summary line (or
  `pnpm dlx @changesets/cli --empty`).

Bump norms: `patch` for fixes/internal work, `minor` for new user-facing
features or new SDK exports, `major` never so far (pre-1.0).

Details: AGENTS.md → "Releasing (changesets)"; pipeline: release-flow skill.
