# Claude Code skill library — moxxy

One thin SKILL.md per task; read only what the task needs. Frontmatter
`description` is the discovery trigger. Deep workflows stay in
`.claude/agents/*`; these skills are the repo-true checklists + commands.

<!-- To regenerate the table: for d in .claude/skills/*/; do awk -F': ' '/^name:/{n=$2} /^description:/{print "| "n" | "$2" |"}' "$d/SKILL.md"; done -->

## Dev loop

| Skill | Trigger |
|---|---|
| run-the-gate | Run build/typecheck/lint/test/deps before reporting done or opening a PR |
| fix-a-failing-test | Fastest reproduce loop for one failing vitest suite/test |
| rebase-and-resolve | Rebase onto latest main + resolve conflicts (incl. the TECH_DEBT.md hazard) |
| open-a-pr | PR conventions: worktree branch, changeset, title format, no AI attribution |
| add-a-changeset | The CI-required changeset: which packages, which bump, empty changesets |
| run-the-cli | Run the locally-built moxxy binary for manual smokes / one-shot turns |

## Extend the system

| Skill | Trigger |
|---|---|
| add-a-plugin | New @moxxy/plugin-* package + discovery/bundling wiring |
| add-a-tool | New model-callable tool: schema, permission, handler, secrets rules |
| add-a-provider | New LLMProvider (model API / auth scheme) |
| add-a-channel | New surface that drives a Session (TUI/Telegram/HTTP/WS-style) |
| add-a-mode | New loop strategy (like default/goal/research) |
| add-a-compactor | New context-compaction strategy |
| add-a-cache-strategy | New prompt-cache breakpoint placement |
| add-an-isolator | New capability Isolator (worker/subprocess/wasm/…) |
| add-an-embedder | New embeddings provider for memory/recall |
| add-a-skill-builtin | New Markdown skill in moxxy's own skills-builtin |
| add-a-slash-command | New /command on the chat surfaces |
| add-an-ipc-command | New desktop IPC command (contract + validation + host + WS/mobile) |
| change-runner-protocol | Runner wire-protocol changes + RUNNER_PROTOCOL_VERSION bump rule |

## Verify / debug

| Skill | Trigger |
|---|---|
| verify-desktop-packaged | Packaged-app smoke: electron-builder --dir + launch + WS-bridge check |
| verify-mobile | Expo PoC verification without a device (tests + export proof + pairing) |
| debug-self-update | Tier-1 hot-update misbehavior via <userData>/app state files + boot-log |
| debug-session-logs | Resume/desync/duplication issues in session JSONL + chat NDJSON |
| debug-ws-bridge | WS bridge auth/origin/port/token failures (desktop + moxxy mobile) |

## Process

| Skill | Trigger |
|---|---|
| tech-debt-journal | Operating TECH_DEBT.md: read-before-work, retire ≥1, A-intake |
| audit-wave | Deep audit pattern: parallel agents → adversarial verify → fix waves |
| release-flow | One workflow on development → version → advance main (tree-copy) → safe-publish → desktop draft → self-update |
| security-invariants | Load-bearing security rules every change must preserve |
