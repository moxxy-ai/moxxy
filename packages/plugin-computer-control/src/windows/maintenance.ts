import { z } from 'zod';
import { verifyHelperArtifact } from '../helper/artifact.js';
import { HelperTransport } from '../helper/transport.js';
import { PROTOCOL_VERSION } from './contracts.js';
export { PROTOCOL_VERSION as COMPUTER_PROTOCOL_VERSION } from './contracts.js';

/** Installer-only coordination; deliberately not exposed as a model tool. */
export async function acquireComputerMaintenance(executable: string) {
  await verifyHelperArtifact(executable, PROTOCOL_VERSION);
  const transport=new HelperTransport(executable,['--parent',String(process.pid)],{protocolVersion:PROTOCOL_VERSION});
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
