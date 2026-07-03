import { promises as fs } from 'node:fs';
import { defineTool, z, type ToolContext, type ToolDef } from '@moxxy/sdk';
import { readCoreJournal, safeRepoPath } from '../core-update.js';
import { emitSafe } from '../deps.js';
import type { CoreToolDeps } from './shared.js';

// ── self_update_core_edit ───────────────────────────────────────────────────
export function coreEditTool(cd: CoreToolDeps): ToolDef {
  const { deps } = cd;
  return defineTool({
    name: 'self_update_core_edit',
    description:
      'Find-and-replace a unique string in a file inside the provisioned core clone (path relative to the repo root). Approval-gated.',
    inputSchema: z.object({
      coreTxnId: z.string().min(1),
      file: z.string().min(1),
      oldString: z.string().min(1),
      newString: z.string(),
    }),
    permission: { action: 'prompt' },
    // All real I/O is confined to the provisioned clone + journal under
    // ~/.moxxy/self-update (safeRepoPath refuses escapes). `$cwd/**` is
    // declared read-only because the input-level cap check resolves the
    // repo-relative `file` input against the session cwd, not the clone.
    isolation: {
      capabilities: {
        fs: {
          read: ['$cwd/**', `${deps.moxxyDir}/self-update/**`],
          write: [`${deps.moxxyDir}/self-update/**`],
        },
        net: { mode: 'none' },
        timeMs: 15_000,
      },
    },
    handler: async (input, ctx: ToolContext) => {
      const journal = await readCoreJournal(deps.moxxyDir, input.coreTxnId);
      const abs = safeRepoPath(journal.repoDir, input.file);
      const cur = await fs.readFile(abs, 'utf8');
      const count = cur.split(input.oldString).length - 1;
      if (count === 0) throw new Error(`oldString not found in ${input.file}`);
      if (count > 1) throw new Error(`oldString is not unique in ${input.file} (${count} matches)`);
      await fs.writeFile(abs, cur.replace(input.oldString, input.newString), 'utf8');
      await emitSafe(deps, ctx, 'core_edit', { txnId: input.coreTxnId, file: input.file });
      return { ok: true, edited: input.file };
    },
  });
}
