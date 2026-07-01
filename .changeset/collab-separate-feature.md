---
'@moxxy/mode-collaborative': minor
'@moxxy/desktop-ipc-contract': minor
'@moxxy/desktop-host': minor
'@moxxy/desktop': minor
'@moxxy/plugin-cli': minor
'@moxxy/cli': minor
---

Make collaboration a fully separate feature that never touches your chats or their sessions.

Previously `/collab` (and the desktop Collaborate tab) ran the coordinator **inside the active chat session** — it flipped that session's mode to `collaborative` and streamed the whole team's activity into the chat's own event log, so a collaboration polluted the chat thread and its transcript.

Now the coordinator runs on its **own dedicated runner** — a new internal `moxxy collab` command that boots its own headless Session + runner socket, hosts the collab hub, and spawns the architect/implementer team exactly as before.

- **Desktop:** the Collaborate panel supervises that coordinator (`CollabSupervisor`) and drives it over a dedicated `collab.*` IPC surface + `collab.event` / `collab.approval` broadcasts (a private `useCollab` hook, not `useChat`). The roster-approval checkpoint is answered inline in the panel.
- **TUI:** `/collab <goal>` re-points the terminal onto the coordinator's own session (via the same in-place switch `/sessions` uses) and auto-submits the goal there — the roster approval and the live `◆ collab` block render as usual, but on the coordinator's session, not your chat. Bare `/collab` attaches to a running collaboration to view it; `/sessions` returns you to chat while the collaboration keeps running.

Either way, a collaboration is entirely decoupled from every chat session — no mode-switch, no events in a chat's thread. The roster-approval checkpoint (the one human-in-the-loop gate) is preserved because the attaching UI drives the goal turn, so the coordinator's approval is forwarded to it. The single-flight lock now also records the coordinator's runner socket so a UI can discover and attach to a running coordinator (including one started elsewhere).
