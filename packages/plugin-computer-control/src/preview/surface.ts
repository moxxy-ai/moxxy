import { defineSurface, type SurfaceDef } from '@moxxy/sdk';
import type { PreviewController } from './controller.js';

export const COMPUTER_PREVIEW_SURFACE = 'computer-preview';

/**
 * The live picture of the app the agent works in, for the human. Opening the
 * surface is what starts the capture; with no viewer nothing is captured.
 */
export function buildComputerPreviewSurface(controller: PreviewController): SurfaceDef {
  return defineSurface({
    kind: COMPUTER_PREVIEW_SURFACE,
    description: 'A live view of the application Computer Use is working in.',
    open: () => {
      const leaving = new Set<() => void>();
      return {
        id: COMPUTER_PREVIEW_SURFACE,
        kind: COMPUTER_PREVIEW_SURFACE,
        onData: (callback) => {
          const leave = controller.subscribe(callback);
          leaving.add(leave);
          return () => { leaving.delete(leave); leave(); };
        },
        snapshot: () => controller.snapshot(),
        input: (message) => {
          if (message.type === 'configure' && typeof message.fps === 'number') controller.setFps(message.fps);
        },
        close: () => {
          for (const leave of leaving) leave();
          leaving.clear();
        },
      };
    },
  });
}
