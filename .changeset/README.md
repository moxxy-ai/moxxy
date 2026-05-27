# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

Only the **published** packages are versioned/released here — `@moxxy/cli` and
`@moxxy/sdk`. Every other package is `private: true` and is bundled into the CLI
binary, so Changesets skips it automatically.

To record a change for the next release (no install needed — run via dlx):

```sh
pnpm dlx @changesets/cli add   # pick @moxxy/cli and/or @moxxy/sdk, choose bump
```

(Or add `@changesets/cli` to root devDependencies + `pnpm install` to get the
shorter `pnpm changeset` command locally.)

That writes a markdown file here. On merge to `main`, the Release workflow opens
a "Version Packages" PR (bumps versions + changelogs); merging that PR publishes
to npm. See `.github/workflows/release.yml`.
