# @moxxy/cli

## 0.1.3

### Patch Changes

- 93d9a2d: Publish with `pnpm publish` instead of `npm publish` so pnpm's `workspace:*` and `catalog:` protocols are rewritten to concrete version ranges in the published `package.json`.

  The previous `npm publish` shipped those protocols verbatim, so `npx @moxxy/cli init` failed on a clean machine with:

  ```
  npm error code EUNSUPPORTEDPROTOCOL
  npm error Unsupported URL Type "workspace:": workspace:*
  ```

  Both `@moxxy/cli` (`dependencies."@moxxy/sdk": "workspace:*"`, `zod: "catalog:"`) and `@moxxy/sdk` (`peerDependencies.zod: "catalog:"`) were affected, so both are republished.

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3

## 0.1.0

### Minor Changes

- c4352f9: First published release of the `moxxy` CLI and SDK (off the `0.0.0` placeholder).

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
