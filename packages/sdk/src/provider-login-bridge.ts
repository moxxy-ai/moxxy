/**
 * Cross-process bridge for relaying a provider login's interactive prompts —
 * the out-of-band token / authorization-code paste that `claude-code` needs —
 * from a spawned `moxxy login --stdin-prompts` subprocess to a GUI host that
 * has no TTY (the desktop app).
 *
 * The subprocess emits each `ctx.prompt(question)` call as a NUL-bracketed
 * JSON marker on stdout. NUL never appears in normal terminal output, so the
 * host can scan the byte stream for these markers, render the prompt, and
 * write the user's answer back as one stdin line. Loopback flows that never
 * call `ctx.prompt` (e.g. openai-codex, which captures the code via a local
 * callback server) emit no markers — the host just streams their output and
 * waits for the process to exit.
 *
 * Living here (not in the CLI or the desktop contract) keeps the one wire
 * format in a package both the CLI producer and the desktop consumer already
 * depend on, so the two ends can never drift.
 */

import { z } from 'zod';

/** The byte that brackets a prompt marker. Absent from normal CLI output. */
const NUL = '\u0000';

/** Tag distinguishing a login-prompt marker from any other NUL-bracketed run. */
const PROMPT_TAG = 'moxxy.login.prompt';

/** Tag distinguishing a browser-authorization URL from normal login output. */
const AUTH_URL_TAG = 'moxxy.login.auth_url';

const LoginAuthUrlSchema = z
  .string()
  .max(8192)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.username === '' &&
        url.password === ''
      );
    } catch {
      return false;
    }
  }, 'must be an http(s) URL without embedded credentials');

const LoginAuthUrlMarkerSchema = z
  .object({
    tag: z.literal(AUTH_URL_TAG),
    url: LoginAuthUrlSchema,
  })
  .strict();

export interface LoginPromptRequest {
  /** The question to show the user, verbatim from `ctx.prompt`. */
  readonly question: string;
  /** True for secrets — the host should mask the input field. */
  readonly mask: boolean;
}

/** One decoded item from a login subprocess's stdout stream. */
export type LoginStreamItem =
  | { readonly type: 'output'; readonly text: string }
  | { readonly type: 'prompt'; readonly prompt: LoginPromptRequest }
  | { readonly type: 'auth_url'; readonly url: string };

/**
 * Serialize a prompt request as a NUL-bracketed marker for stdout. The
 * leading NUL also delimits it from any partial preceding `ctx.write` output
 * the host scanner has buffered.
 */
export function encodeLoginPrompt(req: LoginPromptRequest): string {
  return NUL + JSON.stringify({ tag: PROMPT_TAG, question: req.question, mask: req.mask }) + NUL;
}

/**
 * Try to parse a single inter-NUL segment as a prompt marker. Returns null
 * when it isn't one, so the host can pass the segment through as output.
 */
export function decodeLoginPrompt(segment: string): LoginPromptRequest | null {
  if (!segment.startsWith('{')) return null;
  try {
    const o = JSON.parse(segment) as Record<string, unknown>;
    if (o.tag !== PROMPT_TAG || typeof o.question !== 'string') return null;
    return { question: o.question, mask: o.mask === true };
  } catch {
    return null;
  }
}

/**
 * Serialize the browser authorization URL for a GUI host. Validation happens
 * before a marker reaches stdout: a provider-controlled URL may only be a
 * credential-free HTTP(S) URL, never a shell-adjacent custom/file scheme.
 */
export function encodeLoginAuthUrl(url: string): string {
  const marker = LoginAuthUrlMarkerSchema.parse({ tag: AUTH_URL_TAG, url });
  return NUL + JSON.stringify(marker) + NUL;
}

/** Decode and validate one inter-NUL authorization-URL marker. */
export function decodeLoginAuthUrl(segment: string): string | null {
  if (!segment.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(segment);
    const marker = LoginAuthUrlMarkerSchema.safeParse(parsed);
    return marker.success ? marker.data.url : null;
  } catch {
    return null;
  }
}

/**
 * Streaming scanner for a login subprocess's stdout. Feed it chunks; it
 * returns the ordered output / prompt items decoded so far, holding back any
 * incomplete trailing marker (an opening NUL with no closing NUL yet) until
 * the rest of it arrives in a later chunk.
 */
export function createLoginStreamScanner(): {
  push(chunk: string): ReadonlyArray<LoginStreamItem>;
} {
  let buf = '';
  return {
    push(chunk: string): ReadonlyArray<LoginStreamItem> {
      buf += chunk;
      const out: LoginStreamItem[] = [];
      // Consume every COMPLETE marker (NUL <json> NUL), emitting the plain
      // text before each as output. Stop at the first NUL with no closing
      // partner — that's a marker still mid-flight, kept for the next chunk.
      for (;;) {
        const open = buf.indexOf(NUL);
        if (open === -1) break;
        const close = buf.indexOf(NUL, open + 1);
        if (close === -1) break;
        if (open > 0) out.push({ type: 'output', text: buf.slice(0, open) });
        const segment = buf.slice(open + 1, close);
        const prompt = decodeLoginPrompt(segment);
        const authUrl = prompt ? null : decodeLoginAuthUrl(segment);
        // A NUL-bracketed run that isn't a valid marker is anomalous; surface
        // its inner text as output rather than swallowing it.
        out.push(
          prompt
            ? { type: 'prompt', prompt }
            : authUrl !== null
              ? { type: 'auth_url', url: authUrl }
              : { type: 'output', text: segment },
        );
        buf = buf.slice(close + 1);
      }
      // Flush any plain text that precedes a still-incomplete marker (or all
      // of it when no NUL is pending), keeping only the partial marker.
      const pending = buf.indexOf(NUL);
      if (pending === -1) {
        if (buf) out.push({ type: 'output', text: buf });
        buf = '';
      } else if (pending > 0) {
        out.push({ type: 'output', text: buf.slice(0, pending) });
        buf = buf.slice(pending);
      }
      return out;
    },
  };
}
