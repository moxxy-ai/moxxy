---
"@moxxy/desktop": patch
---

**Update** on an agent connection in the desktop no longer fails for an OpenCode installed with npm. The desktop puts the Node it installs for you first on its own `PATH`, and the agent's update inherited it: `opencode upgrade` asked that Node's npm how OpenCode was installed, found nothing and stopped with "Could not detect the installation method". The agent's own update command now runs with the desktop's Node folder last, so it reaches the npm that installed the agent, on Windows (where the variable is named `Path`), macOS and Linux alike. An agent installed inside that Node folder keeps it first. Install, conversations and every other program are unchanged.
