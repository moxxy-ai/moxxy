/** The folders inside Moxxy's own app that it puts on `NODE_PATH` for itself (`app.asar/node_modules`). */
const APP_ARCHIVES = new Set(['app.asar', 'app.asar.unpacked']);

/**
 * Settings of Moxxy's own process in the environment an agent would inherit,
 * set to what the agent gets instead (`undefined` leaves one out). An agent
 * passes its environment on to every program it runs:
 * - `ELECTRON_RUN_AS_NODE` makes the Electron that runs Moxxy's runner act as
 *   Node, and does the same to every Electron app the agent opens (VS Code,
 *   Slack), which then do not start.
 * - `NODE_PATH` carries the app's module folders, which Moxxy's desktop added
 *   for itself; any `node` the agent runs would load modules from them. The
 *   folders the person put there stay.
 * A start that needs one of them sets it again for itself.
 */
export function moxxyRuntimeVariables(
  inherited: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (inherited.ELECTRON_RUN_AS_NODE !== undefined) out.ELECTRON_RUN_AS_NODE = undefined;
  const nodePath = inherited.NODE_PATH;
  if (nodePath !== undefined) {
    const delimiter = platform === 'win32' ? ';' : ':';
    const folders = nodePath.split(delimiter);
    const theirs = folders.filter((folder) => !folder.split(/[\\/]/).some((part) => APP_ARCHIVES.has(part)));
    if (theirs.length !== folders.length) out.NODE_PATH = theirs.length > 0 ? theirs.join(delimiter) : undefined;
  }
  return out;
}

/**
 * Moxxy's own variables in the environment an agent would inherit, each set
 * to what the agent gets instead (`undefined` leaves one out): every
 * `MOXXY_*` but `MOXXY_HOME`, and the settings of Moxxy's own process
 * (`moxxyRuntimeVariables`). The agent reaches Moxxy's tools over MCP, whose
 * token Moxxy hands it in the server's settings, so it needs none of them, and
 * every program it runs would get them: the browser bridge token is a secret
 * (Moxxy's own shell tool leaves it out too), and with the runner's address
 * and session a `moxxy` the agent runs joins the conversation's runner instead
 * of starting its own. OpenCode 2's shared background server also keeps them
 * after Moxxy quits. `MOXXY_HOME` stays: a `moxxy` run in a conversation of an
 * isolated Moxxy must use that Moxxy's home, not the person's real one.
 */
export function moxxyOwnVariables(
  inherited: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): Record<string, string | undefined> {
  const out = moxxyRuntimeVariables(inherited, platform);
  for (const key of Object.keys(inherited)) {
    if (key.startsWith('MOXXY_') && key !== 'MOXXY_HOME') out[key] = undefined;
  }
  return out;
}

/** `env` without the variables set to `undefined`, for an API that copies the environment as it is given. */
export function definedOnly(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

