# Agent connections run the vendor's own agent

A user who connects their Claude, ChatGPT (Codex) or OpenCode account gets the vendor's own coding agent doing the work, unmodified and from the CLI the user already has installed, with its prompt, tools, settings, skills and context management left as the vendor ships them. Moxxy only shows the run in its own interface, answers the agent's approvals and questions through its own windows, maps its auto-approve and plan settings onto the agent's own, lends it the browser, computer and mode tools over a local MCP server, and drives the agent's turns from `runReactLoop` so every Moxxy mode keeps working. We chose this so that the same model gives the same result in Moxxy as in the vendor's own tool, which Moxxy's own loop calling the vendor's model could not guarantee.

## Considered Options

- **Moxxy's loop on the vendor's model** (the text transport `claude-code` used before): rejected, because the vendor's prompt, tools and context handling are what make its results good, and the transport could not pass images.
- **Moxxy gating every native tool call by pausing the agent mid-turn**: rejected as a harness on top of a harness; approvals go through the agent's own permission hooks instead.
- **A private copy of each CLI managed by Moxxy** (OpenBot's approach): rejected, because a second copy can differ from the version the user runs in a terminal.

## Consequences

- Moxxy's own conduct rules (`AGENT_CONDUCT`: persistence, the feminine first person in Polish) are not sent to the vendor agent in any form, so an agent connection does not follow them. Nor does Moxxy nudge the agent at the end of a turn that looks unfinished; the agent decides when its turn is done. Moxxy's modes use the agent's own equivalent where it has one: plan mode is the agent's plan mode, and goal mode is the agent's own goal (Claude `/goal`, Codex thread goals). Only an agent without its own goal (OpenCode) gets Moxxy's goal loop, which sends it a follow-up until it reports the goal done.
- Auto-approve is one state shared with the agent, never a separate Moxxy flag: Moxxy shows the agent's real approval policy (a Codex config that never asks shows as auto-approve on) and turning auto-approve on or off in Moxxy changes the agent's policy for that conversation only; Moxxy never writes the agent's own configuration.
- Inside a turn the agent manages its own context; Moxxy's compaction, elision and cache strategy apply only on Moxxy's side.
- The agent's native tools are not run through Moxxy's isolators; Moxxy's `permissions.json` reaches them only through the agent's hooks.
- Using a Claude subscription through the Agent SDK goes against Anthropic's stated terms for third-party products unless Anthropic approves it; the owner accepted this deliberately.
