---
'@moxxy/agent-connection-kit': patch
'@moxxy/cli': patch
---

Updating OpenCode 1 to OpenCode 2 works. OpenCode 1's own `opencode upgrade` stays on version 1 and still reports success, so the update seemed to finish while OpenCode stayed on 1.19. When the installed OpenCode is a major release behind the latest one, Moxxy now runs `opencode upgrade --major`. This is OpenCode's own command, and it replaces version 1 with version 2 the way it was installed, so the computer does not end up with two `opencode` programs. New OpenCode installs on macOS and Linux use OpenCode 2's installer (`opencode.ai/v2/install`), because `opencode.ai/install` still installs OpenCode 1.
