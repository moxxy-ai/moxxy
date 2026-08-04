# @moxxy/tools-builtin

## 0.1.7

### Patch Changes

- @moxxy/sdk@0.36.1

## 0.1.6

### Patch Changes

- Updated dependencies [bc7844e]
  - @moxxy/sdk@0.36.0

## 0.1.5

### Patch Changes

- @moxxy/sdk@0.35.4

## 0.1.4

### Patch Changes

- @moxxy/sdk@0.35.3

## 0.1.3

### Patch Changes

- @moxxy/sdk@0.35.2

## 0.1.2

### Patch Changes

- @moxxy/sdk@0.35.1

## 0.1.1

### Patch Changes

- Updated dependencies [57f0810]
  - @moxxy/sdk@0.35.0

## 0.1.0

### Minor Changes

- 06e81f8: Add `ToolDef.icon` and `tui.density`.

  **Tool icons.** A surface could only guess a tool's icon from its NAME, via a heuristic that recognised the handful of built-ins it was written against, so every plugin-contributed tool drew the same wrench with no way for its author to say otherwise. Tools now declare `icon`, the session snapshot carries it, and the desktop renders the declared choice with the old heuristic kept as a fallback.

  The vocabulary is closed (`ToolIcon`) rather than a free string: surfaces render wildly differently, and a name no surface owns would fall back everywhere, making the field decorative. A fixed set means each surface maps it exhaustively, and the desktop's map is typed as a total `Record` so adding a member fails to compile instead of silently drawing a wrench. That fired during development, when `copy` was rejected and `clipboard` was added deliberately.

  The desktop reads the map from one `session.info` fetch held in context, because a transcript can hold hundreds of tool rows and a fetching hook per row would mean hundreds of identical IPC calls per screen.

  **Transcript density.** `tui.density: comfortable | compact` sits next to `tui.theme` and `tui.hints`, and is togglable from `/settings`. `compact` drops the blank line between transcript entries, which is what a short split pane needs: on 24 rows, half the screen is otherwise separator. Default is unchanged. All 18 separators across the chat components route through one helper, with a test that fails naming any component that hardcodes one again, since a single stray separator would make compact look half-broken rather than absent.

  Also hardens `useActionCatalog`: `api()` throws synchronously when no transport is configured, which the hook's promise `.catch` could not see. Unguarded that escaped the effect and took down whatever rendered the consumer, so a component that merely enriched its output made a configured transport a hard requirement for rendering. It now degrades to the `loaded: false` state it already models.

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

## 0.0.47

### Patch Changes

- Updated dependencies [b241085]
  - @moxxy/sdk@0.33.0

## 0.0.46

### Patch Changes

- Updated dependencies [3b0c14a]
  - @moxxy/sdk@0.32.0

## 0.0.45

### Patch Changes

- Updated dependencies [8bb26b1]
- Updated dependencies [43926ab]
  - @moxxy/sdk@0.31.0

## 0.0.44

### Patch Changes

- Updated dependencies [c124a15]
  - @moxxy/sdk@0.30.0

## 0.0.43

### Patch Changes

- Updated dependencies [d99087f]
- Updated dependencies [f360bf6]
  - @moxxy/sdk@0.29.0

## 0.0.42

### Patch Changes

- Updated dependencies [6c0af71]
  - @moxxy/sdk@0.28.1

## 0.0.41

### Patch Changes

- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
  - @moxxy/sdk@0.28.0

## 0.0.40

### Patch Changes

- 720c955: Dead-code cleanup: remove the deprecated `resolveSafe` alias from tools-builtin (no callers remained — use `resolvePath`), and retire/re-point stale TECH_DEBT entries (the CDP screencast sidecar handlers were already deleted in #212; the piped-shell fallback and terminal-sizing constraint notes now point at `packages/plugin-terminal` / `TerminalPane.tsx` where that code actually lives).
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

## 0.0.39

### Patch Changes

- Updated dependencies [8c70f3c]
- Updated dependencies [8c70f3c]
- Updated dependencies [ce56ef6]
  - @moxxy/sdk@0.26.0

## 0.0.38

### Patch Changes

- @moxxy/sdk@0.25.0

## 0.0.37

### Patch Changes

- @moxxy/sdk@0.24.1

## 0.0.36

### Patch Changes

- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0

## 0.0.35

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0

## 0.0.34

### Patch Changes

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0

## 0.0.33

### Patch Changes

- @moxxy/sdk@0.21.1

## 0.0.32

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0

## 0.0.31

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0

## 0.0.30

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

- 7366a09: Add a cross-channel file-diff preview for the Write/Edit tools. Every surface
  now shows what changed when the agent writes a file — a classic diff of the
  changed slices (±2 context lines) with line numbers, `+`/`-` markers, and
  green/red line backgrounds, plus a "Added N lines, removed M lines" summary.

  - The tools return a structured, channel-agnostic payload (`ToolDisplayResult`
    = `{ forModel, display }`); the model still sees only a short summary line, so
    the diff never bloats the context window.
  - TUI: an inline highlight preview; `Ctrl+O` expands the changed files.
  - Desktop: a diff card; click to expand the full set of hunks.
  - Web / Telegram / mobile each render the same payload natively.

  New public SDK surface (`@moxxy/sdk` and the dependency-free `@moxxy/sdk/tool-display`
  subpath for browser/React-Native consumers): `FileDiffDisplay`, `DiffHunk`,
  `DiffLine`, `DiffRow`, `ToolDisplay`, `ToolDisplayResult`, and the helpers
  `isToolDisplayResult`, `isFileDiffDisplay`, `fileDiffSummary`, `fileDiffVerb`,
  `diffGutterNo`, `toDiffRows`.

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

- 05d643a: Bash tool hardening: timeout/abort now kill the child's whole process group (detached spawn + negative-pid signal) with SIGTERM → 2s → SIGKILL escalation, so forked children no longer survive as orphans or hang the tool by holding stdio pipes; and child output is bounded during streaming (drain-and-count past the 200k clamp) so runaway commands can't grow the heap unboundedly while keeping the existing truncation marker accurate.
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
