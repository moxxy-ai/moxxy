---
'@moxxy/sdk': minor
'@moxxy/core': minor
'@moxxy/config': minor
'@moxxy/cli': minor
'@moxxy/plugin-cli': minor
'@moxxy/tools-builtin': minor
'@moxxy/plugin-browser': patch
'@moxxy/plugin-terminal': patch
'@moxxy/plugin-computer-control': patch
'@moxxy/client-core': patch
---

Add `ToolDef.icon` and `tui.density`.

**Tool icons.** A surface could only guess a tool's icon from its NAME, via a heuristic that recognised the handful of built-ins it was written against, so every plugin-contributed tool drew the same wrench with no way for its author to say otherwise. Tools now declare `icon`, the session snapshot carries it, and the desktop renders the declared choice with the old heuristic kept as a fallback.

The vocabulary is closed (`ToolIcon`) rather than a free string: surfaces render wildly differently, and a name no surface owns would fall back everywhere, making the field decorative. A fixed set means each surface maps it exhaustively, and the desktop's map is typed as a total `Record` so adding a member fails to compile instead of silently drawing a wrench. That fired during development, when `copy` was rejected and `clipboard` was added deliberately.

The desktop reads the map from one `session.info` fetch held in context, because a transcript can hold hundreds of tool rows and a fetching hook per row would mean hundreds of identical IPC calls per screen.

**Transcript density.** `tui.density: comfortable | compact` sits next to `tui.theme` and `tui.hints`, and is togglable from `/settings`. `compact` drops the blank line between transcript entries, which is what a short split pane needs: on 24 rows, half the screen is otherwise separator. Default is unchanged. All 18 separators across the chat components route through one helper, with a test that fails naming any component that hardcodes one again, since a single stray separator would make compact look half-broken rather than absent.

Also hardens `useActionCatalog`: `api()` throws synchronously when no transport is configured, which the hook's promise `.catch` could not see. Unguarded that escaped the effect and took down whatever rendered the consumer, so a component that merely enriched its output made a configured transport a hard requirement for rendering. It now degrades to the `loaded: false` state it already models.
