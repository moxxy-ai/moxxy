---
'@moxxy/cli': patch
---

Load commands on dispatch: `moxxy --version` goes from 301 ms to 83 ms.

`bin.ts` statically imported all 24 command modules plus the session bootstrap, so any invocation evaluated the module graph of the entire program. A `--cpu-prof` run confirmed `react/index.js` really did execute just to print a version string, because the TUI channel is reachable from that graph.

Commands are now dispatched through lazy loaders, so a command pays only for itself. The boot art and tagline moved to a new `@moxxy/plugin-cli/logo-data` subpath, which is a pure data module, so `--help` no longer reaches the Ink runtime either. A test walks the eager import graph from `bin.ts` and fails if the TUI runtime or the session bootstrap becomes statically reachable again.

The binary grows by about 90 KB (3.94 to 4.03 MB) from esbuild's lazy-initialiser wrappers. That is the trade: a slightly larger artifact for a startup that no longer scales with the number of commands.
