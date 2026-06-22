import { describe, expect, it } from 'vitest';

describe('@moxxy/sdk package root', () => {
  it('exports defineTranscriber for workspace consumers', async () => {
    const sdk = await import('@moxxy/sdk');

    expect(typeof sdk.defineTranscriber).toBe('function');

    const def = sdk.defineTranscriber({
      name: 'package-root-transcriber',
      createClient: () => ({
        name: 'package-root-transcriber',
        transcribe: async () => ({ text: 'ok' }),
      }),
    });

    expect(def.name).toBe('package-root-transcriber');
    expect(Object.isFrozen(def)).toBe(true);
  });

  it('exports requirement types through package root declarations', async () => {
    const requirement: import('@moxxy/sdk').MoxxyRequirement = {
      kind: 'runtime',
      name: 'auth:provider:openai-codex',
      state: 'ready',
    };
    const check: import('@moxxy/sdk').RequirementCheck = {
      ready: false,
      issues: [
        {
          requirement,
          code: 'not_ready',
          message: 'OAuth is not ready',
        },
      ],
    };

    expect(check.issues[0]?.requirement.name).toBe('auth:provider:openai-codex');
  });

  // The main barrel is the browser/RN-safe surface: a value import of any of
  // these would drag a node:* builtin into a Metro/browser bundle. They live on
  // the './server' subpath instead. This pins the split so a future accidental
  // re-export on the main barrel is caught (see .dependency-cruiser.cjs
  // `no-node-builtins-in-renderer`).
  const NODE_ONLY_VALUE_EXPORTS = [
    'writeFileAtomic',
    'writeFileAtomicSync',
    'moxxyHome',
    'moxxyPath',
    'readRequestBody',
    'bearerTokenMatches',
    'resolveChannelToken',
    'rotateChannelToken',
    'bearerGuard',
    'encodeWsBearerProtocol',
    'tokenFromWsProtocolHeader',
    'MOXXY_WS_SUBPROTOCOL',
    'MOXXY_WS_BEARER_PROTOCOL_PREFIX',
  ] as const;

  it('does NOT expose Node-runtime values on the browser/RN-safe main barrel', async () => {
    const sdk: Record<string, unknown> = await import('@moxxy/sdk');
    for (const name of NODE_ONLY_VALUE_EXPORTS) {
      expect(sdk[name], `${name} must not be on the @moxxy/sdk main barrel`).toBeUndefined();
    }
  });

  it('exposes the Node-runtime helpers on the @moxxy/sdk/server subpath', async () => {
    const server: Record<string, unknown> = await import('@moxxy/sdk/server');
    for (const name of NODE_ONLY_VALUE_EXPORTS) {
      expect(server[name], `${name} must be exported from @moxxy/sdk/server`).toBeDefined();
    }
  });
});
