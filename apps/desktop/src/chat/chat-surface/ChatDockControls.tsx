import { Icon } from '@moxxy/desktop-ui';
import { MoxxyMark } from '@/components/MoxxyMark';

/** The corner button that tucks the floating composer away. */
export function ChatHideButton({ onHide }: { readonly onHide: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="tip chat-dock__hide"
      aria-label="Hide the chat"
      data-tip="Hide the chat"
      data-tip-side="left"
      onClick={onHide}
    >
      <Icon name="chevron-down" size={13} />
    </button>
  );
}

/** The moxxy button the tucked-away composer waits in; it pulses while the agent works. */
export function ChatLauncher({
  busy,
  onShow,
}: {
  readonly busy: boolean;
  readonly onShow: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={busy ? 'tip chat-launcher is-busy' : 'tip chat-launcher'}
      aria-label="Show the chat"
      data-tip="Show the chat"
      data-tip-side="left"
      onClick={onShow}
    >
      <MoxxyMark size={26} />
    </button>
  );
}
