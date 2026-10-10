/** The full app update on macOS: see `install-mac.ts` and `mac-swap.ts`. */

export { appBundleOf } from './mac-app.js';
export { prepareMacAppUpdate, type MacAppUpdateOptions } from './install-mac.js';
export {
  applyShellUpdate,
  readPendingShellUpdate,
  settleShellUpdate,
  type PendingShellUpdate,
  type ShellUpdateOutcome,
} from './mac-swap.js';
