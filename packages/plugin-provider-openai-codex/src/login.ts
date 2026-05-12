/**
 * End-to-end OAuth login for the Codex provider. Owns the local callback
 * server, the browser-launch hint, the device-code fallback, and vault
 * persistence — so any host that hands us a `ProviderAuthContext` (init
 * wizard, `moxxy login`, future remote-control channels) can drive the
 * full flow without knowing anything Codex-specific.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type {
  ProviderAuthContext,
  ProviderOAuthResult,
  ProviderOAuthStatus,
} from '@moxxy/sdk';
import {
  buildAuthorizeUrl,
  DEFAULT_CALLBACK_PORT,
  DEFAULT_REDIRECT_PATH,
  exchangeCodeForTokens,
  generatePKCE,
  generateState,
  pollDeviceAuth,
  startDeviceAuth,
} from './oauth.js';
import type { CodexTokens } from './types.js';

/** Vault key the JSON-stringified CodexTokens bundle lives under. */
export const CODEX_VAULT_KEY = 'OPENAI_CODEX_OAUTH';

/**
 * The single entry-point the SDK's `auth.login` calls into. Picks the
 * browser flow when interactive, the device-code flow otherwise.
 */
export async function codexLogin(ctx: ProviderAuthContext): Promise<ProviderOAuthResult> {
  const tokens = ctx.headless ? await runDeviceFlow(ctx) : await runBrowserFlow(ctx);
  await ctx.vault.set(CODEX_VAULT_KEY, JSON.stringify(tokens), ['openai-codex', 'oauth']);
  return tokens.accountId
    ? { accountId: tokens.accountId, expiresAt: tokens.expires }
    : { expiresAt: tokens.expires };
}

export async function codexLogout(ctx: ProviderAuthContext): Promise<boolean> {
  try {
    return (await ctx.vault.delete?.(CODEX_VAULT_KEY)) ?? false;
  } catch {
    return false;
  }
}

export async function codexStatus(ctx: ProviderAuthContext): Promise<ProviderOAuthStatus | null> {
  const tokens = await readStoredTokens(ctx);
  if (!tokens) return null;
  return {
    accountId: tokens.accountId ?? null,
    expiresAt: tokens.expires,
    vaultKey: CODEX_VAULT_KEY,
  };
}

export async function readStoredTokens(ctx: ProviderAuthContext): Promise<CodexTokens | null> {
  let raw: string | null;
  try {
    raw = await ctx.vault.get(CODEX_VAULT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CodexTokens;
  } catch {
    return null;
  }
}

async function runBrowserFlow(ctx: ProviderAuthContext): Promise<CodexTokens> {
  const pkce = await generatePKCE();
  const state = generateState();
  const server = await startCallbackServer({ port: DEFAULT_CALLBACK_PORT, expectedState: state });
  const url = buildAuthorizeUrl(server.redirectUri, pkce, state);

  ctx.write(
    `\nSign in to ChatGPT to authorize moxxy\n\n` +
      `If your browser doesn't open automatically, paste this URL:\n\n  ${url}\n\n` +
      `Waiting for callback on ${server.redirectUri} (5 min timeout)…\n\n`,
  );

  await tryOpenInBrowser(url);

  try {
    const code = await server.waitForCode(5 * 60 * 1000);
    return await exchangeCodeForTokens(code, server.redirectUri, pkce);
  } finally {
    server.stop();
  }
}

async function runDeviceFlow(ctx: ProviderAuthContext): Promise<CodexTokens> {
  const init = await startDeviceAuth();
  ctx.write(
    `\nSign in to ChatGPT (headless / device code flow)\n\n` +
      `  1. On any browser-capable device, open:\n` +
      `       ${init.verificationUri}\n\n` +
      `  2. Enter this code:\n` +
      `       ${init.userCode}\n\n` +
      `Polling every ${Math.round(init.intervalMs / 1000)}s (10 min timeout)…\n\n`,
  );
  return pollDeviceAuth(init, { timeoutMs: 10 * 60 * 1000 });
}

/** Local OAuth callback HTTP server. Single-shot — first GET to the redirect path resolves the promise. */
interface CallbackServer {
  readonly redirectUri: string;
  waitForCode(timeoutMs: number): Promise<string>;
  stop(): void;
}

const SUCCESS_HTML = `<!doctype html>
<html><head><title>moxxy — login successful</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0b0b0b;color:#f1ecec}
.c{text-align:center;padding:2rem}h1{margin-bottom:.5rem}p{color:#a39c9c}</style></head>
<body><div class="c"><h1>Login successful</h1><p>You can close this window and return to moxxy.</p></div>
<script>setTimeout(()=>window.close(),2000)</script></body></html>`;

function errorHtml(err: string): string {
  return `<!doctype html>
<html><head><title>moxxy — login failed</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0b0b0b;color:#f1ecec}
.c{text-align:center;padding:2rem}h1{color:#fc533a;margin-bottom:.5rem}p{color:#a39c9c}
.e{color:#ff917b;font-family:monospace;margin-top:1rem;padding:1rem;background:#3c140d;border-radius:.5rem}</style></head>
<body><div class="c"><h1>Login failed</h1><p>An error occurred during authorization.</p><div class="e">${escapeHtml(err)}</div></div></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function startCallbackServer(opts: {
  readonly port: number;
  readonly expectedState: string;
}): Promise<CallbackServer> {
  const redirectPath = DEFAULT_REDIRECT_PATH;
  const redirectUri = `http://localhost:${opts.port}${redirectPath}`;

  let resolveCode: ((code: string) => void) | undefined;
  let rejectCode: ((err: Error) => void) | undefined;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${opts.port}`);
    if (url.pathname !== redirectPath) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDesc = url.searchParams.get('error_description');

    if (error) {
      const msg = errorDesc || error;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(errorHtml(msg));
      rejectCode?.(new Error(`OAuth error: ${msg}`));
      return;
    }
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(errorHtml('Missing authorization code'));
      rejectCode?.(new Error('OAuth callback missing code parameter'));
      return;
    }
    if (state !== opts.expectedState) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(errorHtml('Invalid state — potential CSRF attack'));
      rejectCode?.(new Error('OAuth state mismatch'));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(SUCCESS_HTML);
    resolveCode?.(code);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  return {
    redirectUri,
    waitForCode(timeoutMs: number): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          resolveCode = undefined;
          rejectCode = undefined;
          reject(new Error(`OAuth callback timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
        resolveCode = (code) => {
          clearTimeout(timer);
          resolve(code);
        };
        rejectCode = (err) => {
          clearTimeout(timer);
          reject(err);
        };
      });
    },
    stop(): void {
      server.close();
    },
  };
}

async function tryOpenInBrowser(url: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Silent fallback — caller already printed the URL.
  }
}
