# README media

Assets referenced by the top-level `README.md`.

| File to add | README slot | What it should show | Suggested size |
|---|---|---|---|
| `desktop-demo.gif` | "See it in action" → right | The Electron app: workspaces in the sidebar, a chat turn streaming, optionally Settings → Dashboard showing the in-app update. | 1200×675 |

Already present:

- `moxxy-ai-video.mp4` — animated moxxy video presentation used in the README hero.
- `tui-demo.gif` — real recorded TUI session ("See it in action" → left): boot splash → "fix the TODO in src/parse.ts, then verify with npm run check" → Read/Edit/Bash tool blocks → green `tsc` → streamed summary. Recorded with `vhs tui.tape` (see the tape header for the isolation setup it needs).
- `moxxy-mascot.gif` — the moxxy character animation (brand accent in the "Why moxxy?" section). Copied from `apps/desktop/public/new-animation.gif`.

## Capturing the TUI

No screen-capture tooling is committed. The easiest reproducible route is
[`vhs`](https://github.com/charmbracelet/vhs):

```sh
brew install vhs
vhs assets/tui.tape       # writes assets/tui-demo.gif
```

(See `tui.tape` for the script.) Or record any terminal with `asciinema` /
QuickTime and export to GIF.
