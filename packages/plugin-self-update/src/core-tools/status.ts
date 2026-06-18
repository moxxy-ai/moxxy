import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { listCoreTxns } from '../core-update.js';
import type { CoreToolDeps } from './shared.js';

// ── self_update_core_status ─────────────────────────────────────────────────
export function coreStatusTool(cd: CoreToolDeps): ToolDef {
  const { deps } = cd;
  return defineTool({
    name: 'self_update_core_status',
    description: 'List Tier-2 core-update transactions and their state.',
    inputSchema: z.object({}),
    permission: { action: 'allow' },
    handler: async () => {
      const all = await listCoreTxns(deps.moxxyDir);
      return {
        transactions: all.map((j) => ({
          coreTxnId: j.txnId,
          state: j.state,
          packages: j.packages,
          version: j.version,
          updatedAt: j.updatedAt,
        })),
      };
    },
  });
}
