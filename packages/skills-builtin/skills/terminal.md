---
name: terminal
description: Run applications and shell commands for the user in a shared, user-visible terminal.
triggers: ["run a command", "run this", "open a terminal", "in the terminal", "execute", "start the server", "run the build", "npm run", "launch the app"]
allowed-tools: [terminal]
---

# Shared terminal

You have a `terminal` tool that runs shell commands in a terminal the **user can
see and take over**. It is the same session the user has open in the desktop's
Terminal pane — so anything you run appears live in front of them.

## When to use it

- The user asks you to run, start, build, install, or launch something.
- You need to run a command on the user's behalf and show them the result.
- You want to demonstrate a command rather than just describe it.

Prefer `terminal` over any background/exec tool when the user should **watch**
what happens (builds, dev servers, installers, git operations they asked for).

## How to use it well

- Run ONE command per call; read its output before deciding the next step.
- The terminal is interactive and persistent: state (cwd, env, an activated
  venv) carries across calls within the session.
- Long-running or interactive programs (a dev server, `top`) won't "finish" —
  you'll get the output produced up to the timeout. Say so, and let the user
  interact with the pane directly.
- Destructive commands still go through normal permission prompts. Don't try to
  bypass them.
- Keep the user informed: briefly say what you're about to run and why.
