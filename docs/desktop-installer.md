# Desktop installer — what it carries and what it fetches

The desktop installer (`.dmg` on macOS, `-setup.exe` on Windows) is the way a
person who has never heard of Node installs moxxy. This page is the inventory
of what moxxy needs to run and where each piece comes from.

## What moxxy needs, and where it comes from

| Needed for | Piece | Source |
|---|---|---|
| Running the app and the agent | Electron (carries its own Node runtime) | in the installer |
| The agent itself | `@moxxy/cli` with its dependencies (`resources/moxxy-cli`) | in the installer |
| Providers, modes, memory, browser, terminal, channels, Computer Use | first-party plugins (`resources/plugins-seed`), copied to `~/.moxxy/plugins` on first launch | in the installer |
| Computer Use | the native helper for the platform (`moxxy-computer`) | in the installer, inside the plugin seed |
| Offline voice (Piper) | `@moxxy/plugin-tts-local` with `sherpa-onnx` native libraries | in the installer, inside the plugin seed |
| Offline voice (Piper) | every voice the plugin offers (`resources/models-seed/tts`), copied to `~/.moxxy/models/tts` on first launch | in the installer |
| Gemini voice | `@moxxy/plugin-tts-gemini` (needs only the user's Google API key) | in the installer, inside the plugin seed |
| Adding or updating plugins from npm, the in-app "Update CLI", `npx` MCP servers | Node + npm (`resources/runtimes-seed`), unpacked to `~/.moxxy/runtimes/node` on first launch | in the installer |
| Scripts the agent writes and runs (data, charts, documents, web pages) | Python + pip with a set of common packages (`resources/runtimes-seed`), unpacked to `~/.moxxy/runtimes/python` on first launch | in the installer |

A first launch therefore needs no download: the agent, its plugins, offline
voice with its voices, Node and Python are all on disk. A freshly installed
Piper becomes the voice unless the user already chose another one.

### Node and Python for the agent

A person asks the agent for something and the agent runs a script for it, so
the tools a script needs cannot be left to the computer. The installer carries:

- **Node** — the official build pinned in `apps/desktop/scripts/runtimes-catalog.mjs`
  (the archive from nodejs.org, byte for byte), with `npm` and `npx`.
- **Python** — the relocatable build of `astral-sh/python-build-standalone`,
  with `pip` and the packages pinned in
  `apps/desktop/runtimes/python-requirements.txt`: requests, numpy, pandas,
  matplotlib, openpyxl, python-docx, pypdf, pillow, beautifulsoup4, lxml,
  pyyaml. Anything else the agent installs with `pip`, which needs a network.

Both are checked against a sha256 when the installer is built. A macOS
installer is universal, so it carries each for arm64 and x64 and the app
unpacks the one for the computer. They are unpacked outside the app because
`pip install` writes into the Python folder; `.runtime.ok` records which
archive a folder came from, so a later launch leaves it (and what was installed
into it) alone, and a newer installer replaces it.

`PATH` for everything the app starts:

- **Python first.** A clean Windows and a clean macOS both answer `python` /
  `python3` with a stub that offers to install it, which would shadow the
  bundled one. The `Bash` tool starts a login shell, whose system profile on
  macOS rebuilds `PATH` with `/usr/bin` in front; the host names its folders in
  `MOXXY_PATH_FIRST` and the tool puts them back first. On Windows `pip` and
  `pip3` are `.cmd` shims and `python3.exe` is a copy of `python.exe`.
- **Node last.** A Node the user installed themselves keeps winning; the
  bundled one serves a computer without any.

`moxxy` installed from npm and run in a terminal does not get these runtimes;
they belong to the desktop app.

### Node at onboarding

Electron runs the agent, so Node is needed for `npm` — adding or updating
a plugin — and for what the agent starts. The onboarding checks for it
(`onboarding.probeNode`) once the bundled runtimes are unpacked, so with a
complete installer the step never shows:

- found on `PATH` (the user's own, or the bundled one) → used as is, no step shown;
- not found (a development build, or unpacking failed) → the official Node LTS for the OS/arch is downloaded from
  `nodejs.org`, checked against the release's `SHASUMS256.txt`, and unpacked
  into the app's data directory. It starts by itself; the step shows progress
  and never names the runtime. No admin rights, nothing added to the system.

A failed download (offline computer) shows a retry.

### Not carried — opt-in or CLI-only

| Piece | Used by | Why it is not in the installer |
|---|---|---|
| `ffmpeg` | microphone capture in the terminal UI; decoding compressed audio in `@moxxy/plugin-stt-local` | the desktop records through the app itself and its default transcriber takes the audio as is |
| Playwright + its browser | `browser_session` when moxxy runs as a CLI | the desktop drives its own built-in browser pane |
| `@moxxy/plugin-stt-local` and its models | optional offline transcription | installed on demand |
| Apps from the in-app catalog (e.g. the Anonymizer model) | each app | installed when the user adds the app |
| `signal-cli` | the Signal channel | third-party program with its own installer |

## Building the installers

```sh
pnpm install
pnpm build
packages/plugin-computer-control/native/macos/build.sh   # macOS only
pnpm --filter @moxxy/desktop run package                  # → apps/desktop/release/
```

`package` runs `prepare:resources` first: it deploys the CLI, assembles the
plugin seed (`bundle-plugins-seed.mjs`) and fetches the voices
(`bundle-models-seed.mjs`, sha256-pinned by the plugin's own catalog; voices
already in place are reused) and the runtimes (`bundle-runtimes-seed.mjs`;
on an Apple Silicon Mac the x64 Python is prepared under Rosetta). `verify:resources` and `verify:packaged` fail the
build when the seed lacks Piper, the Gemini voice, any Piper voice, or Node or
Python for an architecture the installer serves. `scripts/smoke-runtimes.mjs`
unpacks the runtimes as a first launch does and runs them.

The Windows installer is built on Windows (CI: the `Packaged desktop smoke`
job uploads it as `moxxy-windows-test-installer`), because the Windows Computer
Use helper and the Windows native modules are compiled there.

## Installing over an existing install

Installing a new version replaces the application only. Everything the user
owns stays where it is, under `~/.moxxy` (`%USERPROFILE%\.moxxy` on Windows):
chats and sessions, `config.yaml`, the vault, memory, skills, workflows.

Plugins already in `~/.moxxy/plugins` are **kept, not replaced** — first launch
copies only what is missing. Two connections (OpenAI API, ChatGPT sign-in) and,
on Windows, Computer Use are updated from the installer, with a backup. To move
every other plugin to the versions the installer carries:

1. Quit moxxy completely (also from the tray / menu bar).
2. Rename `~/.moxxy/plugins` to `~/.moxxy/plugins.before-update`.
3. Install the new version and start it. The first launch fills
   `~/.moxxy/plugins` from the installer.
4. Plugins the user had added by hand are listed in
   `plugins.before-update/package.json`; reinstall those from Settings.

Voices already downloaded to `~/.moxxy/models/tts` are recognised and left alone.
