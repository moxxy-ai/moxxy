---
"@moxxy/desktop": patch
---

Desktop terminal surface: fix the prompt rendering one character per line (and
being hard to type into). The earlier fix guarded xterm's `fit()` but left the
context rail's width *animation* in place, so `fit()` still measured a mid-slide
sliver and pushed ~2 columns to the PTY as its first size — the shell drew its
prompt hard-wrapped to that width, and since xterm only reflows its own
soft-wraps (not shell-hard-wrapped output) it stayed stacked even after the pane
was full width. Drop the rail's width transition so the pane is at its real width
the instant it mounts (the first fit — and the PTY's first resize — is therefore
correct), keep the rAF-debounced, width-guarded fit for later user resizes, and
focus the terminal on attach. Verified in a headless-chromium harness: the
prompt's draw width goes from ~10 cols (animated) to the full 53 (snap-open).
