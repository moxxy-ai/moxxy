# Windows parity — for whoever builds features on macOS

Most features are written and tried on macOS. Windows is checked only by CI and
by people who install the result. This page records what has already broken on
Windows after working on macOS, why CI did not always catch it, and what to do
before a change is called done.

The short version is in the `windows-parity` skill (`.ai/skills/windows-parity`).

## What CI does and does not prove

| Job | Runs on | When | What it proves |
|---|---|---|---|
| `Build + test` | Ubuntu, Node 20/22/24 | every PR | the whole test suite passes on **Linux** |
| `Windows runtime tests` | Windows, Node 20/22/24 | only when the changed paths match `desktop-package-scope` | **four** suites pass: process invocation (SDK), `moxxy update` (CLI), CLI resolver / runner pool / provider login (desktop-host), plugin install (plugins-admin) |
| `Packaged desktop smoke (windows-2022)` | Windows | same condition | the native helper compiles, the NSIS installer builds, installs and boots, and its resources are complete |

Two consequences:

1. **A green PR does not mean the change was exercised on Windows.** The scope
   filter in `.github/workflows/ci.yml` covers `apps/desktop/`, `packages/cli`,
   `sdk`, `desktop-host`, `desktop-ipc-contract`, `plugin-oauth`,
   `plugin-provider-openai-codex`, `plugin-plugins-admin`, `scripts/desktop-*`
   and the lockfile. A change confined to any other package (`runner`, `core`,
   `tools-builtin`, `plugin-browser`, a channel, …) starts **no Windows job**.
2. **The full suite has never been green on Windows.** Run locally on Windows
   10 on 2026-10-02 it failed in 28 packages, almost all in tests that assume
   POSIX (see the table below). Those tests are not run on Windows in CI, so
   they say nothing about whether the code under them works there.

## What has broken on Windows

Each row is a real fault, with the commit that fixed it.

| Fault | What macOS hid | Fix |
|---|---|---|
| The browser tools fell back to Playwright and failed on a fresh install | the browser bridge listened on a filesystem socket path; Windows can only listen on a named pipe | `30ed44d7` |
| `moxxy serve` exited and the desktop reported "lost the runner" | a `.sock` path used as the runner address | `platformSocket()` in `packages/runner/src/socket-path.ts` |
| A new integration test failed the first Windows gate | the fixture hard-coded a POSIX socket path | `ad53c188` |
| The installed app could not run `npm` / `moxxy` | `npm` and `moxxy` are `.cmd` shims on Windows; `spawn('npm')` without a shell does not find them, and `shell: true` is unsafe | `1d983d9d`, `packages/sdk/src/process-invocation.ts` |
| The installer shipped an incomplete CLI and plugin seed | the embedded CLI and seeded plugin dependency trees were not packaged intact | `1d983d9d` |
| Computer Use could not start from a fresh install | `pnpm pack` drops the executable bit; nothing checked that the helper could run | `30ed44d7` |
| The Windows installer smoke test timed out | the full installer takes longer to unpack than the test allowed | `4c733f4a` |
| Local Piper setup needed Git | the install path assumed Git is present | `1d983d9d` |
| The live view showed nothing for a window that stood still | the preview waited for a change that a still window never produces | `569750ec`, `2ee03cd5` |
| A security patch was rejected only on Windows checkouts | the audit hashed a patch file; `core.autocrlf` rewrote its line endings | removed with `650c2640` |

Still open, and worth knowing before building on top of them:

- The `Bash` tool and its background jobs spawn `/bin/sh` and are POSIX-only
  (`packages/tools-builtin/src/shell.ts`). On Windows a job reports
  `failed to start: spawn /bin/sh ENOENT`. The desktop uses the terminal plugin
  instead; a feature that depends on `Bash` does not work on Windows.
- The `.claude/skills`, `.claude/agents`, `.codex/*` symlinks into `.ai/` check
  out as small text files on Windows (symlinks need extra rights), so skills
  are found only under `.ai/` there.
- `scripts/security-audit.mjs` runs `spawnSync('pnpm', …)`, which cannot find
  `pnpm.cmd`. It works in CI because that job runs on Ubuntu.

## The assumptions that cause it

| On macOS you can | On Windows |
|---|---|
| listen on a file path (`/tmp/x.sock`) | only a named pipe, `\\.\pipe\name`; it has no parent directory and is not a file — no `mkdir`, `unlink`, `chmod`, `existsSync` |
| `spawn('npm', args)` | `npm`, `pnpm`, `npx`, `moxxy` are `.cmd` shims; resolve them with `findExecutable` / `spawnExecutableTarget` from `@moxxy/sdk`, never `shell: true` |
| run `/bin/sh -c`, `bash`, `sleep`, `kill`, `chmod`, `ln -s` | none exist; there are no process groups or negative-pid kills, and `SIGTERM` ends the process at once without a handler |
| rely on `0600` / `0700` and the executable bit | mode bits are ignored; `chmod` is a no-op, so a test asserting a mode fails and a check relying on one protects nothing |
| create a symlink | needs administrator rights or Developer Mode (`EPERM`) |
| build a path with `/` and compare strings | separators are `\`; use `node:path`, and normalise before comparing or showing a path |
| assume `HOME`, `~`, `/tmp` | use `os.homedir()` and `os.tmpdir()`; `HOME` may be unset |
| delete or rename a file that is open | fails with `EBUSY` / `EPERM` while any handle is open, including the app's own running `.exe` |
| treat file names as case-sensitive | they are not; and `CON`, `NUL`, `AUX` or a trailing dot are invalid names |
| read a text file and get `\n` | a checkout may hold `\r\n`; never hash or byte-compare a checked-in text file |
| ship a native binary built on your machine | the Windows helper and native modules must be compiled on Windows (x64 only) |

## What to do before calling a change done

You cannot run Windows. These steps are the substitute, in order of value.

1. **Ask whether the change touches the operating system.** Processes, sockets
   or pipes, file paths, permissions, symlinks, signals, the shell, native
   binaries, packaging. If it does not, stop here.
2. **Use the helpers that already hold the Windows branch** instead of writing
   a new `if (process.platform === 'win32')`:
   - `findExecutable`, `resolveExecutableTarget`, `spawnExecutableTarget`,
     `execExecutableTargetSync` (`@moxxy/sdk`) for every child process;
   - `platformSocket` and the named-pipe check (`packages/runner/src/socket-path.ts`)
     for every local endpoint;
   - `moxxyHome` / `moxxyPath` and `writeFileAtomic` (`@moxxy/sdk`) for state.
3. **Make the platform an argument, then test both values on macOS.** The
   helpers above take `platform` (default `process.platform`), so a test can
   call `platformSocket('x', '/tmp/x.sock', 'win32')` and assert the Windows
   result on any machine. Give new platform-dependent code the same seam and
   write the `win32` case next to the `darwin` one. This is the only Windows
   check that runs on your own machine.
4. **Make sure a Windows job will actually run.** If the change is outside the
   `desktop-package-scope` paths, add its package to that filter and its suite
   to `Windows runtime tests` in `.github/workflows/ci.yml`. A suite listed
   there must pass on Windows — write its fixtures with `os.tmpdir()`,
   `path.join`, a named pipe and `process.execPath` instead of `sh`.
5. **Read the Windows jobs, not only the summary.** `Windows runtime tests`
   and `Packaged desktop smoke` show as *skipped* when the filter did not
   match; skipped is not passed.
6. **For anything that changes the installed app, try the installer.** The
   `Packaged desktop smoke (windows-2022)` job uploads
   `moxxy-windows-test-installer`. Ask a person with Windows to install it and
   exercise the feature, and say in the PR what was and was not tried there.
7. **Say what you could not verify.** A PR description that states "not run on
   Windows; covered by `win32`-parameterised tests X and Y" is accurate. One
   that says "works" after a macOS run is not.

## Building the installer on a Windows machine

Mirrors the CI job. Needs Node 22, pnpm 10.30.0 (`corepack pnpm`), Python (for
`node-gyp`) and Visual Studio Build Tools with the C++ workload and CMake.

```sh
pnpm install --frozen-lockfile
cp apps/desktop/.env.example apps/desktop/.env      # before the build: the key is inlined
packages/plugin-computer-control/native/Build-Windows.ps1
pnpm build
pnpm --filter @moxxy/desktop run prepare:resources
pnpm --filter @moxxy/desktop exec electron-builder --dir --publish never
pnpm --filter @moxxy/desktop run verify:packaged
pnpm --filter @moxxy/desktop exec electron-builder --win nsis --publish never   # → apps/desktop/release/*-setup.exe
```

`cmake` ships with Visual Studio but is not on `PATH`; add
`<VS>\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin` first. See
[desktop-installer.md](desktop-installer.md) for what the installer carries and
how it updates an existing install.
