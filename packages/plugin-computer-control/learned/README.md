# Lessons that ship with Computer Use

One file per app: which element a described target was, which way of acting
worked, what a click made appear, and whole routes that reached their end.
`computer_run` reads these first, then what the user's own computer learned
(`~/.moxxy/computer-use/learned/`), and asks Jev only for what neither has.

The files are written by training, before a release, on a real machine with
the apps installed; do not edit them by hand:

```sh
TYPESAFE_API_KEY=… pnpm --filter @moxxy/plugin-computer-control learned:train            # every app in cases/
TYPESAFE_API_KEY=… pnpm --filter @moxxy/plugin-computer-control learned:train com.apple.finder --passes 3
```

It runs the cases of `cases/<app>.json` on the live apps (keep your hands off
the keyboard and mouse), learns into an empty folder so nothing from everyday
use is shipped, and adds the result here. The second pass shows what the first
one taught: a case that runs from its lessons asks Jev nothing. Read the diff
before committing. To teach a new app, add its `cases/<app>.json`: the app's
identifier and the runs to try, each a goal and `computer_run` steps.

`learned:promote [directory]` adds lessons from a folder instead (by default
everything this computer learned in everyday use, so check what it brings). Elements are matched by their role and title as the system shows them,
so a lesson helps only where the app speaks the same language as the machine
it was learned on (these: macOS in Polish). Elsewhere it is skipped.
