# Getting started

This guide covers installation and the common paths from a new Moxxy installation to a running agent.

## Requirements

- Node.js 20.10 or newer
- One supported authentication method:
  - an API key for a supported provider
  - ChatGPT OAuth
  - an authenticated Claude Code installation for a Claude Pro or Max subscription

## Install

Install the CLI globally, or run the initializer without installing it:

```sh
npm install -g @moxxy/cli
# Alternatively: npx @moxxy/cli init
```

For a guided setup, run:

```sh
moxxy onboard
```

The onboarding flow configures a provider, optionally connects a messaging channel, pairs your account, and can install a background service. Launch the interactive terminal UI afterward:

```sh
moxxy
```

If you prefer to configure each piece separately, `moxxy init` runs only the provider wizard, `moxxy <channel>` configures one channel, and `moxxy service install serve` installs the combined service.

## Run a one-shot prompt

```sh
moxxy -p "summarize the README in three bullets"
```

Run `moxxy --help` to see all commands and options.

## Use a Claude Code subscription

Install the official `claude` CLI and sign in:

```sh
claude auth login
# Or let moxxy launch sign-in:
moxxy login claude-code
```

Choose `claude-code` during `moxxy init`. Moxxy uses the CLI's existing subscription session and does not require an `ANTHROPIC_API_KEY`.

Check and recover the installation with:

```sh
claude auth status
moxxy doctor
moxxy login claude-code
```

For a custom installation that is not on `PATH`, set the executable explicitly:

```sh
CLAUDE_CODE_EXECUTABLE=/absolute/path/to/claude moxxy doctor
```

The default model is `claude-sonnet-4-6`. Select another model advertised by Moxxy with `--model` or the `plugins.provider.items.claude-code.model` setting.

The provider is text-only by default. Native Claude tools are a separate opt-in setting, `config.mode: native-tools`, and should be paired with explicit `allowedTools` and, when needed, `permissionMode`. The Claude CLI owns and enforces native-tool permissions. Moxxy's `--allow-tools`, permission resolver, and isolators govern only Moxxy tools and do not override the Claude CLI.

Interactive desktop and TUI sessions can launch sign-in. Headless channels and OS services cannot reliably complete browser or TTY authentication. Sign in once as the same OS user before starting the service, make sure that user's `PATH` or `CLAUDE_CODE_EXECUTABLE` reaches `claude`, then restart the service. Claude continues to own its authentication files; Moxxy does not copy them into its vault.

## Keep Moxxy running

Run one channel as its own launchd or systemd user service:

```sh
moxxy service install telegram
moxxy service logs telegram
```

Or run every configured channel, the scheduler, and webhooks in one process with a shared event log:

```sh
moxxy serve --background
moxxy serve --background --except http
moxxy serve --status
```

Service logs are stored in `~/.moxxy/services/<name>.log`. Installed service units survive reboots.

## Update and diagnose

```sh
moxxy update
moxxy doctor
```

The TUI also notifies you when a new version is available.

## Next steps

- Review [features and channels](features.md).
- Configure Moxxy with the [configuration reference](configuration.md).
- Build an integration with the [developer guide](developer-guide.md).
- Harden a deployment with the [security guide](../SECURITY.md).
