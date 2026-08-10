# Getting started

The personal path is deliberately short: install, connect one model account,
open a project, and ask moxxy to work.

## Requirements

- Node.js 20.10 or newer
- one supported authentication method:
  - an API key for a supported provider;
  - ChatGPT OAuth;
  - an authenticated Claude Code installation for Claude Pro or Max.

## 1. Install

```sh
npm install -g @moxxy/cli
```

## 2. Start in a project

From the project you want to work in:

```sh
cd your-project
moxxy
```

On the first start, choose a model account and sign in or paste an API key. The
key is stored in moxxy's encrypted local vault. Moxxy selects the recommended
model and safe local defaults automatically; you do not need a config file.

## 3. Ask for work

Try a read-only first task:

> Explain how requests move from the entry point to the database in this repo.

Then try a change:

> Add a focused test for the login validation and run it.

Safe reads and searches inside the workspace proceed without ceremony. Before
a command, file change, or access beyond the workspace, Moxxy explains the
target and impact. Press Enter to allow once, `A` to allow that exact
consequence for this run, or Esc to deny.

The bottom status line stays focused on what matters: whether Moxxy is working,
the current workspace, special-run state, and whether organization policy is
active. Type `/` for everyday commands, `/runs` to continue earlier work, and
`/extensions` to add optional capabilities. Use `/help advanced` only when you
need runtime or operator controls.

For a single response in the current shell:

```sh
moxxy -p "summarize the README in three bullets"
```

## Authentication alternatives

### Claude Code subscription

Install the official `claude` CLI and sign in before starting Moxxy:

```sh
claude auth login
moxxy
```

Choose the Claude Code connection. Moxxy reuses the subscription session and
does not copy Claude's credentials into its vault. Diagnose it with:

```sh
claude auth status
moxxy doctor
moxxy login claude-code
```

If the executable is not on `PATH`, set
`CLAUDE_CODE_EXECUTABLE=/absolute/path/to/claude`.

### ChatGPT account

Choose the OpenAI Codex connection on first start. Moxxy opens the OAuth
flow; no OpenAI API key is required. You can also sign in separately:

```sh
moxxy login openai-codex
```

### API keys

Anthropic and OpenAI API keys can be entered on first start or supplied through
`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.

## Add capabilities later

Extensions and channels are optional:

```sh
moxxy extensions list
moxxy onboard --advanced
moxxy runs list
```

Advanced onboarding can configure messaging channels, runtime choices, and a
background service. It does not change the personal golden path.

Use `moxxy help advanced` for the full operator command set.

## Update and diagnose

```sh
moxxy update
moxxy doctor --check-keys
```

If setup fails, include the OS, Node version, install command, selected model
connection, failing step, and sanitized output in a
[GitHub issue](https://github.com/moxxy-ai/moxxy/issues).

## Next steps

- Read the [developer alpha contract](developer-alpha.md).
- Browse [features and channels](features.md).
- Add an integration with the [developer guide](developer-guide.md).
- Apply organizational controls with the [deployment guide](deployment.md).
