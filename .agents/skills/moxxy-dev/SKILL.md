---
name: moxxy-dev
description: Use when the user wants to start the local Moxxy gateway for iterative development, verify the gateway is running, or tail events from a running agent. Triggers: "start the gateway", "run moxxy locally", "spin up the dev server", "tail events", "is the gateway up".
---

# Moxxy Dev Gateway

This skill runs the gateway from source (no binary download) and streams logs/events so the user can iterate on Rust + CLI changes in tandem.

## Pre-flight check

Before starting anything, check if the gateway is already running:

```bash
lsof -ti:3000
```

If a process is bound to :3000, ask the user whether to kill it or use it as-is. Don't auto-kill — that could destroy another session's work.

## Start the gateway (from source)

Run in a background shell so logs stream back but the prompt stays available:

```bash
cd /Users/maqsiak/moxxy/moxxy-v4
MOXXY_AUTH_MODE=loopback RUST_LOG=info cargo run -p moxxy-gateway
```

- `MOXXY_AUTH_MODE=loopback` lets localhost callers skip token auth — development convenience.
- `RUST_LOG=info` is the default noise level; use `moxxy_gateway=debug,moxxy_runtime=debug` when chasing a runtime bug.
- Run via `Bash` with `run_in_background: true`. Track the shell ID so later calls can tail its output via `BashOutput`.

## Verify it's up

```bash
curl -s http://localhost:3000/v1/health
```

Expect `{"status":"ok"}` or similar. If the port's bound but health fails, the old process is stale — offer to kill it and retry.

## Tail events

Once the gateway is up, the user may want to watch events for a specific agent:

```bash
moxxy events tail --agent <agent-id>
```

If the user hasn't set `MOXXY_TOKEN` and auth mode isn't `loopback`, this will fail — tell them to either export the token or relaunch with loopback.

## CLI linkage

If the user wants `moxxy ...` to point at their local source CLI (not the globally-installed npm build), they need:

```bash
cd /Users/maqsiak/moxxy/moxxy-v4/apps/moxxy-cli
npm link
```

That makes `moxxy` resolve to `./dist/moxxy` from the repo. After changes to `src/`, they may need to rebuild (`npm run build`) depending on whether the repo runs via `tsx` or a bundled dist — check `package.json` scripts before telling them what to do.

## Shutting down

`pkill -f "cargo run -p moxxy-gateway"` or send `Ctrl+C` to the tracked background shell. Don't leave orphan gateway processes across sessions.

## Constraints

- Never set `MOXXY_AUTH_MODE=loopback` in any script the user might commit. It's dev-only.
- Never hardcode API keys in the command line — use env-var shell files, not CLI args.
- If the user's on a non-default port, respect `MOXXY_PORT` — don't assume 3000.
