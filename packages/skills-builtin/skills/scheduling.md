---
name: scheduling
description: Create, inspect, and manage recurring or one-shot scheduled prompts that fire on a cron or a specific timestamp.
triggers:
  - schedule
  - cron
  - every day
  - every hour
  - in an hour
  - tomorrow at
  - heartbeat
  - reminder
  - daily briefing
  - recurring
  - automate
allowed-tools:
  - schedule_create
  - schedule_list
  - schedule_delete
  - schedule_enable
  - schedule_disable
  - schedule_run_now
  - telegram_send_message
---

Use this skill when the user wants a prompt to fire automatically — recurring on a cron, or once at a fixed time. Each scheduled run starts a fresh turn, the assistant's final message gets written to `~/.moxxy/inbox/`, and the prompt itself can call delivery tools (e.g. `telegram_send_message`) for push notifications.

## Pattern

1. **Capture intent** — what should fire, when, and where the output should land.
   - "Every day at 9 AM" → cron `0 9 * * *`
   - "Every Monday at 6 PM" → cron `0 18 * * 1`
   - "Every 15 minutes" → cron `*/15 * * * *`
   - "In one hour" → `runAt: <epoch-ms now + 3_600_000>` (or ISO timestamp)
   - "Tomorrow at 10" → `runAt: <ISO timestamp>` in the user's local zone

2. **Pick the schedule name** — slug-like (`morning-briefing`, `weekly-standup`). The user-facing name; appears in the inbox filename.

3. **Write the prompt deliberately** — this prompt runs *headless* against the current provider/model. Include the delivery action in the prompt body if you want a push notification. Examples:
   - "Fetch today's top 5 Hacker News posts; for each, write a 2-line summary; then call `telegram_send_message` with a markdown-formatted digest."
   - "Check Gmail for new messages from <X>; if any, summarize and call `telegram_send_message`."
   - "Remind me about <X>. Call `telegram_send_message` with a short reminder."

4. **Call `schedule_create`** with `{ name, prompt, cron | runAt, channel?, model? }`. The tool returns `nextFireIso` so you can confirm the schedule will fire when expected.

5. **Confirm to the user** — name, next fire time, where output goes. Offer to fire it once with `schedule_run_now` for a smoke test.

## Cron cheat-sheet (5-field POSIX)

```
minute   hour   dom   month   dow
0-59     0-23   1-31  1-12    0-6 (Sun=0)
```

Operators: `*` any, `a-b` range, `a,b,c` list, `*/n` step, `a-b/n` ranged step.

Common shapes:
- `0 9 * * *`     — 9 AM every day
- `0 9 * * 1-5`   — weekdays at 9 AM
- `0 */2 * * *`   — every 2 hours on the hour
- `0 0 1 * *`     — midnight on the 1st of each month
- `30 18 * * 5`   — Fridays at 6:30 PM

When both day-of-month and day-of-week are restricted, the schedule fires when **either** matches (vixie-cron convention).

## Managing existing schedules

- `schedule_list` — view all, with `nextFireIso` + `lastResult`. Filter by `source: 'manual'|'skill'|'all'`.
- `schedule_disable` / `schedule_enable` — pause/resume without losing the row.
- `schedule_delete` — permanently remove.
- `schedule_run_now` — fire immediately, useful for testing.

## Auto-scheduled skills

A skill file can include a `schedule:` block in its frontmatter — the scheduler picks it up automatically:

```yaml
---
name: morning-briefing
description: Daily 9 AM Hacker News digest
schedule:
  cron: "0 9 * * *"
  channel: telegram
---
Fetch the top 5 stories from https://news.ycombinator.com/.
For each, write 2 lines. Then call telegram_send_message with the digest.
```

Skill-driven schedules show up in `schedule_list` with `source: 'skill'`. Editing the skill body or its `schedule:` block on disk updates the live schedule on the next tick — no restart needed.

## Limitations to mention if relevant

- Schedules only fire while a moxxy session is alive (TUI, Telegram channel, etc.). For true 24/7 firing, the user must keep a session running (e.g. `moxxy telegram` in a background process).
- The scheduled prompt runs against the **active session**, so its output appears in conversation history. Schedule with care while debugging an unrelated turn.
- Timezones default to the host's system local. For UTC or another zone, pass `timeZone: "UTC"` or any IANA name.
