import { ATTACHMENT_LIMITS, formatFileSize } from '@moxxy/desktop-ipc-contract';
import { Icon } from '@moxxy/desktop-ui';

/**
 * Drawn over the chat while files are held over it: the column says it will
 * take them, and how large they may be, before they are let go. It takes no
 * pointer, so the drag still lands on the chat underneath.
 */
export function DropVeil(): JSX.Element {
  return (
    <div className="drop-veil" aria-hidden="true">
      <div className="drop-veil__card">
        <Icon name="attach" size={20} />
        <strong>Drop files to attach</strong>
        <small>
          Images up to {formatFileSize(ATTACHMENT_LIMITS.imageBytes)}, other files up to{' '}
          {formatFileSize(ATTACHMENT_LIMITS.fileBytes)}
        </small>
      </div>
    </div>
  );
}
