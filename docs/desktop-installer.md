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
| Adding or updating plugins from npm, the in-app "Update CLI" | Node + npm on `PATH` | the computer's own, or downloaded automatically |

A first launch therefore needs no download: the agent, its plugins and offline
voice with its voices are all on disk. A freshly installed Piper becomes the
voice unless the user already chose another one.

### Node

Electron runs the agent, so Node is needed only for `npm` — adding or updating
a plugin. The onboarding checks for it (`onboarding.probeNode`):

- found on `PATH` or in the usual install locations → used as is, no step shown;
- not found → the official Node LTS for the OS/arch is downloaded from
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
| Python | nothing at run time | only `node-gyp` needs it, when building the installer |

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
already in place are reused). `verify:resources` and `verify:packaged` fail the
build when the seed lacks Piper, the Gemini voice or any Piper voice.

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
