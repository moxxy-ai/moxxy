import type { MouseEvent } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import type { TerminalTabInfo } from '@moxxy/desktop-ipc-contract';
import { AGENT_TAB } from './useTerminalTabs';

/**
 * The terminal pane's tabs, like a browser's: the agent's terminal first (it
 * cannot be closed), then the project's own shells, each with its ×, and + for
 * a new one. A middle click closes a tab too.
 */
export function TerminalTabStrip({
  tabs,
  active,
  onSelect,
  onOpen,
  onClose,
}: {
  readonly tabs: ReadonlyArray<TerminalTabInfo>;
  readonly active: string;
  readonly onSelect: (tabId: string) => void;
  readonly onOpen: () => void;
  readonly onClose: (tabId: string) => void;
}): JSX.Element {
  return (
    <div className="term-tabs">
      <div className="term-tabs__list" role="tablist" aria-label="Terminals">
        <button
          type="button"
          role="tab"
          className="term-tabs__tab"
          aria-selected={active === AGENT_TAB}
          onClick={() => onSelect(AGENT_TAB)}
        >
          Agent
        </button>
        {tabs.map((tab) => (
          <span key={tab.id} className="term-tabs__item" data-active={tab.id === active || undefined}>
            <button
              type="button"
              role="tab"
              className="term-tabs__tab"
              aria-selected={tab.id === active}
              onClick={() => onSelect(tab.id)}
              onAuxClick={(e: MouseEvent) => {
                if (e.button === 1) onClose(tab.id);
              }}
            >
              {tab.title}
            </button>
            <button type="button" className="term-tabs__close" aria-label={`Close ${tab.title}`} onClick={() => onClose(tab.id)}>
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
      </div>
      <button type="button" className="btn-quiet term-tabs__new tip" aria-label="New terminal" data-tip="New terminal" data-tip-side="bottom" onClick={onOpen}>
        <Icon name="plus" size={13} />
      </button>
    </div>
  );
}
