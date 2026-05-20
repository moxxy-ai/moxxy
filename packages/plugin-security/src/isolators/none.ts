import type { Isolator } from '@moxxy/sdk';

/**
 * Passthrough isolator. Runs the handler with zero enforcement —
 * identical to the no-plugin baseline. Useful as the explicit default
 * when `security.enabled: true` but the user wants per-tool opt-in
 * only (i.e. leave un-isolated tools alone).
 */
export const noneIsolator: Isolator = {
  name: 'none',
  strength: 'none',
  async run(call, handler, _caps, _signal) {
    return handler(call.input);
  },
};
