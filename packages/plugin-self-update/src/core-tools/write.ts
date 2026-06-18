import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { defineTool, z, type ToolContext, type ToolDef } from '@moxxy/sdk';
import { readCoreJournal, safeRepoPath } from '../core-update.js';
import { emitSafe } from '../deps.js';
import type { CoreToolDeps } from './shared.js';

// ── self_update_core_write ──────────────────────────────────────────────────
export function coreWriteTool(cd: CoreToolDeps): ToolDef {
  const { deps } = cd;
  return defineTool({
    name: 'self_update_core_write',
    description:
      'Write a file inside the provisioned core clone for a transaction (paths are relative to the repo root and cannot escape it). This is an approval-gated code write — show the user the content first.',
    inputSchema: z.object({
      coreTxnId: z.string().min(1),
      file: z.string().min(1).describe('Path relative to the repo root, e.g. packages/core/src/foo.ts'),
      content: z.string(),
    }),
    permission: { action: 'prompt' },
    handler: async (input, ctx: ToolContext) => {
      const journal = await readCoreJournal(deps.moxxyDir, input.coreTxnId);
      const abs = safeRepoPath(journal.repoDir, input.file);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, input.content, 'utf8');
      await emitSafe(deps, ctx, 'core_write', { txnId: input.coreTxnId, file: input.file });
      return { ok: true, wrote: input.file };
    },
  });
}
