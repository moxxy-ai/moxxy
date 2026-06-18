import type { ModesClientView } from '@moxxy/sdk';
import { RunnerMethod } from '../protocol.js';
import type { ViewContext } from './context.js';
import { fakeMode } from './fakes.js';

export function makeModesView(ctx: ViewContext): ModesClientView {
  const { peer, requireInfo } = ctx;
  return {
    list: () => requireInfo().modes.map(fakeMode),
    getActive: () => fakeMode(requireInfo().activeMode ?? 'unknown'),
    setActive: (name) => {
      void peer.request(RunnerMethod.ModeSetActive, { name }).catch(() => undefined);
    },
  };
}
