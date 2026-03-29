# TUI

The Moxxy TUI (Terminal User Interface) provides a full-screen chat interface for interacting with agents. Built with Ink (React for CLIs), it features a split-pane layout with real-time event streaming.

## Launching

```bash
moxxy tui                      # Auto-select agent or pick from list
moxxy tui --agent <agent-id>   # Use a specific agent
moxxy chat --agent <agent-id>  # Alias for tui
```

If no agent is specified and multiple agents exist, the TUI presents a selection prompt.

## Layout

```
+------------------------------------+---------------------+
|  Chat                              |  Agent Info         |
|                                    |                     |
|  > You: Refactor the auth module   |  ID: 019cac...      |
|                                    |  Provider: anthropic|
|  Assistant: I'll analyze the       |  Model: claude-4    |
|  authentication module and...      |  Status: running    |
|                                    |                     |
|  [primitive.invoked] fs.read       |  -- Usage --        |
|  [primitive.completed] fs.read     |  Tokens: 12,450    |
|                                    |  Events: 34         |
|  Assistant: I've identified        |                     |
|  several areas for improvement...  |  -- Activity --     |
|                                    |  fs.read  ### 12    |
|                                    |  fs.write ##  8     |
+------------------------------------+---------------------+
|  > Type a task...                             Ctrl+C     |
+----------------------------------------------------------+
```

### Panels

- **Chat panel** (left): Shows the conversation with the agent, including user messages, assistant responses, and inline event notifications. Assistant responses are rendered as formatted Markdown.
- **Agent info panel** (right): Displays agent metadata, real-time usage statistics, and a primitive activity histogram.
- **Input bar** (bottom): Text input for sending tasks and slash commands.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message / execute command |
| `Ctrl+C` | Exit the TUI |
| `Up/Down` | Navigate command suggestions or picker options |
| `Shift+Up/Shift+Down` | Scroll chat history |
| `Tab` | Autocomplete slash commands |

## Slash Commands

Type `/` in the input bar to access slash commands:

| Command | Description |
|---------|-------------|
| `/quit` | Exit the TUI |
| `/stop` | Stop the current agent run |
| `/clear` | Clear the chat history |
| `/help` | Show available commands |
| `/status` | Display agent status |
| `/model` | Open the interactive model picker |
| `/vault` | Open vault actions |
| `/mcp` | Open MCP actions |
| `/template` | Open template actions |

Slash commands show an autocomplete popup as you type. The model picker uses arrow-key navigation, in-list filtering, and Enter-to-select behavior.

## Markdown Rendering

Assistant responses are rendered as formatted Markdown in the terminal:

- **Headers** are displayed with appropriate styling
- **Code blocks** are syntax-highlighted with language detection
- **Lists** (ordered and unordered) are properly indented
- **Bold**, *italic*, and `inline code` are styled
- **Links** are displayed with the URL
- **Tables** are rendered with alignment

## Real-Time Events

The TUI subscribes to the SSE event stream and displays events inline in the chat panel:

```
[primitive.invoked]    fs.read src/auth.rs
[primitive.completed]  fs.read (42 bytes)
[primitive.invoked]    fs.write src/auth.rs
[primitive.completed]  fs.write (128 bytes)
```

The agent info panel updates usage statistics in real time as events flow in.

## Multi-Agent Tabs

When working with multiple agents, the TUI supports tabbed views:

- Each agent gets its own tab with independent chat history
- Switch between tabs to manage multiple concurrent agent sessions
- Tab headers show agent ID and current status

## Error Handling

- If the gateway is unreachable, the TUI displays a connection error and offers to retry
- If the token is invalid or expired, an authentication error is shown
- If the agent encounters an error during a run, the error details are displayed in the chat panel
