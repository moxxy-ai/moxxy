import { definePlugin, type LifecycleHooks, type Plugin } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import {
  buildOauthAuthorizeTool,
  buildOauthClearTool,
  buildOauthGetTokenTool,
  type OAuthToolDeps,
} from './tools.js';

// Low-level flow primitives — useful for ad-hoc usage or custom adapters.
export {
  buildAuthUrl,
  exchangeCodeForToken,
  parseTokenResponse,
  refreshAccessToken,
  runAuthorizationCodeFlow,
  runDeviceCodeFlow,
  pollUntil,
} from './flow.js';
export type {
  BuildAuthUrlInput,
  DeviceFlowOptions,
  DevicePrompt,
  OAuthFlowOptions,
  PollOutcome,
  PollState,
  PollUntilOpts,
  TokenSet,
} from './flow.js';

export { computeCodeChallenge, generateCodeVerifier, generateState } from './pkce.js';
export { openInBrowser } from './open-browser.js';

// Storage (vault-backed; extras-aware).
export {
  clearStoredCreds,
  isExpired,
  readStoredCreds,
  storeTokenSet,
  validateProvider,
  type OAuthVault,
  type StoreTokenSetMeta,
  type StoredCreds,
} from './storage.js';

// Provider framework — declare a profile, plug in a device adapter,
// orchestrate via runOauthLogin / ensureFreshTokens.
export type {
  DeviceFlowAdapter,
  DeviceFlowInit,
  DeviceFlowStartArgs,
  OAuthProviderProfile,
  RunOauthLoginCtx,
  RunOauthLoginResult,
} from './profile.js';
export { runOauthLogin } from './run-login.js';
export {
  ensureFreshTokens,
  type EnsureFreshOptions,
  type EnsureFreshResult,
} from './ensure-fresh.js';

// Per-credential refresh serialization (in-process mutex + best-effort
// cross-process lockfile) for providers with single-use rotating
// refresh tokens.
export {
  isAuthRejection,
  withCredentialLock,
  type CredentialLockOptions,
} from './credential-lock.js';

// Bundled device-flow adapters. Custom dialects implement `DeviceFlowAdapter`.
export { rfc8628DeviceFlow, type Rfc8628AdapterOpts } from './adapters/rfc8628-device-flow.js';
export { openaiDeviceFlow, type OpenaiDeviceFlowOpts } from './adapters/openai-device-flow.js';

// Tools layer — `oauth_authorize`, `oauth_get_token`, `oauth_clear_token`.
export {
  buildOauthAuthorizeTool,
  buildOauthClearTool,
  buildOauthGetTokenTool,
  type OAuthToolDeps,
} from './tools.js';

export interface BuildOauthPluginOpts {
  readonly vault: VaultStore;
}

/**
 * `@moxxy/plugin-oauth` — generic OAuth 2.0 + PKCE provider framework.
 *
 * Two surfaces:
 *   1. **Tools** — `oauth_authorize`, `oauth_get_token`, `oauth_clear_token`.
 *      Model-callable; suits ad-hoc usage and MCP server wiring.
 *   2. **Provider framework** — declare an `OAuthProviderProfile`, plug in
 *      (or write) a `DeviceFlowAdapter`, drive with `runOauthLogin(profile, ctx)`
 *      and `ensureFreshTokens(profile, vault)`. Suits LLM providers (e.g.
 *      `@moxxy/plugin-provider-openai-codex`) that own their auth lifecycle.
 *
 * Tokens persist in the vault under `oauth/<provider>/*`. Bundled device
 * adapters: `rfc8628DeviceFlow` (standards-compliant), `openaiDeviceFlow`
 * (OpenAI's non-standard flavor). New dialects ship their own adapter.
 */
export function buildOauthPlugin(opts: BuildOauthPluginOpts): Plugin {
  // Host-injected vault (available immediately).
  return makeOauthPlugin(() => opts.vault);
}

/**
 * Discovery-loadable default export: resolves the vault from the inter-plugin
 * service registry in `onInit` (the vault plugin publishes `'vault'`). Requires
 * `@moxxy/plugin-vault` to load first (declared in `package.json`
 * `moxxy.requirements`), so its `onInit` registers the service before this one
 * consumes it. The tools read `deps.vault` lazily via a getter, so they resolve
 * the store at call time — after `onInit` has wired it.
 */
export const oauthPlugin: Plugin = (() => {
  let resolved: VaultStore | null = null;
  const getVault = (): VaultStore => {
    if (!resolved) {
      throw new Error(
        '@moxxy/plugin-oauth: the "vault" service is unavailable — @moxxy/plugin-vault must load first',
      );
    }
    return resolved;
  };
  const hooks: LifecycleHooks = {
    onInit: (ctx) => {
      resolved = ctx.services.require<VaultStore>('vault');
    },
  };
  return makeOauthPlugin(getVault, hooks);
})();

function makeOauthPlugin(getVault: () => VaultStore, hooks?: LifecycleHooks): Plugin {
  // The getter satisfies `OAuthToolDeps.vault` while deferring resolution to call
  // time, so the same tools work whether the vault is host-injected or resolved
  // from the service registry in onInit.
  const deps: OAuthToolDeps = {
    get vault(): VaultStore {
      return getVault();
    },
  };
  return definePlugin({
    name: '@moxxy/plugin-oauth',
    version: '0.0.0',
    tools: [
      buildOauthAuthorizeTool(deps),
      buildOauthGetTokenTool(deps),
      buildOauthClearTool(deps),
    ],
    ...(hooks ? { hooks } : {}),
  });
}
