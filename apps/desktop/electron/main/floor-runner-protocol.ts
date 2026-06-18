/**
 * The runner protocol version (`@moxxy/runner`'s `RUNNER_PROTOCOL_VERSION`) the
 * FLOOR app's bundled CLI speaks — i.e. the protocol the desktop can ALWAYS
 * serve, because the pinned `moxxy-cli` shipped in this app's resources runs at
 * exactly this version.
 *
 * The bootstrap passes this to `resolveActiveBundleDetailed` as
 * `cliRunnerProtocol`: a staged JS hot-update whose signed `runnerProtocol`
 * exceeds this would strand the desktop with a client newer than any runner it
 * can spawn (the protocol-skew reconnect loop), so the gate reverts it to the
 * floor JS — which matches the CLI.
 *
 * Baked as a literal (not imported from `@moxxy/runner`) to keep the immutable
 * bootstrap dependency-free + tiny, mirroring `update-key.ts`. MUST stay in
 * lockstep with `@moxxy/runner`'s `RUNNER_PROTOCOL_VERSION` at release time —
 * the release build asserts the two match (see scripts/build-app-bundle.mjs),
 * so a forgotten bump fails the build rather than shipping a wrong floor.
 */
export const FLOOR_RUNNER_PROTOCOL = 9;
