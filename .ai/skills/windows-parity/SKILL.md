---
name: windows-parity
description: Keep a change working on Windows when you can only run macOS/Linux — use whenever a change touches processes, sockets, file paths, permissions, symlinks, signals, the shell, native binaries or desktop packaging.
---

# Windows parity

`Windows test` runs the whole suite on Windows for every PR, but nobody on
macOS can run it before pushing, and the installer smoke starts only when the
changed paths match `desktop-package-scope` in `.github/workflows/ci.yml`.
History and the full table: `docs/windows-parity.md`.

Checklist:

1. Does the change touch the OS (child process, socket/pipe, path, mode bits,
   symlink, signal, shell, native binary, packaging)? If not, done.
2. Child processes: `findExecutable` / `spawnExecutableTarget` /
   `execExecutableTargetSync` from `@moxxy/sdk`. `npm`, `pnpm`, `npx`, `moxxy`
   are `.cmd` shims on Windows — bare `spawn('npm')` fails, `shell: true` is
   not allowed.
3. Local endpoints: `platformSocket` (`packages/runner/src/socket-path.ts`). A
   `.sock` path cannot be listened on; a named pipe is not a file — skip
   `mkdir` / `unlink` / `chmod` / `existsSync` on it.
4. Paths: `node:path`, `os.homedir()`, `os.tmpdir()`, `moxxyHome()`. Never
   concatenate with `/`, never assume `HOME` or `/tmp`.
5. No `/bin/sh`, `bash`, `sleep`, `kill`, `chmod`, `ln -s` in product code or
   in a test that must run on Windows; use `process.execPath` scripts.
6. Do not rely on mode bits, the executable bit, symlinks (need admin), or
   deleting/renaming an open file. Do not hash or byte-compare a checked-in
   text file (`core.autocrlf` rewrites line endings).
7. Take `platform` as an argument (default `process.platform`) and test the
   `'win32'` value next to the `'darwin'` one — it runs on any machine.
8. Tests: a test that needs its own home moves `HOME` and `USERPROFILE`
   together. One that needs a POSIX shell, real mode bits or symlinks says so
   with `it.skipIf(!posixShell | !posixFileModes | !canSymlink)` from
   `@moxxy/vitest-preset/platform` — and prefer a portable fixture to a skip.
9. Read the Windows jobs: `Windows test` must be green; *skipped* is not
   *passed*. For installed-app changes have someone install the
   `moxxy-windows-test-installer` artifact.
10. In the PR, state what was not run on Windows and which tests stand in.

Known POSIX-only today: the `Bash` tool and its background jobs
(`packages/tools-builtin/src/shell.ts` spawns `/bin/sh`).
