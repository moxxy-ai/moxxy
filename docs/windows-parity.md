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
| `Windows test` | Windows, Node 22 | every PR | the whole test suite passes on **Windows**, except the tests that declare a capability Windows lacks (see "Tests" below) |
| `Windows runtime tests` | Windows, Node 20/22/24 | only when the changed paths match `desktop-package-scope` | **four** suites pass: process invocation (SDK), `moxxy update` (CLI), CLI resolver / runner pool / provider login (desktop-host), plugin install (plugins-admin) |
| `Packaged desktop smoke (windows-2022)` | Windows | same condition | the native helper compiles, the NSIS installer builds, installs and boots, and its resources are complete |

`Windows test` was added on 2026-10-02. Before it, a change outside the
`desktop-package-scope` paths (`runner`, `core`, `tools-builtin`,
`plugin-browser`, a channel, …) started no Windows job at all, and the full
suite had never been green on Windows: run locally it failed in 28 packages.
Most of those were tests that assumed POSIX, but six were faults in the
product that the tests had been reporting all along (the six rows of the
table below from "Collaborative mode could not start" on).

A green `Windows test` still leaves two gaps:

1. **A skipped test proves nothing.** What is skipped on Windows is listed
   under "Tests" below; the code under it has no Windows coverage.
2. **Tests do not install the app.** Only `Packaged desktop smoke` does, and
   it still runs only for the `desktop-package-scope` paths.

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
| Collaborative mode could not start | the coordinator, hub and peer addresses were `.sock` paths in the run directory | `collabCoordinatorSocketPath` / `hubSocketPath` / `peerSocketPath` now go through `platformSocket` |
| An isolation scope of one folder level (`/work/*`) also allowed every nested file, and `dir/**` did not allow `dir` itself | the scope matcher only treated `/` as a separator; normalised Windows paths use the other one | `matchesGlob` in `packages/plugin-security/src/cap-check.ts` |
| `Glob` found nothing for a pattern with a folder in it (`src/**/*.ts`) | the pattern was matched against a path with Windows separators | `packages/tools-builtin/src/glob.ts` |
| The diff of a new, untracked file was empty in the desktop | git was handed the Windows `nul` device; git only reads `/dev/null` as "no file", on every platform | `packages/desktop-host/src/git.ts` |
| `moxxy mobile` could not start or stop the Expo app | `spawn('npm')`, and a `SIGTERM` that never reaches npm's child | `packages/plugin-channel-mobile/src/expo-launcher.ts` |
| Updating extensions failed for anyone with a linked plugin | `fs.cp` recreates a directory link as a symlink, which an ordinary account may not create; a junction needs no privilege | `copyTree` in `packages/desktop-host/src/component-update.ts` |
| Running the tests wrote fixtures into the developer's real `~/.moxxy` and rewrote the vault key | tests moved `HOME`; Windows resolves the home from `USERPROFILE` | `tooling/vitest-preset/isolate.js` |
| A security patch was rejected only on Windows checkouts | the audit hashed a patch file; `core.autocrlf` rewrote its line endings | removed with `650c2640` |
| Disabling a provider (or any other setting) was sometimes not saved | the atomic write renames over `config.yaml`; Windows refuses that with `EPERM` while any reader has the file open, and the caller swallowed the error | `writeFileAtomic` in `packages/sdk/src/fs-utils.ts` retries the rename briefly |
| `Windows test` failed at random, in a different package almost every PR (`core`, `mode-collaborative`, `isolator-subprocess`) | a test removed its temp folder while something still used it: a write the test had not waited for (`ENOTEMPTY`), a child process with the folder as its cwd (`EBUSY`), the virus scanner reading a new file (`EPERM`). Linux removes such a folder; Windows refuses for a moment | every test removes what it made with `removeDir` / `removeDirSync` from `@moxxy/vitest-preset/fs`, and lint rejects a bare recursive `rm` in tests; tests also wait for their own writes and children to end |
| The agent waited with `Sleep` on Windows where it waits with `Wait` everywhere else, and `StopJob` left a stopped dev server running | the `Bash` tool spawned `/bin/sh`, so every command and background job failed with `spawn /bin/sh ENOENT` and the model fell back to the terminal plugin and fixed pauses; its tests were skipped on Windows, so CI stayed green. Stopping a job signalled only the shell, never its children | `Bash` runs Git Bash on Windows, or Windows PowerShell where Git is not installed (`systemShell` in `packages/tools-builtin/src/shell.ts`, and the tool description names the shell); a job is stopped with `taskkill /T /F`. The job and `Bash` tests now run on Windows wherever the shell speaks sh |
| The PowerShell fallback's tests timed out only on the CI runner (over 10 s for `exit 7`) | Windows PowerShell looks a cmdlet (here the launcher's own `Remove-Item`) up through every module on `PSModulePath` before its own, and the runner image has thousands; a module that exports the same name takes the cmdlet over | the launcher in `packages/tools-builtin/src/shell.ts` imports `Microsoft.PowerShell.Management` and `.Utility` from `$PSHOME` first |

Still open, and worth knowing before building on top of them:

- On a Windows machine without Git for Windows, `Bash` runs Windows PowerShell:
  the desktop installer carries MinGit, which has no bash. The model is told
  to write PowerShell there; set `MOXXY_GIT_BASH` to a `bash.exe` to use one
  that is not where the Git installer puts it.
- The `.claude/skills`, `.claude/agents`, `.codex/*` symlinks into `.ai/` check
  out as small text files on Windows (symlinks need extra rights), so skills
  are found only under `.ai/` there.
- `scripts/security-audit.mjs` runs `spawnSync('pnpm', …)`, which cannot find
  `pnpm.cmd`. It works in CI because that job runs on Ubuntu.

## Tests

Every test process starts in a throwaway home: `tooling/vitest-preset/isolate.js`
points `HOME` and `USERPROFILE` at a temp directory, clears `MOXXY_HOME` and
sets `MOXXY_NO_KEYCHAIN=1` so the vault never opens the OS keychain. A test
that needs its own home must move **both** variables
(`process.env.HOME = process.env.USERPROFILE = dir`).

A test that needs something Windows lacks says which thing, with a capability
from `@moxxy/vitest-preset/platform`:

```ts
import { canSymlink, posixFileModes, posixShell } from '@moxxy/vitest-preset/platform';

it.skipIf(!canSymlink)('does not follow a link out of the workspace', …);
```

| Capability | False on Windows because | What is therefore not tested there |
|---|---|---|
| `posixShell` | there is no `/bin/sh`, `echo`, `yes`, `sleep`, and a `#!` script is not a program | `exec` through the isolation brokers (subprocess, worker, wasm, inproc); the Claude Code provider and the TUI voice capture, whose tests run a fake CLI written as a `#!` script. The `Bash` tool and background jobs are tested with `systemShell().kind !== 'powershell'` instead: on Windows they run in Git Bash |
| `posixFileModes` | `chmod` is a no-op and `stat` reports no real mode | that secret files are written `0600`, and the "disk write fails" rollbacks, which use a read-only directory to make the write fail |
| `canSymlink` | creating a symlink needs Developer Mode or an elevated shell | every "a link must not lead out of the workspace" guard. GitHub's Windows runners can create symlinks, so these do run in CI |

A test removes what it made with `removeDir` / `removeDirSync` from
`@moxxy/vitest-preset/fs`, never a bare `rm(dir, { recursive: true })`; lint
rejects that in `*.test.*` and `*.fixture.*` files. Windows refuses to remove
a file or folder while something still has it open or is adding to it, and
the helper waits that out (about 5.5 s). It does not replace waiting for the
test's own work: a write the test started is awaited first (for a session,
`settleWrites()` then `flush()`), a child process is awaited until it exits,
and a child that outlives the test is not started in a folder the test
removes — Windows will not remove a live process's cwd at all.

Prefer a portable fixture over a skip: `process.execPath` instead of `sh`,
`platformSocket` instead of a `.sock` path, `path.join` in the expected
value, a junction (`symlinkSync(target, link, 'junction')`) for a linked
directory. Skip only when the behaviour itself does not exist on Windows.

## The assumptions that cause it

| On macOS you can | On Windows |
|---|---|
| listen on a file path (`/tmp/x.sock`) | only a named pipe, `\\.\pipe\name`; it has no parent directory and is not a file — no `mkdir`, `unlink`, `chmod`, `existsSync` |
| `spawn('npm', args)` | `npm`, `pnpm`, `npx`, `moxxy` are `.cmd` shims; resolve them with `findExecutable` / `spawnExecutableTarget` from `@moxxy/sdk`, never `shell: true` |
| run `/bin/sh -c`, `bash`, `sleep`, `kill`, `chmod`, `ln -s` | none exist; there are no process groups or negative-pid kills, and `SIGTERM` ends the process at once without a handler. `spawnShell` and `killTree` in `packages/tools-builtin/src/shell.ts` show the Windows way: Git Bash or PowerShell, and `taskkill /T /F` for a process tree |
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
4. **Write tests that can run on Windows.** `Windows test` runs every suite, so
   write fixtures with `os.tmpdir()`, `path.join`, a named pipe and
   `process.execPath` instead of `sh`, and declare a capability (see "Tests")
   only for behaviour Windows does not have.
5. **Read the Windows jobs, not only the summary.** `Windows test` must be
   green. `Windows runtime tests` and `Packaged desktop smoke` show as
   *skipped* when the path filter did not match; skipped is not passed.
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
