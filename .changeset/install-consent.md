---
'@moxxy/cli': minor
'@moxxy/sdk': minor
'@moxxy/plugin-security': minor
'@moxxy/plugin-plugins-admin': minor
'@moxxy/plugin-cli': minor
'@moxxy/config': patch
---

Install-time capability consent + third-party requireDeclaration ratchet.
Installing a plugin now surfaces the package's combined capability surface
(fs globs, net mode/hosts, env, exec commands, time/memory budgets) in
human-readable rows shared across every surface. Third-party packages
(outside the `@moxxy/` scope) require explicit consent to stay enabled:
the TUI opens a fail-closed post-install picker (ESC = decline = disabled),
`moxxy plugins install` asks a default-NO confirm on a TTY and headless runs
need `--yes` (otherwise the package is left installed but disabled), and the
permission-gated `install_plugin` model tool keeps returning the report
non-interactively. Undeclared tools are called out loudly — their surface is
unknown, not empty. New `security.thirdPartyRequireDeclaration: off|warn|enforce`
('warn' by default while security is enabled) logs a once-per-tool structured
warning — or denies with 'enforce' — when a third-party tool has no isolation
declaration; unattributed tools (e.g. runtime-attached MCP tools) are exempt.
`moxxy security status` prints the new mode.
