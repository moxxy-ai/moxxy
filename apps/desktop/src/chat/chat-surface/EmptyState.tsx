import { Composer } from '../Composer';
import { composerDraftStore } from '@moxxy/client-core';
import { COLD_START_SUGGESTIONS, STARTER_CARDS } from './suggestions';
import type { ComposerAttachment } from '../composer/useComposerAttachments';

/** Composer props passed straight through from ChatSurface so the empty-state
 *  hosts the SAME composer (just `variant="centered"`). */
export interface EmptyComposerProps {
  readonly ready: boolean;
  readonly sending: boolean;
  readonly compacting: boolean;
  readonly activeTurnId: string | null;
  readonly workspaceId: string;
  readonly onSend: (prompt: string, attachments?: ReadonlyArray<ComposerAttachment>) => void;
  readonly onAbort: () => void;
  readonly onRevealBrowser?: () => void;
}

/**
 * z.ai-style empty state: a vertically-centered column with a serif hero
 * heading, a one-line subtitle, the composer rendered inline-centered, a row of
 * suggestion chips, and a row of starter cards. Chips/cards PREFILL the composer
 * (via composerDraftStore, which the mounted centered composer drains) rather
 * than auto-sending, so the user can edit before sending.
 */
export function EmptyState({
  ready,
  composer,
}: {
  readonly ready: boolean;
  readonly composer: EmptyComposerProps;
}): JSX.Element {
  const prefill = (text: string): void => {
    composerDraftStore.prefill(composer.workspaceId, text);
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 22,
        padding: '32px 24px',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--font-serif)',
            fontWeight: 400,
            fontSize: 44,
            lineHeight: 1.1,
            letterSpacing: '-0.01em',
            color: 'var(--color-text)',
          }}
        >
          {ready ? 'What can I build for you?' : 'Getting your workspace ready…'}
        </h1>
        <p style={{ margin: '10px 0 0', color: 'var(--color-text-muted)', fontSize: 15 }}>
          {ready
            ? 'Ask a question, build a feature, or explore your workspace.'
            : 'Hang tight — this only takes a moment.'}
        </p>
      </div>

      <div style={{ width: '100%', maxWidth: 720 }}>
        <Composer {...composer} variant="centered" />
      </div>

      {ready && (
        <>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              justifyContent: 'center',
              maxWidth: 720,
            }}
          >
            {COLD_START_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className="btn-suggestion"
                onClick={() => prefill(s)}
                style={{
                  padding: '7px 14px',
                  fontSize: 13,
                  color: 'var(--color-text-muted)',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-card-border)',
                  borderRadius: 999,
                }}
              >
                {s}
              </button>
            ))}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              width: '100%',
              maxWidth: 720,
            }}
          >
            {STARTER_CARDS.map((c) => (
              <button
                key={c.title}
                type="button"
                className="row-button"
                onClick={() => prefill(c.prompt)}
                style={{
                  textAlign: 'left',
                  padding: '14px 16px',
                  borderRadius: 14,
                  border: '1px solid var(--color-card-border)',
                  background: 'var(--color-card-bg)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                  {c.title}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--color-text-dim)' }}>{c.subtitle}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
