const SCRIPT_ENTRYPOINT = /\.[cm]?js$/i;

/**
 * How to start the pnpm that is running this script. `npm_execpath` is a JS
 * file for a JS-distributed pnpm and a native executable for pnpm 11+ and the
 * standalone build; only the former goes through node.
 */
export function pnpmCommand(entrypoint, nodePath = process.execPath) {
  if (!entrypoint) {
    throw new Error('prepare:resources must be run through pnpm so npm_execpath is available');
  }
  return SCRIPT_ENTRYPOINT.test(entrypoint)
    ? { command: nodePath, prefix: [entrypoint] }
    : { command: entrypoint, prefix: [] };
}

/** The running pnpm when it is a native executable, which can be started directly. */
export function nativePnpm(entrypoint) {
  if (!entrypoint || SCRIPT_ENTRYPOINT.test(entrypoint)) return undefined;
  return /(^|[\\/])pnpm(\.exe)?$/i.test(entrypoint) ? entrypoint : undefined;
}
