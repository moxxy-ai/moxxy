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
 * bootstrap dependency-free + tiny, mirroring `update-key.ts`. MUST equal
 * `@moxxy/runner`'s `RUNNER_PROTOCOL_VERSION`: a floor left behind makes a
 * fresh install refuse the next JS update stamped with its own runner's
 * protocol, so every update after it needs the full installer. A unit test and
 * the release build (scripts/build-app-bundle.mjs) both assert the two match.
 */
export const FLOOR_RUNNER_PROTOCOL = 24;
