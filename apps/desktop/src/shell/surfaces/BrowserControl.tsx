import { Button } from '@moxxy/desktop-ui';
import type { AgentCursorView } from './useAgentCursor';
import type { BrowserControlMode } from './useBrowserControl';

/**
 * The agent's pointer over the page: the same arrowhead, in the same colour, as
 * the Computer Use cursor. Drawn above the view and never in the way of the
 * person's own pointer.
 */
export function AgentCursor({
  cursor,
  onArrived,
}: {
  readonly cursor: AgentCursorView | null;
  readonly onArrived: () => void;
}): JSX.Element | null {
  if (!cursor) return null;
  const marked = cursor.press > 0 && cursor.phase !== 'moving';
  return (
    <span
      data-testid="agent-cursor"
      className="browser__cursor"
      data-phase={cursor.phase}
      aria-hidden="true"
      style={{ left: `${cursor.x}px`, top: `${cursor.y}px`, transitionDuration: `${cursor.durationMs}ms` }}
      onTransitionEnd={onArrived}
    >
      {/* Keyed by the press, so each one rings even at the same place. */}
      {marked && <span key={cursor.press} data-testid="agent-cursor-ring" className="browser__cursor-ring" />}
      <svg viewBox="-2 -2 18 23" width="16" height="20">
        <path d="M0 0 L0.6 19 L5.6 14.2 L13.8 13.6 Z" />
      </svg>
    </span>
  );
}

/** Who has the browser, and the way to change that. */
export function BrowserControlBar({
  mode,
  onTakeOver,
  onResume,
  onStop,
}: {
  readonly mode: BrowserControlMode;
  readonly onTakeOver: () => void;
  readonly onResume: () => void;
  readonly onStop: () => void;
}): JSX.Element | null {
  if (!mode) return null;
  return (
    <section className="browser__control" data-mode={mode} aria-label="Browser control">
      <span role="status" aria-live="polite" className="browser__control-label">
        {mode === 'agent'
          ? 'Moxxy is using the browser. Press on the page or type to take over.'
          : 'You have the browser. Moxxy is waiting until you hand it back.'}
      </span>
      <div className="browser__control-actions">
        {mode === 'agent' ? (
          <Button size="sm" variant="ghost" onClick={onTakeOver}>
            Take over
          </Button>
        ) : (
          <Button size="sm" onClick={onResume}>
            Resume
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onStop}>
          Stop
        </Button>
      </div>
    </section>
  );
}
