---
title: Authoring a skill
description: Markdown + frontmatter that instructs the agent how to handle a class of prompts.
---

Skills are **prompt-only** — they never contain executable code. They are just instructions the agent reads when invoked. Drop a Markdown file with YAML frontmatter into one of these directories:

| Path | Scope |
|---|---|
| `./.moxxy/skills/<slug>.md` | Project (checked into git) |
| `~/.moxxy/skills/<slug>.md` | User (this machine) |
| `<plugin>/skills/<slug>.md` | Bundled with a plugin |
| `@moxxy/skills-builtin` | Framework default |

## Frontmatter

```yaml
---
name: <kebab-case slug, lowercase letters/numbers/hyphens, <=60 chars>
description: <one sentence, <=120 chars — the router shows this to the model>
triggers: [<2-5 short phrases the user might say>]
allowed-tools: [<tool names the model needs>]
---
```

## Body

The body is the instructions. Keep it under 30 lines. Numbered steps preferred.

Good:

```md
1. Read the file with Read.
2. Identify the largest exported function.
3. Edit it into two smaller pieces.
4. Run `pnpm typecheck` to confirm.
```

Bad: prose paragraphs that re-explain things the model already knows.

## Self-creation

The agent can author skills for itself. When a user prompt matches no existing skill, the loop invokes the built-in `synthesize_skill` tool: the model drafts a skill, the user approves via the permission prompt, the file lands in `~/.moxxy/skills/<slug>.md`, and the registry hot-reloads. Next time you say something similar, the agent routes through the structured skill.

You can disable auto-synthesis in `moxxy.config.ts`:

```ts
import { defineConfig } from '@moxxy/config';

export default defineConfig({
  plugins: {
    '@moxxy/synthesize-skill': { enabled: false },
  },
});
```
