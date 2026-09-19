# Scoped workflow approvals

Workflows use the same hook, policy and tool dispatcher as interactive tool calls.
Scheduled DAGs run directly; they do not spend a model turn asking the agent to
call `workflow_run`. Prompt/skill steps still use the configured provider.

When policy does not already decide, a workflow action requests approval in Moxxy.
The request shows the workflow, execution, definition revision, tool and exact
arguments. Closing its modal leaves it available in Automations → Workflows.

- **Allow once** authorizes that call in the current execution.
- **Allow always** is limited to this workflow definition, tool and exact
  arguments, across future executions. It does not edit `permissions.json`.
- **Deny** blocks the action and suppresses an identical request in that execution.
- **Stop workflow** cancels the execution; a late answer cannot restart it.
- **Revoke approval** removes a persistent grant, including cached decisions
  that have not yet dispatched input.

Explicit policy denies remain authoritative, including in goal/auto-approve mode.
Changing executable workflow content invalidates pending decisions and persistent
grant matching. Name/description/cron are excluded from the revision hash, but a
file rename currently gives the workflow a new identity and requires new consent.
Arguments are matched exactly, not by an inferred wildcard or broad tool name.

Requests/decisions are validated local records under
`MOXXY_HOME/workflow-approvals/<workspace-path-hash>/`. Publication is exclusive
and non-replacing. Two clients cannot overwrite one another's decision. The
executor acknowledges a decision before it can become a reusable grant; an
abandoned prompt answered after a crash cannot grant future executions access.
Corrupt records fail closed, never reset the journal. Records may include tool
arguments; treat this local directory as sensitive like permission prompts.

A per-workflow, cross-process lease excludes overlapping executions without a TTL
that could expire during human waiting. Subsequent due cron slots are recorded as
skipped while that workflow remains active; other workflows can proceed (up to
four per poller). Disabling/deleting the schedule or changing/disabling the
workflow cancels its running approval scope. Closing the UI alone does not require
a model retry; terminating its runner cancels work, and historical records remain
visible. Uncertain actions are not replayed after restart.

Desktop IPC uses explicit workspace IDs. Runner protocol 13 exposes list, decide,
revoke and cancel; older runners receive an update-required message. The paired
mobile bridge supports the same commands for its own served workspace only.

Verification includes real disk journals, competing processes, a real file-writing
DAG, actual runner reconnection and an authenticated WebSocket bridge. Windows
NTFS and installed-resource tests run in the installer CI. These checks do not
replace the user-facing cron/modal acceptance runs or security dependency audit.
