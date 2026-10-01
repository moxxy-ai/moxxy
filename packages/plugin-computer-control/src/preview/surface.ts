import { defineSurface, type SurfaceDef } from '@moxxy/sdk';
import { previewCodecs, type PreviewCodec, type PreviewController, type PreviewMessage } from './controller.js';

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
      const leaving = new Map<(message: PreviewMessage) => void, () => void>();
      // One surface instance is one client; what it can decode applies to every subscription it holds.
      let codecs: PreviewCodec[] = ['jpeg'];
      return {
        id: COMPUTER_PREVIEW_SURFACE,
        kind: COMPUTER_PREVIEW_SURFACE,
        onData: (callback) => {
          const listener = (message: PreviewMessage) => { callback(message); };
          const leave = controller.subscribe(listener, codecs);
          leaving.set(listener, leave);
          return () => { leaving.delete(listener); leave(); };
        },
        snapshot: () => controller.snapshot(),
        input: (message) => {
          if (message.type === 'keyframe') for (const listener of leaving.keys()) controller.keyframe(listener);
          if (message.type !== 'configure') return;
          if (typeof message.fps === 'number') controller.setFps(message.fps);
          if (message.codecs !== undefined) {
            // A viewer always shows pictures; video is what it may add.
            codecs = [...new Set<PreviewCodec>(['jpeg', ...previewCodecs(message.codecs)])];
            for (const listener of leaving.keys()) controller.accept(listener, codecs);
          }
        },
        close: () => {
          for (const leave of leaving.values()) leave();
          leaving.clear();
        },
      };
    },
  });
}
