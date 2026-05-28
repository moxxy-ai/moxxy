/**
 * The reusable PermissionResolver factories now live in `@moxxy/sdk` (they have
 * zero core internals, and channel plugins — which may only depend on the SDK —
 * need them). Re-exported here for back-compat so existing `@moxxy/core`
 * importers keep working.
 */
export {
  autoAllowResolver,
  denyByDefaultResolver,
  createCallbackResolver,
  createAllowListResolver,
  createDeferredPermissionResolver,
  type CallbackResolverOptions,
  type PermissionPromptHandler,
  type DeferredPermissionResolver,
  type DeferredPermissionResolverOptions,
} from '@moxxy/sdk';
