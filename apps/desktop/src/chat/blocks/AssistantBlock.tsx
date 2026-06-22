import { MarkdownBody } from '../MarkdownBody';
import { ActionRow } from './ActionRow';

/**
 * Assistant turn — z.ai renders it as full-width plain prose (no avatar, no
 * "Assistant" label). Streaming is conveyed by the markdown block-cursor and
 * the tail Thinking indicator, not a header. Tool/skill rows keep their avatars.
 */
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
    <div
      data-testid="block-assistant"
      data-streaming={streaming}
      style={{ alignSelf: 'stretch', minWidth: 0 }}
    >
      <MarkdownBody text={text} streaming={streaming} />
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
  );
}
