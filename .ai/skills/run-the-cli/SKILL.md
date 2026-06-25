---
name: run-the-cli
description: Run the locally-built moxxy CLI for a manual smoke or one-shot turn — use to verify a change in the real binary, not just tests.
---

# Run the CLI locally

The binary is tsup-bundled — **`pnpm build` first**, or your edits aren't in it.

```sh
node packages/cli/dist/bin.js --help              # cheapest smoke (CI runs this)
node packages/cli/dist/bin.js plugins list         # boots plugin host, no API calls
node packages/cli/dist/bin.js doctor --check-keys  # config / vault / providers / channels diagnosis
node packages/cli/dist/bin.js channels             # registered channels + subcommands
```

One-shot turn (headless, deny-by-default permissions — allow tools explicitly):

```sh
ANTHROPIC_API_KEY=sk-... node packages/cli/dist/bin.js \
  -p "list files" --allow-tools Read,Glob
```

Interactive TUI: `node packages/cli/dist/bin.js` (needs a real TTY — won't work
from a non-interactive shell; ask the user to drive it for TUI-visual checks).

Notes:
- Key resolution order: `moxxy.config.ts` → vault (`~/.moxxy/vault.json`,
  `MOXXY_VAULT_PASSPHRASE` unlocks headless) → `<PROVIDER>_API_KEY` env →
  interactive prompt (TTY only).
- Daemon/channels: `moxxy serve` runs the bare runner (unix socket);
  `moxxy mobile` serves the WS bridge + QR. Stale daemon after a protocol
  bump self-heals on next attach (see change-runner-protocol skill).
- `moxxy plugins new <name>` scaffolds a user-scope plugin under
  `~/.moxxy/plugins/`; `moxxy plugins reload` hot-loads it.
- Env vars reference: README.md → "Environment variables".
