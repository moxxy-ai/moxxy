---
title: '@moxxy/plugin-scheduler'
description: Cron + one-shot prompt firing; stored at ~/.moxxy/schedules.json.
---

`@moxxy/plugin-scheduler` is the engine for time-driven prompts.
Entries persist as JSON; a poller fires each entry into its own
isolated session. Run foreground (`moxxy schedule daemon`) or install
as a service (`moxxy service install scheduler`).

## Install

```sh
pnpm add @moxxy/plugin-scheduler
```

## Build

```ts
import { buildSchedulerPlugin } from '@moxxy/plugin-scheduler';

const { plugin, store, poller } = buildSchedulerPlugin({
  runner: async ({ prompt, model }) => {
    // Bootstrap an isolated session and run a single turn.
    // Return { ok, text } so the poller can record lastResult/lastError.
  },
  skills: session.skills, // optional: mirror skill schedules into the store
  intervalMs: 30_000,     // optional: how often the poller wakes
});
session.pluginHost.registerStatic(plugin);
```

The CLI's `setupSessionWithConfig` does this for you, so end-users
don't construct it directly — `moxxy schedule …` reaches into the
store via the same path.

## Tools (agent-facing)

| Tool | Purpose |
|---|---|
| `schedule_create` | Add a cron or `runAt` entry. |
| `schedule_list` | List all schedules with `nextFireAt`. |
| `schedule_delete` | Remove by id. |
| `schedule_enable` / `schedule_disable` | Toggle without deleting. |
| `schedule_run_now` | Fire one entry immediately. |

## Cron syntax

Five fields: `min hour dom mon dow`. Supports `*`, `*/n`, ranges, lists,
and `L` (last). IANA timezone optional per entry. See
`packages/plugin-scheduler/src/cron.ts`.

## Skill-driven schedules

Skills with a `schedule:` block in their frontmatter are mirrored
into the store on startup and after every `skill_created` event
(`packages/plugin-scheduler/src/skill-sync.ts`). Delete the skill →
the schedule disappears on the next sync.

## Storage

```
~/.moxxy/schedules.json   ScheduleEntry[]
~/.moxxy/inbox/           per-channel delivery dir for headless runs
```

## See also

- [Scheduler guide](../guides/scheduler.md) — adding, removing, daemon modes.
- [Running as a service](../guides/running-as-a-service.md) — install as launchd / systemd.
