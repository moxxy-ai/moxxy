# @moxxy/plugin-telegram

## 0.0.10

### Patch Changes

- f3c798f: `/new` now truly resets the session everywhere (audit A10). New `session.reset` runner RPC (protocol v3) + optional `SessionLike.reset()` capability: the runner aborts in-flight turns and clears its authoritative event log; the log's new `EventLog.onClear` listeners broadcast a `session.reset` notification so every attached mirror clears in lockstep (re-arming seq-0 ingest instead of silently rejecting all further events) and truncate the persisted session JSONL so wiped history can't resurrect on `--resume` — fixing the same resurrection bug for local `/new`. The TUI and Telegram `/new` paths call `reset()` (falling back to `log.clear()` when the capability is absent) and report an error instead of claiming "history cleared" when the reset RPC fails.
- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [05d643a]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/core@0.0.10
  - @moxxy/sdk@0.8.0
  - @moxxy/plugin-vault@0.0.10

## 0.0.9

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0
  - @moxxy/core@0.0.9
  - @moxxy/plugin-vault@0.0.9

## 0.0.8

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0
  - @moxxy/core@0.0.8
  - @moxxy/plugin-vault@0.0.8

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1
  - @moxxy/core@0.0.7
  - @moxxy/plugin-vault@0.0.7

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0
  - @moxxy/core@0.0.6
  - @moxxy/plugin-vault@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0
  - @moxxy/core@0.0.5
  - @moxxy/plugin-vault@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0
  - @moxxy/core@0.0.4
  - @moxxy/plugin-vault@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0
  - @moxxy/core@0.0.3
  - @moxxy/plugin-vault@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3
  - @moxxy/core@0.0.2
  - @moxxy/plugin-vault@0.0.2

## 0.0.1

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
  - @moxxy/core@0.0.1
  - @moxxy/plugin-vault@0.0.1
