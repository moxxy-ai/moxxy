---
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

OpenCode 2 works with the OpenCode agent connection. OpenCode 2 is published on npm as `@opencode/cli` instead of `opencode-ai`, so on Windows Moxxy looked for `node_modules\opencode-ai\bin\opencode.exe` behind the `opencode.cmd` shim, did not find it and showed OpenCode as "installed, but Moxxy could not read its version". Moxxy now runs `node_modules\@opencode\cli\bin\opencode.exe` when it is there and OpenCode 1's program otherwise, checks for updates against `@opencode/cli`, and installs that on Windows. OpenCode 2's `opencode acp` runs a private server with no port and refuses `--port` / `--hostname`, so Moxxy starts it with `acp` alone, as it does when it cannot read the version; its background helpers are not listed yet, since ACP does not report them. OpenCode 1 keeps its HTTP API on the port and password Moxxy picks. `pnpm test:agents:live` reads each agent's version as the connection finds and starts it, so it also runs on Windows with agents installed through npm.
