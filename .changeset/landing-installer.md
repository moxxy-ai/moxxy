---
---

Landing `install.sh` (repo root, served from the site): installs a Node
runtime if needed (no sudo), the moxxy CLI into ~/.moxxy/cli, preloads the
full first-party plugin set pinned to the CLI version (per-package
404→latest→skip resilience), and wires PATH — the only step left for the
user is picking a provider on first `moxxy`. No package release.
