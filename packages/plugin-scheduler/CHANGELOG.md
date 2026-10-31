# @moxxy/plugin-scheduler

## 0.47.0

### Minor Changes

- 1a6664f: Let a recurring schedule run only inside a time window. `schedule_create` takes `startAt` and `endAt` next to `cron` ("every 30 minutes from 23:00 to 07:00"): nothing fires before `startAt`, the run at `endAt` still fires (up to 5 minutes late, since the poller ticks every 30 seconds), a run missed by more than that is dropped instead of firing outside the window, and the schedule turns itself off. A window that is already over is refused, and sending `cron` with `runAt` now tells the model to use `startAt`/`endAt` instead.
- 3879896: Create schedules from the desktop. Automations → Schedules has a New schedule button that opens a form: what Moxxy should do, how often (every few minutes or hours, every day, weekdays, every week, once, or a cron), optionally between two dates, a name filled in from the prompt and the chat it runs in. It says in one sentence what will happen, points at what is missing under each field, and never saves a schedule that could not run. The screen itself is redrawn as cards in the Settings look instead of a table: each schedule says its repeat in words ("Every 30 minutes"), then its window, next and last run; a schedule can be deleted (after a confirmation), and the list refreshes itself every 30 seconds.

  Behind it: the new `scheduler.create` IPC command, checked in the host by `scheduleDraftProblem`, the scheduler's shared rules for a new schedule (`@moxxy/plugin-scheduler`); `useScheduler` gains `create` and an optional `refreshEveryMs`, and keeps one list for the whole window, so the Automations sidebar no longer misses a schedule created, paused or deleted on the screen; `Modal` takes a `className`.

  Fixed: a running Moxxy no longer misses schedules created, paused or deleted by the desktop or `moxxy schedule`, and no longer writes its old copy back over them. Each process kept its first read of `schedules.json` for good; the store now reads the file again before every read and every change (`sharedWithOtherProcesses` in `createJsonFileStore`).

- 24bd7f3: One set of rules for a new schedule, wherever it comes from. The `schedule_create` tool, `moxxy schedule add` and the desktop's New schedule form now check a draft with the same `scheduleDraftProblem` (split into `scheduleShapeProblem` and `scheduleTimingProblem`). A one-shot time more than a minute in the past is refused everywhere: the tool tells the model to ask the user for a new time, and the CLI exits with code 2 instead of only warning. A time set for the current minute still runs.

  Two processes changing the schedules file at the same moment no longer lose each other's change: a store created with `sharedWithOtherProcesses` takes a short-lived `<file>.lock` around each change, and takes over a lock left behind for more than 10 seconds by a process that died.

  The New schedule form starts with "Runs in" set to the chat you are in. It checks a custom cron as you type and shows an example when it is wrong. When the host refuses a save, the reason appears under the field it is about, in the form's own words; anything else shows as a sentence at the bottom of the form. The Schedules screen says "Next run: starting now" instead of "due now", and reads the list again a few seconds after the soonest run starts instead of waiting for the next 30-second refresh.

### Patch Changes

- 1e49040: A time window no run falls inside is refused instead of saved. "Every 5 minutes from 03:47 to 03:49" would never run, because the next run is 03:50: the `schedule_create` tool, `moxxy schedule add` and the desktop's New schedule form now say so, and the form's sentence no longer promises runs. `firstFireBetween` in `@moxxy/sdk/cron` finds the first fire inside a window.

  An idle scheduler no longer touches `schedules.json`. Every running Moxxy rewrote the file on each 30-second tick while syncing skill schedules, even with nothing to change. It now compares first, and takes the file lock and writes only when something changed.

- 5f83fb5: A time window that opens inside a minute (`startAt` at 23:00:30) no longer fires at 23:00:00, before the window: its first run is the next whole minute (23:01).

  Two processes taking over a schedules lock left behind by a dead process can no longer both change `schedules.json` at once and lose one change. Only the waiter holding `<file>.lock.takeover` may remove the stale lock, and only if it is still stale then. The lock code moved into its own module, `packages/sdk/src/file-lock.ts`.

- Updated dependencies [1e49040]
- Updated dependencies [5f83fb5]
- Updated dependencies [3879896]
- Updated dependencies [24bd7f3]
  - @moxxy/sdk@0.47.0

## 0.46.0

### Patch Changes

- Updated dependencies [546836d]
  - @moxxy/sdk@0.46.0

## 0.45.0

### Patch Changes

- a8e8418: Claude Agent: the times Claude sets itself to come back (ScheduleWakeup, `/loop`, CronCreate) show above the message box ("Back at 22:59 · in 3 min") and under "Scheduled" in the Agents pane, read from Claude's own list (`SessionInfo.scheduledWakeups`, runner protocol 31); the turn it comes back in reads "Scheduled check-in". The Agents pane and the background line are drawn with the app's own pieces, and the desktop's close, warning, check, fit and broadcast marks are icons rather than text glyphs. The cron parser moved to `@moxxy/sdk/cron`.
- Updated dependencies [71f8aa8]
- Updated dependencies [db33b95]
- Updated dependencies [71e90e5]
- Updated dependencies [84ff880]
- Updated dependencies [b6c11c4]
- Updated dependencies [02119e8]
- Updated dependencies [29841af]
- Updated dependencies [211f80c]
- Updated dependencies [49dd789]
- Updated dependencies [90ab0bb]
- Updated dependencies [cb494ef]
- Updated dependencies [b6c11c4]
- Updated dependencies [887b8b7]
- Updated dependencies [072b8b5]
- Updated dependencies [a8e8418]
- Updated dependencies [322f2ce]
- Updated dependencies [7868760]
- Updated dependencies [4af5560]
- Updated dependencies [ee669b7]
- Updated dependencies [3c1527c]
- Updated dependencies [178a215]
- Updated dependencies [318d476]
- Updated dependencies [7cc93a2]
- Updated dependencies [6e54a6b]
- Updated dependencies [1329245]
- Updated dependencies [8472068]
- Updated dependencies [deeeeea]
- Updated dependencies [46b20d3]
- Updated dependencies [9bfe644]
- Updated dependencies [d2de3a1]
- Updated dependencies [7d718f6]
- Updated dependencies [6f4d652]
- Updated dependencies [d118b03]
- Updated dependencies [2160501]
- Updated dependencies [2b9c87f]
- Updated dependencies [332e4c2]
- Updated dependencies [a06de31]
- Updated dependencies [066a949]
- Updated dependencies [fa44b8c]
  - @moxxy/sdk@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies [d70839e]
  - @moxxy/sdk@0.44.0

## 0.43.0

### Patch Changes

- Updated dependencies [7b24827]
- Updated dependencies [45f501a]
- Updated dependencies [1c4d5aa]
- Updated dependencies [889810e]
- Updated dependencies [3b0fcdf]
- Updated dependencies [0a44449]
- Updated dependencies [235ae19]
- Updated dependencies [a501dbd]
  - @moxxy/sdk@0.43.0

## 0.42.1

### Patch Changes

- @moxxy/sdk@0.42.1

## 0.42.0

### Patch Changes

- Updated dependencies [1bde2f6]
- Updated dependencies [ac81f33]
- Updated dependencies [2f408fa]
- Updated dependencies [f44cf63]
- Updated dependencies [54d629a]
- Updated dependencies [ca9a67f]
- Updated dependencies [467542f]
- Updated dependencies [808bbfd]
- Updated dependencies [c329313]
- Updated dependencies [9cb28d6]
- Updated dependencies [bd8473c]
- Updated dependencies [40b40f4]
- Updated dependencies [194abc6]
- Updated dependencies [e825fa1]
- Updated dependencies [40d310e]
- Updated dependencies [5ca8fbe]
- Updated dependencies [c273722]
- Updated dependencies [5a18a15]
- Updated dependencies [97c44bd]
- Updated dependencies [8a10b7d]
- Updated dependencies [a34b1d7]
- Updated dependencies [1e5cb75]
- Updated dependencies [bf368a0]
- Updated dependencies [fe2eb5a]
- Updated dependencies [a34b1d7]
  - @moxxy/sdk@0.42.0

## 0.41.3

### Patch Changes

- Updated dependencies [6fefc59]
  - @moxxy/sdk@0.41.3

## 0.41.2

### Patch Changes

- @moxxy/sdk@0.41.2

## 0.41.1

### Patch Changes

- @moxxy/sdk@0.41.1

## 0.41.0

### Patch Changes

- Updated dependencies [9039517]
- Updated dependencies [c6ee82d]
- Updated dependencies [b01809e]
- Updated dependencies [46136ab]
- Updated dependencies [f13cda7]
- Updated dependencies [ba473d9]
  - @moxxy/sdk@0.41.0

## 0.40.0

### Patch Changes

- Updated dependencies [7e47604]
  - @moxxy/sdk@0.40.0

## 0.39.0

### Patch Changes

- Updated dependencies [1d983d9]
  - @moxxy/sdk@0.39.0

## 0.38.0

### Patch Changes

- Updated dependencies [971fd32]
  - @moxxy/sdk@0.38.0

## 0.37.2

### Patch Changes

- Updated dependencies [84dd2c5]
  - @moxxy/sdk@0.37.2

## 0.37.1

### Patch Changes

- Updated dependencies [e80b9d6]
- Updated dependencies [abd9482]
- Updated dependencies [5e4ca9f]
  - @moxxy/sdk@0.37.1

## 0.37.0

### Patch Changes

- Updated dependencies [78938f8]
  - @moxxy/sdk@0.37.0

## 0.36.1

### Patch Changes

- @moxxy/sdk@0.36.1

## 0.36.0

### Patch Changes

- Updated dependencies [bc7844e]
  - @moxxy/sdk@0.36.0

## 0.35.4

### Patch Changes

- @moxxy/sdk@0.35.4

## 0.35.3

### Patch Changes

- @moxxy/sdk@0.35.3

## 0.35.2

### Patch Changes

- @moxxy/sdk@0.35.2

## 0.35.1

### Patch Changes

- @moxxy/sdk@0.35.1

## 0.35.0

### Patch Changes

- Updated dependencies [57f0810]
  - @moxxy/sdk@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [ae16897]
- Updated dependencies [d9ae119]
- Updated dependencies [6d8fdcd]
- Updated dependencies [220673e]
- Updated dependencies [b25850c]
- Updated dependencies [63b1df5]
- Updated dependencies [3dfc2f3]
- Updated dependencies [e52e2ed]
- Updated dependencies [e52e2ed]
- Updated dependencies [06e81f8]
  - @moxxy/sdk@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [b241085]
  - @moxxy/sdk@0.33.0

## 0.32.0

### Patch Changes

- Updated dependencies [3b0c14a]
  - @moxxy/sdk@0.32.0

## 0.31.0

### Patch Changes

- Updated dependencies [8bb26b1]
- Updated dependencies [43926ab]
  - @moxxy/sdk@0.31.0

## 0.30.0

### Patch Changes

- Updated dependencies [c124a15]
  - @moxxy/sdk@0.30.0

## 0.29.0

### Patch Changes

- f837396: Replace non-null assertions and depth-2+ optional chains with guard clauses per the "Guard, don't chain" rule: `assertDefined`/`invariant` from `@moxxy/sdk` where absence is impossible by construction, narrow-once guards preserving silent paths where absence is a normal runtime path (optional loggers, optional layout, cache lookups). No behavior change on normal-absence paths.
- Updated dependencies [d99087f]
- Updated dependencies [f360bf6]
  - @moxxy/sdk@0.29.0

## 0.28.1

### Patch Changes

- Updated dependencies [6c0af71]
  - @moxxy/sdk@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
  - @moxxy/sdk@0.28.0

## 0.27.0

### Patch Changes

- 885c80c: Declare `isolation` capability specs on every collab, webhooks, workflows, and scheduler tool (wave 2/3 of the capability backfill toward `security.requireDeclaration`).
- Updated dependencies [e791484]
- Updated dependencies [49b1d73]
- Updated dependencies [3b27404]
- Updated dependencies [0b6f40e]
- Updated dependencies [2cff46b]
- Updated dependencies [2cef8e1]
- Updated dependencies [98f545c]
- Updated dependencies [ee2967d]
- Updated dependencies [2a35357]
- Updated dependencies [67a3387]
- Updated dependencies [be28d55]
  - @moxxy/sdk@0.27.0

## 0.26.0

### Patch Changes

- Updated dependencies [8c70f3c]
- Updated dependencies [8c70f3c]
- Updated dependencies [ce56ef6]
  - @moxxy/sdk@0.26.0

## 0.1.8

### Patch Changes

- @moxxy/sdk@0.25.0

## 0.1.7

### Patch Changes

- @moxxy/sdk@0.24.1

## 0.1.6

### Patch Changes

- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0

## 0.1.5

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0

## 0.1.4

### Patch Changes

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0

## 0.1.3

### Patch Changes

- @moxxy/sdk@0.21.1

## 0.1.2

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0

## 0.1.1

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0

## 0.1.0

### Minor Changes

- 08f927a: feat: pick which session ambient triggers run in + a compact trigger marker

  Ambient triggers (webhooks, schedules, workflows) used to fire on whichever
  session **created** them, and the synthesized prompt — often a large block
  carrying an untrusted webhook payload — rendered as a giant user bubble. Two
  changes:

  **Pick the target session.** Each trigger can now be pinned to a chosen session
  (where its run executes _and_ displays), decoupled from who created it:

  - `webhook_create` / `schedule_create` take an optional `targetSessionId`
    (defaulting to the creating session), and `webhook_update` /
    `schedule_set_target` reassign it. These map onto the existing
    `ownerSessionId` routing key, so the webhook queue/drain and the scheduler
    owner-gate already deliver to the right runner — no routing change.
  - Workflows gained a top-level `targetSessionId`. Scheduled workflows stamp it
    onto their scheduler mirror row (reusing the owner-gate); `fileChanged` is
    watched only by the target runner; a cross-session `afterWorkflow` dependent
    is skipped with a warning (the completion event is in-process to the parent's
    runner). The visual builder preserves the field across a round-trip.
  - Desktop: the Webhooks / Schedules / Workflows panels and the workflow builder
    gain a session picker (new `*.setTargetSession` IPC commands), and each
    summary surfaces the resolved target-session name.

  **Compact trigger marker.** A fired trigger now renders as a one-line,
  expandable chip ("Webhook received · github-issues", "Schedule fired · daily",
  "Workflow ran · digest") instead of the raw prompt — click to reveal the full
  payload. The prompt still lives in the model's context (security fences intact);
  only the display changes (new optional `origin` on the `user_prompt` event,
  threaded from the fired turn via `RunTurnOptions.origin`).

  Unset everywhere preserves today's behavior; single-process CLI/TUI is
  unaffected.

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0

## 0.0.29

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0

## 0.0.28

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0

## 0.0.27

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1

## 0.0.26

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0

## 0.0.25

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2

## 0.0.24

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1

## 0.0.23

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0

## 0.0.22

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5

## 0.0.21

### Patch Changes

- 897a1fc: Long-tail review fixes (quality sweep, t3 cluster):

  - plugin-oauth: thread the flow's abort signal into device-flow poll fetches (and the OpenAI token exchange) so a hung in-flight poll cancels, not just the inter-poll sleep; drop redundant clearTimeout calls in the callback server (settle() is the single cleanup chokepoint); document the credential-lock stale-takeover TOCTOU window.
  - plugin-vault: randomCode now draws width-appropriate entropy and rejection-samples — fixes the silent leading-digit cap for codes >= 10 digits and the modulo bias.
  - plugin-mcp: one malformed mcp.json entry no longer discards the whole server catalog (per-entry parse keeps valid rows); MCP resource results pass through inline text instead of a bare [resource]; createMcpPlugin connects servers in parallel (boot bounded at the slowest, not the sum).
  - plugin-scheduler: describeEntry shares the poller's next-fire baseline so the displayed next-fire agrees with when isDue fires; tickOnce counts due-and-attempted schedules (counts a fired-but-failed run).
  - workflows-builder: block-scalar parser strips indentation by the minimum body indent (no longer corrupts a literal block whose lines are shallower than the first).
  - runner: createUnixSocketServer.onConnection is single-handler (last-write-wins), consistent with Transport.onFrame/onClose.
  - mobile-poc: boot the env-URL transport in an effect (not a render-phase useState initializer); guard approval allow/deny against forwarding an empty optionId.

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4

## 0.0.20

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3

## 0.0.19

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2

## 0.0.18

### Patch Changes

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1

## 0.0.17

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0

## 0.0.16

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0

## 0.0.15

### Patch Changes

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0

## 0.0.14

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0

## 0.0.13

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0

## 0.0.12

### Patch Changes

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0

## 0.0.11

### Patch Changes

- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1

## 0.0.10

### Patch Changes

- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/sdk@0.8.0

## 0.0.9

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0

## 0.0.8

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3

## 0.0.1

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
  - @moxxy/core@0.0.1
