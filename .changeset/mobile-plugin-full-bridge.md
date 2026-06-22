---
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

Make the full mobile plugin app use the working mobile bridge end to end: Expo web origins are allowed by `moxxy mobile`, QR pairing is WS-only via `ws(s)://...?t=token`, `@moxxy/client-transport-ws` exposes a closeable `makeWsApiHandle`, the standalone bridge exposes desktop-style desks/sessions, Expo Web NativeWind styles now render correctly, and the app now shows/selects real bridge sessions before chatting with the agent.

Share the workspace/session registry across TUI, Desktop, and Mobile: sessions created outside a known workspace now land in the stable global `Moxxy` workspace, CLI/TUI persistence syncs session metadata into the registry, Desktop reads the same registry, and remote mobile clients can list/switch desks through the safe WS IPC allow-list.

Harden the shared registry sync so tests and empty probe sessions do not leak into a real user profile: session persistence now honors `MOXXY_HOME`, `readIndex()` backfills missing first prompts from the JSONL log, CLI/TUI waits for a real user prompt before registering a session, stale session cwd values fall back safely, and desktop runner spawn errors no longer crash the main process.

Keep legacy desktop sessions readable from Mobile by falling back to the desktop chat mirror when a registry session id has no matching core session log.

Allow the shared chat store to retry loading a session transcript when an earlier read returned an empty page, so switching back to a persisted Desktop/Mobile session can recover history once the host is ready.

Make session history recovery use the core session JSONL as the canonical source whenever it exists, repairing missing, empty, or partial desktop chat mirrors so older multi-session conversations open with their full transcript on Desktop and Mobile.
