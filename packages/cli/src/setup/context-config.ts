import type { Session } from '@moxxy/core';
import type { MoxxyConfig } from '@moxxy/config';

/** The session fields a config's `context` block sets. */
export type ContextTarget = Pick<Session, 'elisionSettings' | 'lazyTools' | 'loopGuard' | 'reasoning'>;

/**
 * Carries the `context` block onto a new session. Elision is on by default, so
 * it is only set when the user customized it.
 */
export function applyContextConfig(session: ContextTarget, context: MoxxyConfig['context']): void {
  if (!context) return;
  if (context.elision) session.elisionSettings = context.elision;
  if (context.lazyTools !== undefined) session.lazyTools = context.lazyTools;
  if (context.loopGuard) session.loopGuard = context.loopGuard;
  if (context.reasoning) session.reasoning = context.reasoning;
}
