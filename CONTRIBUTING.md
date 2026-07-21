# Contributing to Moxxy

Thank you for helping improve Moxxy. Contributions to code, documentation, tests, and issue reports are welcome.

## Before you start

For a non-trivial change, open an issue first so maintainers and contributors can agree on the problem and approach. Keep pull requests focused on one concern and explain the user-visible behavior they change.

Read [AGENTS.md](AGENTS.md) before making code changes. It documents the repository architecture, invariants, and task-specific guides. The author guides in [`.ai/agents/`](.ai/agents/) cover plugins, tools, providers, modes, channels, compactors, cache strategies, and other extension points.

Security vulnerabilities should not be reported in a public issue. Follow the private reporting process in [SECURITY.md](SECURITY.md).

## Set up the repository

Moxxy requires Node.js 20.10 or newer and uses the package manager version pinned in `package.json`.

```sh
corepack enable
pnpm install
```

## Make a change

- Follow the dependency boundaries and coding guardrails in [AGENTS.md](AGENTS.md).
- Add or update tests for behavior changes.
- Update public documentation when an interface or workflow changes.
- Do not commit credentials, generated local state, or unrelated formatting changes.
- Add a changeset for every pull request. Use `pnpm changeset` for a release change or `pnpm changeset --empty` for documentation, CI, and test-only changes.

## Verify the change

Run the checks relevant to your change. Before requesting review for a code change, run the complete repository gate:

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm check:deps
```

CI runs supported Node.js versions and must be green before merge.

## Open a pull request

In the pull request description:

- state the problem and the chosen solution
- list the verification commands you ran
- call out compatibility, security, or follow-up considerations
- link the issue when one exists

Respond to review feedback with focused follow-up commits. Maintainers may squash commits when merging.
