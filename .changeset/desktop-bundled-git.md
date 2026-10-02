---
'@moxxy/desktop': minor
---

The desktop installer now carries Git, so the agent can clone and commit on a computer that has none — a clean Windows, or a Mac where `git` only offers to install the developer tools. It is unpacked to `~/.moxxy/runtimes/git` on first launch, with no download. A Git you installed yourself keeps being the one Moxxy uses.
