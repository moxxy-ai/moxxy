# @moxxy/plugin-webhooks

## 0.0.10

### Patch Changes

- 2e4bc37: Security (audit A4): webhook fires now actually enforce the trigger's `allowedTools`.
  The CLI webhook runner runs each fire against a per-fire scoped view of the active
  session — a filtered tool registry (the model only sees the listed tools) plus a
  wrapping permission resolver whose `check` and prompt-free `policyCheck` deny any tool
  outside the list (so the restriction survives goal-mode auto-approve), delegating
  allowed calls to the session's normal resolver chain. An empty `allowedTools` keeps the
  existing full-tool-set contract; the `webhook_create` description and setup guide now
  state exactly what is enforced and that fires run on the active session, not an
  isolated one.
- 05d643a: Harden the webhook trigger store and keep generated secrets out of model context.

  - Fail-safe `webhooks.json` load: a corrupt or schema-mismatched file is preserved aside
    as `webhooks.json.corrupt-<timestamp>` before the store starts empty (so a subsequent
    write can never clobber the only copy of the triggers and their secrets); other read
    errors refuse all reads/writes; individually invalid entries are quarantined to a 0600
    sidecar while valid triggers are kept. The condition is logged and surfaced as
    `storeWarning` in `webhook_list`/`webhook_create`/`webhook_status`.
  - `webhook_create` no longer returns generated secrets through the model's context (tool
    results persist in session logs): the result carries `generatedSecret` with a masked
    preview plus the path of an owner-only (0600) file under `~/.moxxy/webhooks-secrets/`
    that the user reads directly; `webhook_delete` cleans the file up.

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
