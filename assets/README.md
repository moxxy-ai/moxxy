# README media

Assets referenced by the top-level `README.md`.

| File to add | README slot | What it should show | Suggested size |
|---|---|---|---|
| `hero-demo.gif` | top hero (under the nav) | ~20–30s loop: `moxxy init` → ask a question in the TUI → the agent runs a tool (edit a file / run a command) → streamed answer. The "wow, it just works" clip. | 1280×640 |
| `tui-demo.gif` | "See it in action" → left | The Ink TUI: boot splash → type a prompt → streamed reply with a tool block expanding → bottom status line (provider · model · context bar · version). | 1200×675 |
| `desktop-demo.gif` | "See it in action" → right | The Electron app: workspaces in the sidebar, a chat turn streaming, optionally Settings → Dashboard showing the in-app update. | 1200×675 |

Already present:

- `moxxy-ai-video.mp4` — animated moxxy video presentation used in the README hero.
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
