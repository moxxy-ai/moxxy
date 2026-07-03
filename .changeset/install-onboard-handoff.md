---
---

install.sh now ends by handing off to `moxxy onboard` when a terminal is attached (stdin re-attached from /dev/tty under `curl | bash`; skipped for CI/piped installs or with MOXXY_NO_ONBOARD=1). Website asset only — no package release.
