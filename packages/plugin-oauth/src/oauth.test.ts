import { describe, expect, it } from 'vitest';
import { MoxxyError } from '@moxxy/sdk';
import {
  buildAuthUrl,
  buildOauthAuthorizeTool,
  buildOauthClearTool,
  buildOauthGetTokenTool,
  computeCodeChallenge,
  generateCodeVerifier,
  generateState,
  validateProvider,
} from './index.js';

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };
const fakeCtx = {
  signal: new AbortController().signal,
  logger: noopLogger,
} as never;

describe('@moxxy/plugin-oauth', () => {
  describe('PKCE primitives', () => {
    it('verifier is 43-128 chars and url-safe (RFC 7636 §4.1)', () => {
      for (let i = 0; i < 20; i += 1) {
        const v = generateCodeVerifier();
        expect(v.length).toBeGreaterThanOrEqual(43);
        expect(v.length).toBeLessThanOrEqual(128);
        expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
      }
    });

    it('challenge is S256(verifier) base64url-encoded', () => {
      // RFC 7636 §B.1 worked example
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const challenge = computeCodeChallenge(verifier);
      expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });

    it('state is high-entropy and url-safe', () => {
      const a = generateState();
      const b = generateState();
      expect(a).not.toBe(b);
      expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(a.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe('buildAuthUrl', () => {
    it('includes all required OAuth + PKCE params', () => {
      const url = buildAuthUrl({
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        clientId: 'ABC.apps.googleusercontent.com',
        redirectUri: 'http://localhost:8765/callback',
        scopes: ['openid', 'email', 'profile'],
        codeChallenge: 'XYZ',
        state: 'STATE',
      });
      const parsed = new URL(url);
      expect(parsed.searchParams.get('client_id')).toBe('ABC.apps.googleusercontent.com');
      expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:8765/callback');
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('scope')).toBe('openid email profile');
      expect(parsed.searchParams.get('code_challenge')).toBe('XYZ');
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
      expect(parsed.searchParams.get('state')).toBe('STATE');
    });

    it('merges extraAuthParams (Google offline access)', () => {
      const url = buildAuthUrl({
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        clientId: 'X',
        redirectUri: 'http://localhost:8765/callback',
        scopes: ['email'],
        codeChallenge: 'C',
        state: 'S',
        extraAuthParams: { access_type: 'offline', prompt: 'consent' },
      });
      const parsed = new URL(url);
      expect(parsed.searchParams.get('access_type')).toBe('offline');
      expect(parsed.searchParams.get('prompt')).toBe('consent');
    });
  });

  describe('provider validation', () => {
    it('accepts lowercase ids with . _ -', () => {
      expect(() => validateProvider('google')).not.toThrow();
      expect(() => validateProvider('google.workspace')).not.toThrow();
      expect(() => validateProvider('github-enterprise')).not.toThrow();
      expect(() => validateProvider('my_provider_42')).not.toThrow();
    });

    it('rejects uppercase / spaces / slashes', () => {
      expect(() => validateProvider('Google')).toThrow();
      expect(() => validateProvider('google workspace')).toThrow();
      expect(() => validateProvider('google/workspace')).toThrow();
    });
  });

  describe('tool schemas', () => {
    const noopDeps = { vault: {} as never };

    it('authorize requires tokenUrl, scopes, clientId, provider', () => {
      const tool = buildOauthAuthorizeTool(noopDeps);
      expect(
        tool.inputSchema.safeParse({
          provider: 'google',
          authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
          tokenUrl: 'https://oauth2.googleapis.com/token',
          clientId: 'X',
          scopes: ['email'],
        }).success,
      ).toBe(true);
      expect(tool.inputSchema.safeParse({ provider: 'google' }).success).toBe(false);
    });

    it('authorize accepts mode=device', () => {
      const tool = buildOauthAuthorizeTool(noopDeps);
      expect(
        tool.inputSchema.safeParse({
          provider: 'google',
          deviceUrl: 'https://oauth2.googleapis.com/device/code',
          tokenUrl: 'https://oauth2.googleapis.com/token',
          clientId: 'X',
          scopes: ['email'],
          mode: 'device',
        }).success,
      ).toBe(true);
    });

    it('get_token has includeRefresh opt-in', () => {
      const tool = buildOauthGetTokenTool(noopDeps);
      expect(
        tool.inputSchema.safeParse({ provider: 'google', includeRefresh: true }).success,
      ).toBe(true);
    });

    it('clear requires provider', () => {
      const tool = buildOauthClearTool(noopDeps);
      expect(tool.inputSchema.safeParse({ provider: 'google' }).success).toBe(true);
      expect(tool.inputSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('authorize input validation', () => {
    const deps = { vault: {} as never };

    it('throws a TOOL_ERROR MoxxyError when mode=device is missing deviceUrl', async () => {
      const tool = buildOauthAuthorizeTool(deps);
      const err = await Promise.resolve()
        .then(() => tool.handler({ provider: 'google', clientId: 'X', scopes: ['email'], tokenUrl: 'https://t', mode: 'device' }, fakeCtx))
        .catch((e) => e);
      expect(MoxxyError.isMoxxyError(err)).toBe(true);
      expect((err as MoxxyError).code).toBe('TOOL_ERROR');
      expect((err as MoxxyError).message).toMatch(/deviceUrl/);
    });

    it('throws a TOOL_ERROR MoxxyError when mode=loopback is missing authUrl', async () => {
      const tool = buildOauthAuthorizeTool(deps);
      const err = await Promise.resolve()
        .then(() => tool.handler({ provider: 'google', clientId: 'X', scopes: ['email'], tokenUrl: 'https://t' }, fakeCtx))
        .catch((e) => e);
      expect(MoxxyError.isMoxxyError(err)).toBe(true);
      expect((err as MoxxyError).code).toBe('TOOL_ERROR');
      expect((err as MoxxyError).message).toMatch(/authUrl/);
    });
  });

  describe('end-to-end chain', () => {
    it('exposes the three tools needed for OAuth → MCP wiring', () => {
      const deps = { vault: {} as never };
      const tools = [
        buildOauthAuthorizeTool(deps),
        buildOauthGetTokenTool(deps),
        buildOauthClearTool(deps),
      ];
      expect(tools.map((t) => t.name).sort()).toEqual([
        'oauth_authorize',
        'oauth_clear_token',
        'oauth_get_token',
      ]);
      for (const tool of tools) {
        expect(tool.permission?.action).toBe('prompt');
      }
    });
  });
});
