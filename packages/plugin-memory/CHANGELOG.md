# @moxxy/plugin-memory

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

- cf2f651: Performance pack from the 2026-06-09 audit (A39–A42 + A42b): the TUI context meter caches its token estimate per log and folds in only new events instead of re-walking the entire event log (incl. JSON.stringify of every tool result) on every ~30Hz render; the desktop NDJSON chat log keeps a size/mtime-guarded line-offset index so scroll-up pages seek-read only their own byte range instead of re-reading and re-parsing the whole file per page; MemoryStore maintains its MEMORY.md index incrementally (no more O(N) re-read of every memory file per write) and gains a warn-only `maxMemories` soft cap (default 500 — no eviction, memories are user knowledge); goal mode declares its idle nudge as a volatile tail message and the stable-prefix cache strategy places its rolling tail breakpoint before volatile messages, so idle goal iterations re-read the cached prefix instead of paying a guaranteed-wasted cache write; and compactor-summarize now produces a real summary via the session's own provider/model (new optional `provider`/`model` on `CompactContext`), falls back to an honest, clearly-labeled head+tail digest when no provider is reachable, and reports `tokensSaved` from real character deltas instead of the fabricated `slice.length * 30`.
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
