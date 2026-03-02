# Hello World Agent

This walkthrough creates your first Moxxy agent from scratch using the CLI interactive wizards.

## Prerequisites

- Moxxy CLI installed (`moxxy doctor` should pass)
- An LLM API key (Anthropic, OpenAI, or any supported provider)

## Step 1: Run the Setup Wizard

```bash
moxxy init
```

The init wizard will:

1. Check if the gateway is running, and offer to start it
2. Create a bootstrap API token with all required scopes
3. Save the token to your environment configuration

After init completes, you should see output like:

```
  Gateway running at http://localhost:3000
  Token created: mox_a1b2...
  Saved to ~/.moxxy/config
```

## Step 2: Install a Provider

```bash
moxxy provider install
```

The wizard presents available providers:

```
? Select a provider
  > Anthropic    (Claude Sonnet 5, Opus 4, Sonnet 4, Haiku 4)
    OpenAI       (GPT-5.2, GPT-4.1, o3, o4-mini)
    xAI          (Grok 4, Grok 3)
    Google       (Gemini 3.1 Pro, 2.5 Pro/Flash)
    DeepSeek     (V4, R1, V3)
    Custom       (any OpenAI-compatible endpoint)
```

Select your provider and enter the API key when prompted. The key is stored securely in your OS keychain.

## Step 3: Create an Agent

```bash
moxxy agent create
```

The wizard asks for:

- **Provider**: Select from installed providers
- **Model**: Choose a model from the provider's catalog
- **Workspace**: The directory the agent can read/write (default: current directory)

Example output:

```
  Agent created
  ID: 019cac12-abcd-7000-8000-123456789abc
  Provider: anthropic
  Model: claude-sonnet-4-20250514
  Workspace: /home/user/my-project
  Status: idle
```

## Step 4: Send a Task via the TUI

Launch the full-screen chat interface:

```bash
moxxy tui
```

This opens a split-pane interface:

```
+------------------------------------+---------------------+
|  Chat                              |  Agent Info         |
|                                    |                     |
|  > You: _                          |  ID: 019cac...      |
|                                    |  Provider: anthropic|
|                                    |  Model: claude-4    |
|                                    |  Status: idle       |
|                                    |                     |
+------------------------------------+---------------------+
|  > Type a task...                             Ctrl+C     |
+----------------------------------------------------------+
```

Type your first task:

```
> List all files in the workspace and describe what each one does
```

The agent will use its primitives (like `fs.list` and `fs.read`) to explore the workspace and respond. You will see events flowing in real time on the right panel.

## Step 5: Try a Simple Task via CLI

You can also run tasks non-interactively:

```bash
moxxy agent run --id <agent-id> --task "Create a file called hello.txt with the text 'Hello from Moxxy'"
```

Watch the events:

```bash
moxxy events tail --agent <agent-id>
```

You should see events like:

```
[run.started]          Run began
[primitive.invoked]    fs.write {"path": "hello.txt", ...}
[primitive.completed]  fs.write
[message.final]        "I've created hello.txt with the greeting."
[run.completed]        Run finished
```

Check the result:

```bash
cat ~/my-project/hello.txt
# Hello from Moxxy
```

## Step 6: Stop the Agent

When you are done:

```bash
# Stop a running agent
moxxy agent stop --id <agent-id>

# Or from the TUI, use the slash command:
/stop

# Shut down the gateway
moxxy gateway stop
```

## What Happened Under the Hood

1. The CLI sent a `POST /v1/agents/{id}/runs` request to the gateway
2. The gateway authenticated your token and started a `RunExecutor`
3. The executor sent the task to the configured LLM provider
4. The LLM responded with tool calls (primitives to invoke)
5. The runtime executed each primitive through the `PrimitiveRegistry`, checking the allowlist
6. The `PathPolicy` validated that file operations stayed within the workspace
7. The `EventBus` broadcast events to all subscribers (SSE stream, audit persistence)
8. The `RedactionEngine` scrubbed any secret values from event payloads before storage

## Next Steps

- [Install a skill](../api/skills.md) to give your agent specific capabilities
- [Set up a heartbeat](../api/heartbeats.md) for scheduled tasks
- [Configure vault secrets](../security/vault.md) for API keys and credentials
- [Explore all primitives](../primitives/overview.md) available to agents
