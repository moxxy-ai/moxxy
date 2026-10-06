/**
 * Extra environment handed to every runner this process spawns — workspace
 * runners and channel bots alike.
 *
 * Set once, at startup, by whoever owns a resource the runner needs to find —
 * currently the browser bridge, whose socket path is only known after it
 * listens. A module-level holder rather than a constructor argument because
 * runners are spawned lazily, long after that address exists.
 */
let extraEnv: Readonly<Record<string, string>> = {};

/** Merge more variables into what future runners inherit. */
export function setRunnerExtraEnv(env: Readonly<Record<string, string>>): void {
  extraEnv = { ...extraEnv, ...env };
}

export function runnerExtraEnv(): Readonly<Record<string, string>> {
  return extraEnv;
}
