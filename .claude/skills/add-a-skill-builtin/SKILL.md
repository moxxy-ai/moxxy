---
name: add-a-skill-builtin
description: Add a Markdown skill to moxxy's own built-in skill set (packages/skills-builtin) — use when the moxxy agent should gain a new prompt-only capability.
---

# Add a built-in moxxy skill

These are MOXXY's runtime skills (what the moxxy agent loads), not this
`.claude/skills` library. Full authoring guide:
**`.claude/agents/skill-author.md`**.

Format — one flat file `packages/skills-builtin/skills/<name>.md`:

```md
---
name: vault-setup
description: One sentence — what + when (drives skill matching).
triggers: ["set up vault", "store a secret"]
allowed-tools: [vault_status, vault_list]
---
# Body: imperative prompt instructions. PROMPT-ONLY — never executable code.
```

Rules:
- Skills are Claude Code-compatible MD + YAML frontmatter; resolution order is
  project `./.moxxy/skills/` → user `~/.moxxy/skills/` (auto-synthesized
  skills land here) → plugin `skillsDir` → `@moxxy/skills-builtin` (lowest
  precedence — a user file with the same name shadows yours).
- `triggers` are the match phrases; keep them concrete. No matching skill →
  the loop synthesizes one (`synthesize_skill`), so missing triggers degrade
  gracefully but burn a synthesis.
- If the skill needs a secret, instruct the vault flow (`${vault:NAME}`
  refs, never plaintext) — see `vault-setup.md` as the canonical example.
- Plugin-owned skills: ship them in the plugin via
  `definePlugin({ skillsDir })` instead of skills-builtin.

Ship: `pnpm build` (the CLI bundles the builtin skills dir —
`packages/cli/src/setup/builtin-skills-dir.ts` resolves it), smoke with
`node packages/cli/dist/bin.js skills list`, changeset (`@moxxy/cli` patch).
