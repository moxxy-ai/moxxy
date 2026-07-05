/**
 * @moxxy/model-fetch — download-and-verify helper for on-demand model assets.
 *
 * The public surface:
 *   - {@link fetchModelAsset}  https download → streamed sha256 → atomic publish
 *   - {@link extractTarBz2}    hardened `.tar.bz2` extraction
 *   - {@link ensureModel}      download-if-missing + extract-if-missing convenience
 *   - {@link ModelFetchError}  typed failure with a precise `code`
 */

export { ModelFetchError, type ModelFetchErrorCode } from './errors.js';
export {
  fetchModelAsset,
  isAllowedAssetUrl,
  DEFAULT_ALLOWED_HOSTS,
  DEFAULT_MAX_BYTES,
  type FetchLike,
  type FetchModelAssetOptions,
  type FetchModelAssetResult,
  type FetchProgress,
  type FetchPhase,
} from './fetch-asset.js';
export {
  extractTarBz2,
  safeEntryPath,
  type ExtractTarBz2Options,
  type ExtractProgress,
} from './extract.js';
export {
  ensureModel,
  type EnsureModelOptions,
  type EnsureModelResult,
  type EnsureModelProgress,
  type EnsureModelPhase,
} from './ensure-model.js';
