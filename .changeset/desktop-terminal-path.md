---
'@moxxy/desktop': patch
---

On macOS and Linux the desktop reads the PATH the person's terminal has, once at start, and puts it first. Started from Finder or the Dock it used a short system PATH instead, so it could pick an old Homebrew Claude Code over the current one in `~/.local/bin` (and report "Update required" for an up-to-date install), or not find a CLI that only the shell profile points at.
