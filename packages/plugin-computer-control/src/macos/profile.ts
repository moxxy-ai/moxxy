import { fileURLToPath } from 'node:url';

/** The universal helper built by `native/macos/build.sh`. */
export const macosHelperPath = fileURLToPath(new URL('../../bin/darwin-universal/moxxy-computer', import.meta.url));
