---
'@moxxy/desktop': patch
---

Report why a Local Piper install actually failed. The installer spawned the CLI with `stdio: 'ignore'` and then reported every non-zero exit as "The offline voice package could not be installed. Check your internet connection and try again." — a hardcoded guess. On a machine without Node the real output is `error: spawn npm ENOENT`, so a user with working internet was told to check their connection and had no way to discover the actual requirement. The CLI's stderr is now captured and classified into actionable causes (npm/Node missing, registry unreachable, permissions), unrecognised output is quoted rather than re-diagnosed, and the failing step is named.
