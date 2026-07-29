import { MarkdownBody } from '../MarkdownBody';
import { ActionRow } from './ActionRow';

export function AssistantBlock({
  text,
  streaming,
  stopReason,
}: {
  readonly text: string;
  readonly streaming: boolean;
  readonly stopReason?: string;
}): JSX.Element {
  return (
    <div data-testid="block-assistant" data-streaming={streaming}>
      <div style={{ minWidth: 0 }}>
        <div style={{ marginTop: 2 }}>
          <MarkdownBody text={text} streaming={streaming} />
        </div>
        {stopReason && stopReason !== 'end_turn' && (
          <div
            className="mono"
            style={{
              marginTop: 6,
              fontSize: 10.5,
              color: 'var(--color-text-dim)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            stop: {stopReason.replace(/_/g, ' ')}
          </div>
        )}
        {!streaming && <ActionRow text={text} />}
      </div>
    </div>
  );
}


