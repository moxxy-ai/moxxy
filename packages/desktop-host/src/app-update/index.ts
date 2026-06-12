/**
 * Pure, dependency-free (node built-ins only) self-update surface, exposed as
 * the `@moxxy/desktop-host/app-update` subpath so the immutable bootstrap can
 * import + bake it WITHOUT pulling in the electron-coupled rest of desktop-host.
 *
 * Split intentionally:
 *   - manifest.ts          — the signed document + Ed25519 verification (the trust root)
 *   - resolve.ts           — the load-time gate + on-disk bundle state (active/bad/breadcrumb)
 *   - native-resolution.ts — make the shell's optional native deps resolvable from a bundle
 *   - stager.ts            — download → verify → atomically install a bundle (Phase 2)
 *   - boot-log.ts          — persistent boot/update decision log (observability)
 */

export {
  type AppManifest,
  SIGNED_FIELDS,
  canonicalManifestBytes,
  verifyManifestSignature,
  parseManifest,
} from './manifest.js';

export {
  type ShellInfo,
  type ResolvedBundle,
  type ResolveOpts,
  isSafeVersion,
  safeRelPath,
  type FileIntegrityFailure,
  verifyBundleFiles,
  appUpdateDir,
  bundleRoot,
  readActiveVersion,
  setActiveVersion,
  clearActiveVersion,
  readBadVersions,
  markBad,
  unmarkBad,
  writeBreadcrumb,
  readBreadcrumb,
  markConfirmed,
  readConfirmed,
  compareSemver,
  isCompatible,
  exceedsCliRunnerProtocol,
  resolveActiveBundle,
  resolveActiveBundleDetailed,
  type ResolveResult,
  type ResolveRejectReason,
  recoverFromFailedBoot,
  type BootRecovery,
  pruneBundles,
  listStagedVersions,
} from './resolve.js';

export {
  type BootLogEntry,
  type BootLogPhase,
  appendBootLog,
  readBootLog,
  hasBootLog,
} from './boot-log.js';

export { setupNativeResolution } from './native-resolution.js';

export {
  type StagerDeps,
  type CheckResult,
  type Progress,
  type ProgressPhase,
  isAllowedUpdateHost,
  checkForUpdate,
  downloadAndStage,
} from './stager.js';

export { type BuildInput, type BuildOutput, buildAppBundle } from './build.js';
