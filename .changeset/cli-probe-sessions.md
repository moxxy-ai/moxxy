---
'@moxxy/cli': patch
---

Stop CLI probe/light-boot sessions from leaking daemons. A new `probeSession`
helper boots throwaway sessions with `skipInitHooks` (no scheduler poller, no
webhooks listener — those now start exactly once, in the real session that
owns them) and `disableSessionPersistence`, and guarantees the probe is closed
before returning. Previously `moxxy <channel>` self-host booted three sessions
and the orphaned probe won the webhooks port bind, so incoming webhooks ran
turns on an abandoned session and duplicate scheduler pollers raced on the
schedule store. Converted: the TUI needs-init probe, the `moxxy <command>`
channel-existence probe, the channel-dispatch light-boots (`moxxy <channel>` /
`moxxy channels …`), `moxxy schedule` store ops, the schedule-setup telegram
check, and `moxxy plugins list`.
