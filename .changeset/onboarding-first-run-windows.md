---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

Moxxy finds Codex where its Windows installer puts it, `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`. After **Install Codex** the row said "Not installed" again: Moxxy looked only on its own `PATH`, which the installer changes for new windows only, and in `~/.local/bin`.

First run on the desktop no longer waits minutes in silence while setup runs behind it:

- The provider step starts on a coding agent instead of an API key, and lists the agents with their **Install** button straight away. Before, the rows came only from the agent runtime, which starts after setup.
- An install, an update or a check refreshes the rows even before the runtime is up.
- Under the form, onboarding says which setup step runs and that signing in and starting the agent wait for it.
- **Create workspace** goes on as soon as the workspace exists, instead of waiting for its agent to start.
- A workspace that could not be created says why and stays on the step.
- A workspace picked on Windows is named after its folder (`moxxy`), not its whole path, in onboarding and in the sidebar's **New workspace**.
