# Lessons that ship with Computer Use

One file per app: which element a described target was, which way of acting
worked, what a click made appear, and whole routes that reached their end.
`computer_run` reads these first, then what the user's own computer learned
(`~/.moxxy/computer-use/learned/`), and asks Jev only for what neither has.

The files are written by `pnpm --filter @moxxy/plugin-computer-control
learned:promote` after running cases on a real machine; do not edit them by
hand. Elements are matched by their role and title as the system shows them,
so a lesson helps only where the app speaks the same language as the machine
it was learned on (these: macOS in Polish). Elsewhere it is skipped.
