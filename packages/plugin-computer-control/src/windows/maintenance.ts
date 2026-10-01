import { z } from 'zod';
import { CONTRACT_PROTOCOL_VERSION } from '../backend/rpc.js';
import { verifyHelperArtifact } from '../helper/artifact.js';
import { HelperTransport } from '../helper/transport.js';
export { CONTRACT_PROTOCOL_VERSION as COMPUTER_PROTOCOL_VERSION } from '../backend/rpc.js';

/** Installer-only coordination; deliberately not exposed as a model tool. */
export async function acquireComputerMaintenance(executable: string) {
  await verifyHelperArtifact(executable, CONTRACT_PROTOCOL_VERSION);
  const transport = new HelperTransport(executable, ['--parent', String(process.pid)], { protocolVersion: CONTRACT_PROTOCOL_VERSION });
  try {
    z.object({ maintenanceReady: z.literal(true) }).strict().parse(
      await transport.request('maintenance', {}, new AbortController().signal),
    );
    return {
      assertHeld: () => { if (transport.closed) throw new Error('Computer Use maintenance lease lost'); },
      close: () => transport.close(),
    };
  } catch (error) { await transport.close(); throw error; }
}
