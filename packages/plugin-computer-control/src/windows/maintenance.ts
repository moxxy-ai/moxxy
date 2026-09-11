import { z } from 'zod';
import { verifyHelperArtifact } from './artifact.js';
import { HelperTransport } from './transport.js';

/** Installer-only coordination; deliberately not exposed as a model tool. */
export async function acquireComputerMaintenance(executable: string) {
  await verifyHelperArtifact(executable);
  const transport=new HelperTransport(executable,['--parent',String(process.pid)]);
  try {
    z.object({maintenanceReady:z.literal(true)}).strict().parse(
      await transport.request('maintenance',{},new AbortController().signal),
    );
    return {
      assertHeld: () => { if (transport.closed) throw new Error('Computer Use maintenance lease lost'); },
      close: () => transport.close(),
    };
  } catch (error) { await transport.close(); throw error; }
}
