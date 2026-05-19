/**
 * High-level orchestrator. Drives the full login dance for any provider
 * declared via `OAuthProviderProfile` — picks browser or device flow based
 * on `ctx.headless`, surfaces the user-facing prompt, persists the result
 * (token set + extras) under `oauth/<profile.id>/*`.
 */

import { MoxxyError } from '@moxxy/sdk';
import { runAuthorizationCodeFlow } from './oauth/browser-flow.js';
import { pollUntil } from './oauth/poll-until.js';
import { storeTokenSet } from './storage.js';
import type { TokenSet } from './oauth/types.js';
import type {
  DeviceFlowAdapter,
  DeviceFlowInit,
  OAuthProviderProfile,
  RunOauthLoginCtx,
  RunOauthLoginResult,
} from './profile.js';

const DEFAULT_BROWSER_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_DEVICE_TIMEOUT_MS = 10 * 60 * 1000;
const DEVICE_POLL_SAFETY_MARGIN_MS = 3000;

export async function runOauthLogin(
  profile: OAuthProviderProfile,
  ctx: RunOauthLoginCtx,
): Promise<RunOauthLoginResult> {
  const tokens = ctx.headless
    ? await runDeviceFlow(profile, ctx)
    : await runBrowserFlow(profile, ctx);

  const accountId = profile.extractAccountId?.(tokens);
  const customExtras = profile.extractExtras?.(tokens) ?? {};
  const extras: Record<string, string> = { ...customExtras };
  if (accountId) extras.account_id = accountId;

  await storeTokenSet(ctx.vault, profile.id, tokens, {
    clientId: profile.clientId,
    ...(profile.clientSecret ? { clientSecret: profile.clientSecret } : {}),
    tokenUrl: profile.tokenUrl,
    extras,
  });

  return {
    tokens,
    ...(accountId ? { accountId } : {}),
    extras,
  };
}

async function runBrowserFlow(
  profile: OAuthProviderProfile,
  ctx: RunOauthLoginCtx,
): Promise<TokenSet> {
  const port = profile.redirect?.port ?? 8765;
  const path = profile.redirect?.path ?? '/callback';
  const serviceName = profile.displayName ?? profile.id;
  return runAuthorizationCodeFlow({
    authUrl: profile.authUrl,
    tokenUrl: profile.tokenUrl,
    clientId: profile.clientId,
    ...(profile.clientSecret ? { clientSecret: profile.clientSecret } : {}),
    scopes: profile.scopes,
    redirectPort: port,
    redirectPath: path,
    ...(profile.extraAuthParams ? { extraAuthParams: profile.extraAuthParams } : {}),
    timeoutMs: DEFAULT_BROWSER_TIMEOUT_MS,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
    onAuthUrl: (url) => {
      ctx.write(
        `\nSign in to ${serviceName} to authorize moxxy\n\n` +
          `If your browser doesn't open automatically, paste this URL:\n\n  ${url}\n\n` +
          `Waiting for callback on http://localhost:${port}${path} (5 min timeout)…\n\n`,
      );
    },
  });
}

async function runDeviceFlow(
  profile: OAuthProviderProfile,
  ctx: RunOauthLoginCtx,
): Promise<TokenSet> {
  if (!profile.deviceFlow) {
    throw new MoxxyError({
      code: 'OAUTH_FLOW_NOT_SUPPORTED',
      message: `Provider "${profile.id}" doesn't expose a headless (device-code) flow.`,
      hint:
        'Run this command on a host with a browser, or ask the provider plugin author to ' +
        'add a deviceFlow adapter to the profile.',
      context: { provider: profile.id },
    });
  }
  const adapter: DeviceFlowAdapter = profile.deviceFlow;
  const init: DeviceFlowInit = await adapter.start({
    clientId: profile.clientId,
    ...(profile.clientSecret ? { clientSecret: profile.clientSecret } : {}),
    scopes: profile.scopes,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
  const serviceName = profile.displayName ?? profile.id;
  ctx.write(
    `\nSign in to ${serviceName} (headless / device code flow)\n\n` +
      `  1. On any browser-capable device, open:\n` +
      `       ${init.verificationUriComplete ?? init.verificationUri}\n\n` +
      `  2. Enter this code:\n` +
      `       ${init.userCode}\n\n` +
      `Polling every ${Math.round(init.intervalMs / 1000)}s ` +
      `(${Math.round(init.expiresInMs / 60000)} min timeout)…\n\n`,
  );

  // Cap the polling deadline by the device_code's own expiry — once it
  // dies, any further poll is wasted.
  const timeoutMs = Math.min(init.expiresInMs, DEFAULT_DEVICE_TIMEOUT_MS);

  return pollUntil((state) => adapter.poll(init, state), {
    intervalMs: init.intervalMs + DEVICE_POLL_SAFETY_MARGIN_MS,
    timeoutMs,
    label: `${profile.id} device flow`,
    leadingWait: true,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
}
