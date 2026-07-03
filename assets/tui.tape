# VHS tape for the moxxy TUI demo GIF.
#   brew install vhs   &&   cd assets && vhs tui.tape
# Produces tui-demo.gif. Tweak the prompt/timings to taste.
# Docs: https://github.com/charmbracelet/vhs
#
# Hard-won recording notes (vhs 0.11.0):
# - Do NOT use `Wait+Screen /regex/` — it reads an empty screen buffer while the
#   Ink TUI owns the alt screen and times out. Use fixed `Sleep`s instead.
# - Record against an ISOLATED moxxy home + runner socket, or the TUI will
#   attach to any already-running `moxxy serve`/desktop runner (its session,
#   its cwd) instead of self-hosting in your demo directory:
#     MOXXY_HOME=<clone of ~/.moxxy: config.yaml, vault.json, vault.key,
#                 permissions.json with Read/Glob/Grep/Edit/Bash allowed>
#     MOXXY_RUNNER_SOCKET=/tmp/moxxy-demo.sock   (rm -f it first — a stale
#                 socket file makes the next boot hang trying to attach)
#     MOXXY_SESSION_ID=<fresh id per take>       (or the take resumes history)
# - Pre-allow the tools the demo will use (permissions.json in the cloned
#   home), or the take stalls on a permission prompt — unless showing the
#   permission dialog IS the point of the clip.
# - Run in a small real project (a few TS files + a TODO) so the agent has
#   something meaty to do; `git checkout -- .` in the demo dir between takes.
# - Output paths must be RELATIVE — the tape parser chokes on some absolute paths.

Output tui-demo.gif

Set Shell zsh
Set FontSize 15
Set Width 1280
Set Height 640
Set Padding 12
Set TypingSpeed 35ms
Set PlaybackSpeed 2

Hide
Type "cd ~/pulse && git checkout -- . && rm -f /tmp/moxxy-demo.sock && export MOXXY_HOME=/tmp/moxxy-demo-home MOXXY_RUNNER_SOCKET=/tmp/moxxy-demo.sock MOXXY_SESSION_ID=demo-take-1 && clear"
Enter
Sleep 2s
Show

Type "moxxy"
Sleep 500ms
Enter
# self-host boot + splash
Sleep 8s

Type "fix the TODO in src/parse.ts, then verify with npm run check"
Sleep 800ms
Enter

# the agentic turn: read -> edit -> npm run check -> streamed summary
Sleep 15s
Sleep 40s
Sleep 35s

Type "/exit"
Sleep 500ms
Enter
Sleep 2s
