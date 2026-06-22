import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  asSkillId,
  definePlugin,
  defineTool,
  skillFrontmatterSchema,
  type Plugin,
  type Skill,
  type SkillScope,
  type TurnId,
} from '@moxxy/sdk';
import { z } from 'zod';
import { defaultProjectSkillsDir, defaultUserSkillsDir } from './loader.js';
import { draftSkill } from './synthesize-draft.js';
import type { Session } from '../session.js';

export interface SynthesizeOptions {
  readonly userDir?: string;
  readonly projectDir?: string;
  readonly model?: string;
  readonly auditPath?: string;
  /**
   * Directory holding builtin skills (`@moxxy/skills-builtin`). Threaded
   * through so `reload_skills` can rescan the same source set as the boot
   * loader — otherwise reload silently drops the builtins, observed when
   * a session called `reload_skills` and lost every shipped skill.
   */
  readonly builtinDir?: string;
  /** Extra plugin-supplied skill directories. Same boot-vs-reload story. */
  readonly pluginDirs?: ReadonlyArray<string>;
}

export interface SynthesizedSkill {
  readonly skill: Skill;
  readonly path: string;
  readonly scope: SkillScope;
}

export async function synthesizeSkill(
  session: Session,
  intent: string,
  scope: 'user' | 'project',
  opts: SynthesizeOptions = {},
  /**
   * The active turn's id, threaded from the tool's `ctx.turnId`. The
   * `skill_created` event MUST carry it so run-turn's per-turn subscriber
   * (`event.turnId !== turnId → drop`) doesn't filter the event out of the
   * running turn's stream. Falls back to a fresh turn only for legacy callers
   * that invoke this outside a turn.
   */
  turnId?: TurnId,
): Promise<SynthesizedSkill> {
  const provider = session.providers.getActive();
  // Prefer the model the conversation last ran on over the provider's first
  // descriptor; 'default' matches run-turn's terminal fallback (never a
  // hardcoded vendor id that goes stale).
  const model =
    opts.model ?? session.lastResolvedModel ?? provider.models[0]?.id ?? 'default';
  const draft = await draftSkill(provider, model, intent, session.signal);

  const baseDir =
    scope === 'project'
      ? opts.projectDir ?? defaultProjectSkillsDir(session.cwd)
      : opts.userDir ?? defaultUserSkillsDir();
  await fs.mkdir(baseDir, { recursive: true });

  // Validate the LLM-drafted frontmatter against the published schema BEFORE
  // we write it to disk or register it. A model that returns sloppy YAML
  // (missing description, illegal slug, etc.) should fail with a single
  // readable line — the raw zod issue array was dumping ~30 lines of
  // angry red JSON into the chat, which is a worse signal than just
  // saying "the model didn't produce valid frontmatter."
  const parsed = skillFrontmatterSchema.safeParse(draft.frontmatter);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((iss) => iss.path.join('.') || '(root)')
      .join(', ');
    throw new Error(
      `synthesize_skill: the model didn't produce valid skill frontmatter ` +
        `(missing or invalid: ${missing}). This usually means the model returned ` +
        `prose or a code block without proper YAML frontmatter. Try a more specific intent.`,
    );
  }
  const frontmatter = parsed.data as Skill['frontmatter'];

  const finalPath = await writeUniqueSkill(baseDir, slugify(frontmatter.name), draft.raw);

  // Derive the skill id from the on-disk filename, not from the LLM-supplied
  // frontmatter name — otherwise synthesizing the same name twice collides
  // even when writeUniqueSkill has just bumped the filename to `<slug>-2.md`.
  const basename = path.basename(finalPath, '.md');
  const skill: Skill = {
    id: asSkillId(`${scope}/${basename}`),
    path: finalPath,
    scope,
    frontmatter,
    body: draft.body.trimEnd(),
  };
  session.skills.register(skill);

  // The skill file on disk + the live registration are the product; the
  // skill_created event and the audit JSONL line are telemetry. A failure in
  // either (listener/persistence reject, EACCES on .meta, read-only fs) must
  // NOT throw after the skill is already written + registered — that would
  // surface an error the model retries, orphaning the just-created skill and
  // duplicating it. Make both best-effort and warn instead.
  try {
    await session.log.append({
      type: 'skill_created',
      sessionId: session.id,
      turnId: turnId ?? session.startTurn().turnId,
      source: 'system',
      skillId: skill.id,
      name: skill.frontmatter.name,
      path: finalPath,
      scope,
      originatingPrompt: intent,
    });
  } catch (err) {
    process.stderr.write(
      `moxxy: synthesize_skill could not emit skill_created for "${skill.frontmatter.name}": ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  const auditPath = opts.auditPath ?? path.join(defaultUserSkillsDir(), '.meta', 'created.jsonl');
  try {
    await appendAudit(auditPath, {
      slug: path.basename(finalPath, '.md'),
      ts: new Date().toISOString(),
      sessionId: String(session.id),
      originatingPrompt: intent,
      scope,
    });
  } catch (err) {
    process.stderr.write(
      `moxxy: synthesize_skill audit append failed (${auditPath}): ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  return { skill, path: finalPath, scope };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Pick a unique `<base>[-N].md` name AND create it atomically with the `wx`
 * flag (fail if exists). Name selection and creation are one step, so two
 * concurrent synthesizeSkill calls (workflows / self-improver) racing on the
 * same slug can't both pick the same candidate and have the later writeFile
 * truncate the earlier skill — the loser gets EEXIST and bumps the suffix.
 */
async function writeUniqueSkill(dir: string, base: string, data: string): Promise<string> {
  let n = 1;
  // Bound the search so a directory already saturated with `<base>-*.md` (or a
  // persistent EEXIST race) can't spin forever — surface a clear error instead.
  const MAX_ATTEMPTS = 1000;
  for (;;) {
    const candidate = path.join(dir, n === 1 ? `${base}.md` : `${base}-${n}.md`);
    try {
      await fs.writeFile(candidate, data, { encoding: 'utf8', flag: 'wx' });
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      n += 1;
      if (n > MAX_ATTEMPTS) {
        throw new Error(
          `synthesize_skill: could not find a free filename for "${base}" after ${MAX_ATTEMPTS} attempts`,
        );
      }
    }
  }
}

/** Cap the audit JSONL so a long-lived/self-synthesizing install can't grow it without bound. */
const MAX_AUDIT_LINES = 2000;

async function appendAudit(filePath: string, entry: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8');
  await rotateAuditIfNeeded(filePath);
}

/**
 * Keep only the most recent {@link MAX_AUDIT_LINES} lines. Best-effort and
 * non-atomic by design — this file is pure telemetry that nothing reads back
 * with a bound, so a crash mid-rewrite at worst loses a few audit lines.
 */
async function rotateAuditIfNeeded(filePath: string): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return;
  }
  const lines = raw.split('\n');
  // Account for the trailing empty element from the final newline.
  const nonEmpty = lines.filter((l) => l.length > 0);
  if (nonEmpty.length <= MAX_AUDIT_LINES) return;
  const kept = nonEmpty.slice(nonEmpty.length - MAX_AUDIT_LINES);
  await fs.writeFile(filePath, kept.join('\n') + '\n', 'utf8');
}

export function buildSynthesizeSkillPlugin(
  session: Session,
  opts: SynthesizeOptions = {},
): Plugin {
  return definePlugin({
    name: '@moxxy/synthesize-skill',
    version: '0.0.0',
    tools: [
      defineTool({
        name: 'synthesize_skill',
        description:
          'Draft and persist a new Markdown skill for the given user intent. ' +
          'Uses the active provider to generate the skill body. Returns the path of the created skill. ' +
          'ALWAYS pass scope="user" (the default) unless the user has EXPLICITLY asked to scope ' +
          'the skill to this project — "user" writes to ~/.moxxy/skills/ and the skill is ' +
          'available across every project; "project" writes to <cwd>/.moxxy/skills/ and only ' +
          'applies in this directory. Most skills are general-purpose; pick "project" only when ' +
          'the user said something like "for this repo only" or "project-specific".',
        inputSchema: z.object({
          intent: z.string().min(1).describe('What the user is trying to do. One sentence is enough.'),
          scope: z
            .enum(['user', 'project'])
            .optional()
            .default('user')
            .describe(
              'Where to write the skill. "user" → ~/.moxxy/skills/ (default, recommended). ' +
                '"project" → <cwd>/.moxxy/skills/ — ONLY when the user explicitly asks for a project-scoped skill.',
            ),
        }),
        permission: { action: 'prompt' },
        handler: async ({ intent, scope }, ctx) => {
          const result = await synthesizeSkill(session, intent, scope, opts, ctx.turnId);
          return {
            path: result.path,
            scope: result.scope,
            name: result.skill.frontmatter.name,
          };
        },
      }),
      defineTool({
        name: 'load_skill',
        description:
          'Fetch the full body (instructions) of a pre-authored skill by name. ' +
          'The system prompt lists each skill\'s name, description, and triggers; ' +
          'call this tool to retrieve the actual workflow when the user\'s intent ' +
          'matches one of those skills. Returns the markdown body verbatim plus the ' +
          'frontmatter metadata (allowed-tools, scope, etc.).',
        inputSchema: z.object({
          name: z
            .string()
            .min(1)
            .describe('The exact skill name from the "Available skills" list in the system prompt.'),
        }),
        handler: async ({ name }, ctx) => {
          const skill = session.skills.byName(name);
          if (!skill) {
            const known = session.skills
              .list()
              .map((s) => s.frontmatter.name)
              .join(', ');
            throw new Error(
              `load_skill: no skill named "${name}". ` +
                `Known skills: ${known || '(none registered)'}.`,
            );
          }
          // Emit a skill_invoked event so the audit log captures which
          // skills were actually exercised in this turn — useful for
          // routing analytics and for the self-improver agent later. Use the
          // active turn's id (ctx.turnId) so run-turn's per-turn subscriber
          // filter doesn't drop it (a fresh startTurn() id wouldn't match).
          await session.log.append({
            type: 'skill_invoked',
            sessionId: session.id,
            turnId: ctx.turnId,
            source: 'model',
            skillId: skill.id,
            name: skill.frontmatter.name,
            reason: 'load_skill_tool',
          });
          return {
            name: skill.frontmatter.name,
            description: skill.frontmatter.description,
            scope: skill.scope,
            allowedTools: skill.frontmatter['allowed-tools'] ?? null,
            body: skill.body,
          };
        },
      }),
      defineTool({
        name: 'reload_skills',
        description:
          'Rescan all skill sources (builtin + plugin + ~/.moxxy/skills + ./.moxxy/skills), ' +
          'registering any new or changed skills.',
        inputSchema: z.object({}),
        // Safe, idempotent, local-only rescan — never prompt. Without this the
        // tool inherits the channel resolver's default, which denies in
        // headless runs (the skill-author flow couldn't activate a new skill).
        permission: { action: 'allow' },
        handler: async () => {
          const { discoverSkills } = await import('./loader.js');
          // Discover first, swap second: never empty the registry while
          // the fs scan is in flight, because concurrent skill lookups
          // would observe an empty registry mid-reload. Pass the SAME
          // source set the boot loader used (builtin + pluginDirs +
          // user + project); a previous version of this handler omitted
          // builtinDir/pluginDirs and reload silently nuked the builtin
          // skill set.
          const discovered = await discoverSkills({
            projectDir: opts.projectDir ?? defaultProjectSkillsDir(session.cwd),
            userDir: opts.userDir ?? defaultUserSkillsDir(),
            ...(opts.builtinDir ? { builtinDir: opts.builtinDir } : {}),
            ...(opts.pluginDirs ? { pluginDirs: opts.pluginDirs } : {}),
          });
          session.skills.replaceAll(discovered);
          return `loaded ${discovered.length} skill${discovered.length === 1 ? '' : 's'}`;
        },
      }),
      defineTool({
        name: 'load_tool',
        description:
          'Load a tool whose full schema was indexed but not sent (see "Loadable tools" ' +
          'in the system prompt). Call this with the tool name; the tool becomes callable ' +
          'on the next turn. Only needed when lazy tool loading is enabled — core tools ' +
          '(Read/Write/Edit/Bash/Grep/Glob) are always available.',
        inputSchema: z.object({
          name: z.string().min(1).describe('Exact tool name from the "Loadable tools" index.'),
        }),
        permission: { action: 'allow' },
        handler: ({ name }) => {
          // The call itself is recorded in the log; `applyLazyTools` reads that
          // to include the tool's schema on subsequent requests. Here we just
          // validate the name and echo the description so the model can proceed.
          const tool = session.tools.get(name);
          if (!tool) {
            const known = session.tools
              .list()
              .map((t) => t.name)
              .join(', ');
            throw new Error(`load_tool: no tool named "${name}". Known tools: ${known}.`);
          }
          return { name: tool.name, description: tool.description, loaded: true };
        },
      }),
    ],
  });
}
