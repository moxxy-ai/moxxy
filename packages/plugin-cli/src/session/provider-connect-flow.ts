import type { ProviderSetupView } from '@moxxy/sdk';

/**
 * Headless state machine behind the inline provider-connect dialog. All
 * transitions are emitted through `onPhase` so the Ink component is a dumb
 * renderer and the semantics stay unit-testable without a terminal.
 *
 * Key-entry semantics mirror the init wizard's collectKey: an explicit
 * provider rejection keeps the user on the input with the error (never
 * persists a known-bad key); a validator-unreachable failure saves the key
 * unvalidated (the network, not the key, may be the problem) and says so.
 */
export type ConnectPhase =
  | { readonly kind: 'installing' }
  | { readonly kind: 'key-entry'; readonly error?: string; readonly validating?: boolean }
  | {
      readonly kind: 'oauth';
      readonly lines: ReadonlyArray<string>;
      readonly prompt: { readonly question: string; readonly mask: boolean } | null;
    }
  | { readonly kind: 'done'; readonly note?: string }
  | { readonly kind: 'failed'; readonly message: string; readonly retryable: boolean };

export interface ConnectFlowDeps {
  readonly setup: ProviderSetupView;
  readonly providerId: string;
  readonly onPhase: (phase: ConnectPhase) => void;
  /** Fired exactly once when the provider is connected (key saved / OAuth done / no-auth). */
  readonly onSuccess: (note?: string) => void;
}

export interface ConnectFlow {
  start(): Promise<void>;
  submitKey(key: string): Promise<void>;
  /** Answer the pending OAuth paste-back prompt (no-op when none pending). */
  answerPrompt(answer: string): void;
  /** Unblocks any pending OAuth prompt with '' (providers treat it as cancel). */
  cancel(): void;
}

export function createConnectFlow(deps: ConnectFlowDeps): ConnectFlow {
  const { setup, providerId, onPhase } = deps;
  let oauthLines: string[] = [];
  let promptWaiter: ((answer: string) => void) | null = null;
  let finished = false;

  const succeed = (note?: string): void => {
    if (finished) return;
    finished = true;
    onPhase({ kind: 'done', ...(note ? { note } : {}) });
    deps.onSuccess(note);
  };

  const runOAuth = async (): Promise<void> => {
    oauthLines = [];
    onPhase({ kind: 'oauth', lines: [], prompt: null });
    try {
      await setup.loginOAuth(providerId, {
        write: (chunk) => {
          // Split multi-line chunks so the dialog renders a clean tail.
          for (const line of chunk.split('\n')) {
            if (line.trim().length > 0) oauthLines = [...oauthLines, line];
          }
          onPhase({ kind: 'oauth', lines: oauthLines, prompt: null });
        },
        prompt: (question, opts) =>
          new Promise<string>((resolve) => {
            promptWaiter = resolve;
            onPhase({
              kind: 'oauth',
              lines: oauthLines,
              prompt: { question, mask: opts?.mask === true },
            });
          }),
      });
      succeed();
    } catch (err) {
      if (finished) return;
      onPhase({
        kind: 'failed',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      });
    }
  };

  return {
    start: async () => {
      const kind = setup.authKind(providerId);
      if (kind === null) {
        onPhase({ kind: 'failed', message: `unknown provider: ${providerId}`, retryable: false });
        return;
      }
      onPhase({ kind: 'installing' });
      let installed: boolean;
      try {
        installed = await setup.ensureInstalled(providerId);
      } catch (err) {
        onPhase({
          kind: 'failed',
          message: `install failed: ${err instanceof Error ? err.message : String(err)}`,
          retryable: true,
        });
        return;
      }
      if (!installed) {
        onPhase({
          kind: 'failed',
          message: `${providerId} did not register after install`,
          retryable: false,
        });
        return;
      }
      if (kind === 'none') {
        // No credentials to collect (e.g. a local model server).
        succeed();
        return;
      }
      if (kind === 'oauth') {
        await runOAuth();
        return;
      }
      onPhase({ kind: 'key-entry' });
    },

    submitKey: async (key) => {
      const trimmed = key.trim();
      if (trimmed.length === 0) {
        onPhase({ kind: 'key-entry', error: 'paste your API key (esc to cancel)' });
        return;
      }
      onPhase({ kind: 'key-entry', validating: true });
      let rejected: string | null = null;
      let unreachable: string | null = null;
      try {
        const result = await setup.testKey(providerId, trimmed);
        if (!result.ok) rejected = result.message;
      } catch (err) {
        unreachable = err instanceof Error ? err.message : String(err);
      }
      if (rejected !== null) {
        // The provider said the key is bad — never persist it.
        onPhase({ kind: 'key-entry', error: `${providerId} rejected the key: ${rejected}` });
        return;
      }
      try {
        await setup.saveKey(providerId, trimmed);
      } catch (err) {
        onPhase({
          kind: 'failed',
          message: `could not store the key: ${err instanceof Error ? err.message : String(err)}`,
          retryable: false,
        });
        return;
      }
      succeed(unreachable ? `saved unvalidated — could not reach the validator (${unreachable})` : undefined);
    },

    answerPrompt: (answer) => {
      const waiter = promptWaiter;
      promptWaiter = null;
      if (waiter) {
        onPhase({ kind: 'oauth', lines: oauthLines, prompt: null });
        waiter(answer);
      }
    },

    cancel: () => {
      finished = true;
      const waiter = promptWaiter;
      promptWaiter = null;
      waiter?.('');
    },
  };
}
