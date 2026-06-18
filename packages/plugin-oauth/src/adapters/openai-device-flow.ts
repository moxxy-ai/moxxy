/**
 * Device-authorization adapter for OpenAI's non-standard flow (used by
 * Codex/ChatGPT, opencode, codex-rs). Not RFC 8628 — speaks a JSON dialect:
 *
 *   1. POST `${issuer}/api/accounts/deviceauth/usercode` JSON `{client_id}`
 *      → `{device_auth_id, user_code, interval}`.
 *   2. Surface `user_code` + a product-specific verification URI
 *      (`verificationUri`) to the user.
 *   3. Poll `${issuer}/api/accounts/deviceauth/token` JSON
 *      `{device_auth_id, user_code}`. 403/404 ⇒ keep polling. 200 returns
 *      `{authorization_code, code_verifier}`.
 *   4. Exchange that `authorization_code` + `code_verifier` for real tokens
 *      via the standard `/oauth/token` endpoint with
 *      `redirect_uri=${issuer}/deviceauth/callback` (not an actual redirect
 *      target — just a registered value the server expects to see).
 *
 * Reusable for any OpenAI-issued client; product-specific bits are the
 * verification URI and the `client_id`.
 */

import { classifyHttpStatus, MoxxyError } from '@moxxy/sdk';
import type { TokenSet } from '../oauth/types.js';
import { exchangeCodeForToken } from '../oauth/token-exchange.js';
import type {
  DeviceFlowAdapter,
  DeviceFlowInit,
  DeviceFlowStartArgs,
} from '../profile.js';
import type { PollOutcome, PollState } from '../oauth/poll-until.js';

export interface OpenaiDeviceFlowOpts {
  /** Auth issuer base URL, e.g. `https://auth.openai.com`. */
  readonly issuer: string;
  /** Standard OAuth token endpoint — `parseTokenResponse` consumes its reply. */
  readonly tokenUrl: string;
  /**
   * URL the user opens to enter the device code. Product-specific —
   * Codex uses `${issuer}/codex/device`. The init endpoint does NOT
   * return one, so the caller supplies it.
   */
  readonly verificationUri: string;
}

interface OpenaiDeviceState {
  readonly deviceAuthId: string;
  readonly userCode: string;
  readonly clientId: string;
}

export function openaiDeviceFlow(opts: OpenaiDeviceFlowOpts): DeviceFlowAdapter {
  const initUrl = `${opts.issuer}/api/accounts/deviceauth/usercode`;
  const pollUrl = `${opts.issuer}/api/accounts/deviceauth/token`;
  const exchangeRedirectUri = `${opts.issuer}/deviceauth/callback`;

  return {
    async start(args: DeviceFlowStartArgs): Promise<DeviceFlowInit> {
      const res = await fetch(initUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: args.clientId }),
        ...(args.signal ? { signal: args.signal } : {}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw (
          classifyHttpStatus(res.status, { url: initUrl, body: text || res.statusText }) ??
          new MoxxyError({
            code: 'AUTH_INVALID',
            message: `device auth init failed: ${res.status} ${text || res.statusText}`,
            context: { status: res.status, url: initUrl },
          })
        );
      }
      const data = (await res.json()) as {
        device_auth_id: string;
        user_code: string;
        interval?: string | number;
        expires_in?: string | number;
      };
      // Coerce-then-validate: a malformed server value (e.g. interval:"" or a
      // non-numeric string) parses to NaN, which would poison the poll timing
      // (`setTimeout(_, NaN)` busy-loops; a NaN deadline aborts the flow). Only
      // accept a finite number; otherwise fall back to the RFC-style defaults.
      const rawInterval =
        typeof data.interval === 'string' ? parseInt(data.interval, 10) : data.interval;
      const intervalSec = Math.max(Number.isFinite(rawInterval) ? (rawInterval as number) : 5, 1);
      const rawExpiresIn =
        typeof data.expires_in === 'string' ? parseInt(data.expires_in, 10) : data.expires_in;
      const expiresInSec = Number.isFinite(rawExpiresIn) ? (rawExpiresIn as number) : 600;
      return {
        userCode: data.user_code,
        verificationUri: opts.verificationUri,
        intervalMs: intervalSec * 1000,
        expiresInMs: expiresInSec * 1000,
        providerData: {
          deviceAuthId: data.device_auth_id,
          userCode: data.user_code,
          clientId: args.clientId,
        } satisfies OpenaiDeviceState,
      };
    },

    async poll(init: DeviceFlowInit, _state: PollState): Promise<PollOutcome<TokenSet>> {
      const { deviceAuthId, userCode, clientId } = init.providerData as OpenaiDeviceState;
      const res = await fetch(pollUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          authorization_code: string;
          code_verifier: string;
        };
        // Two-step: poll returns a server-side authorization_code we
        // exchange via the standard token endpoint. The redirect_uri
        // here is the issuer's device callback — a registered value,
        // not a URI we listen on. Route through the shared exchange
        // helper so this dialect can't drift from browser-flow.
        return {
          done: await exchangeCodeForToken({
            tokenUrl: opts.tokenUrl,
            code: data.authorization_code,
            redirectUri: exchangeRedirectUri,
            clientId,
            codeVerifier: data.code_verifier,
          }),
        };
      }
      // OpenAI's "still waiting" signal — 403 or 404 with no further detail.
      if (res.status === 403 || res.status === 404) {
        return { pending: true };
      }
      const text = await res.text().catch(() => '');
      throw (
        classifyHttpStatus(res.status, { url: pollUrl, body: text || res.statusText }) ??
        new MoxxyError({
          code: 'AUTH_INVALID',
          message: `Device auth poll failed: ${res.status} ${text || res.statusText}`,
          context: { status: res.status, url: pollUrl },
        })
      );
    },
  };
}
