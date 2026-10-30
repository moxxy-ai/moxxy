---
title: Scheduler
description: Cron + one-shot prompt firing — the moxxy schedule daemon.
---

`@moxxy/plugin-scheduler` is the engine that fires prompts on a
timer. Entries persist in `~/.moxxy/schedules.json`; the daemon polls
them on an interval and dispatches each due entry into an isolated
session.

## Add a schedule

```sh
# Recurring (5-field cron, IANA timezone optional)
moxxy schedule add weekday-standup \
  --cron "30 8 * * 1-5" \
  --prompt "Draft a standup update from today's git log."

# One-shot at a specific instant
moxxy schedule add follow-up \
  --at "2026-06-01T09:00:00Z" \
  --prompt "Ping me about the migration."

# Recurring, but only inside a time window (local time); it turns itself off after --until
moxxy schedule add night-shift \
  --cron "*/30 * * * *" \
  --from "2026-10-29T23:00" --until "2026-10-30T07:00" \
  --prompt "Continue the book draft."

# Hint a channel — the prompt calls the channel's send tool
moxxy schedule add daily-digest \
  --cron "0 9 * * *" \
  --channel telegram \
  --prompt "DM me a summary of unread messages."
```

| Flag | Purpose |
|---|---|
| `--cron "<expr>"` | 5-field cron expression (min hour dom mon dow). |
| `--at "<iso>"` | One-shot ISO-8601 timestamp (or epoch-ms). A moment more than a minute in the past is refused (exit 2). |
| `--from "<iso>"` | With `--cron`: do not run before this moment. A start inside a minute (23:00:30) waits for the next whole minute. |
| `--until "<iso>"` | With `--cron`: the last moment to run (inclusive); then the schedule turns itself off. |
| `--channel <name>` | Soft hint — the prompt calls the matching send tool. |
| `--model <id>` | Override the active model for this schedule. |
| `--timezone <zone>` | IANA zone for cron interpretation (default: system local). |

### Time window

`--from`/`--until` (tool fields `startAt`/`endAt`) limit a cron schedule
to a window. Nothing fires before the start. The run due at the end
still fires, up to 5 minutes late (the poller ticks every 30 s); a run
missed by more than that, e.g. while the computer slept, is dropped.
Once no run is left in the window the schedule is disabled. A window
that has already ended, an end not after the start, or a window no run
of the cron falls inside ("every 5 minutes" from 03:47 to 03:49) is
refused.
Times without an offset are read in the computer's local time.

## Manage

```sh
moxxy schedule list                # everything, with next fire time
moxxy schedule remove <id>
moxxy schedule enable|disable <id>
moxxy schedule run <id>            # fire one immediately (testing)
```

`~/.moxxy/schedules.json` is shared by the desktop, the CLI and every
running Moxxy: each reads it again before every read and change, and
holds `schedules.json.lock` for the few milliseconds a change takes.
The desktop's Automations → Schedules screen lists the same entries
and has a New schedule form that applies the same rules.

## Daemon

The poller runs in two flavors:

```sh
moxxy schedule daemon              # foreground (Ctrl-C stops); fine for ad-hoc tests
moxxy service install scheduler    # launchd / systemd --user — install once, runs forever
```

`moxxy schedule setup` is a one-shot helper that installs the daemon
*and* pre-allows the common headless tools (Bash, Read, Glob, etc.)
so the agent doesn't deadlock on a permission prompt with no one to
answer.

The store, cron evaluator, and poller all live in
`packages/plugin-scheduler/src/`; see `cron.ts` for the expression
parser (supports `*`, `*/n`, ranges, lists, `L`).

## From inside a turn

The agent can manage schedules itself via these tools:

| Tool | Purpose |
|---|---|
| `schedule_create` | Add an entry (cron / runAt + prompt; `startAt`/`endAt` limit a cron to a window). |
| `schedule_list` | List with `nextFireAt`. |
| `schedule_delete` | Remove by id. |
| `schedule_enable` / `schedule_disable` | Toggle without deleting. |
| `schedule_run_now` | Fire immediately. |

## Skill-driven schedules

Skills with a `schedule:` block in their frontmatter are auto-mirrored
into the store on startup and after every `skill_created` event
(`packages/plugin-scheduler/src/skill-sync.ts`). Delete the skill →
the schedule disappears on the next sync.

## Delivery

Each scheduled run executes in an isolated session — no chat context
leaks across firings. Results land in the per-channel inbox dir
(default `~/.moxxy/inbox`). When `--channel telegram` is set, the
prompt is expected to call `telegram_send_message`; that's the link
to the user.
