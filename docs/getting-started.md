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

## 2. Connect a model

From the project you want to work in:

```sh
cd your-project
moxxy onboard
```

Choose a model account and sign in or paste an API key. The key is stored in
moxxy's encrypted local vault. Onboarding selects the recommended model,
runtime, and local memory index automatically; you do not need a config file.

## 3. Start working

```sh
moxxy
```

Try a read-only first task:

> Explain how requests move from the entry point to the database in this repo.

Then try a change:

> Add a focused test for the login validation and run it.

Moxxy shows consequential tool calls and asks for approval. Session-scoped
approval avoids repeating the same safe decision during one run.

For a single response in the current shell:

```sh
moxxy -p "summarize the README in three bullets"
```

## Authentication alternatives

### Claude Code subscription

Install the official `claude` CLI and sign in before onboarding:

```sh
claude auth login
moxxy onboard
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

Choose the OpenAI Codex connection during onboarding. Moxxy opens the OAuth
flow; no OpenAI API key is required. You can also sign in separately:

```sh
moxxy login openai-codex
```

### API keys

Anthropic and OpenAI API keys can be entered during onboarding or supplied to
headless `moxxy init` through `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.

## Add capabilities later

Extensions and channels are optional:

```sh
moxxy extensions list
moxxy onboard --advanced
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
