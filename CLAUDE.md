# CLAUDE.md

Read `AGENTS.md` first: it is the guide for every agent working in this repo, and all of it applies to Claude Code too.

## Before merging into `development`

Run `pnpm test:agents:live` on the exact code being merged (and before every release). It holds real conversations through Claude Code, Codex and OpenCode on this machine's sign-ins, which CI cannot do. Report the commit, the CLI versions and every result; an agent that could not be checked is **not checked**, never passing. Details: `AGENTS.md`, "Agent connections: live check before merging".
