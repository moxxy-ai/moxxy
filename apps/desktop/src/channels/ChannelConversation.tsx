import type { UseChannelTranscript } from '@moxxy/client-core';
import { Transcript } from '../chat/Transcript';

/** The bot's conversation, read-only — presentational; state lives in `useChannelTranscript`. */
export function ChannelConversation({
  channelName,
  channelId,
  transcript,
}: {
  readonly channelName: string;
  readonly channelId: string;
  readonly transcript: UseChannelTranscript;
}): JSX.Element {
  return (
    <section data-testid="channel-conversation" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <div className="section-head">conversation</div>
      <p style={{ margin: 0, fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' }}>
        What you and the bot said in {channelName}, updated as it happens. Reply in {channelName} to continue.
      </p>
      {transcript.error && (
        <p role="alert" style={{ margin: 0, fontSize: 'var(--type-meta)', color: 'var(--color-pink)' }}>
          {transcript.error}
        </p>
      )}
      {!transcript.loading && transcript.events.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--type-ui)', color: 'var(--color-text-muted)' }}>
          No conversation yet — message the bot in {channelName}.
        </p>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: 'clamp(320px, 60dvh, 720px)',
            border: '1px solid var(--color-card-border)',
            borderRadius: 'var(--radius-card)',
            overflow: 'hidden',
          }}
        >
          <Transcript
            events={transcript.events}
            extensions={[]}
            streamingText=""
            workspaceId={`channel-${channelId}`}
            hasOlder={transcript.hasOlder}
            onReachedTop={() => void transcript.loadOlder()}
          />
        </div>
      )}
    </section>
  );
}
