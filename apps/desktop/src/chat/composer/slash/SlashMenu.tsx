import { Fragment } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import type { SlashOption } from './slash-commands';

interface SlashMenuProps {
  readonly options: ReadonlyArray<SlashOption>;
  readonly active: number;
  readonly onPick: (index: number) => void;
}

/** Keeps the highlighted row in sight as the arrows move through a list that scrolls. */
function keepInView(row: HTMLDivElement | null): void {
  if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
}

/**
 * The slash menu above the composer: the modes, the skills and the actions of
 * the run, each under its name. The textarea keeps the focus and the keys
 * (useSlashMenu); a row is picked on mouse-down so the textarea never blurs.
 */
export function SlashMenu({ options, active, onPick }: SlashMenuProps): JSX.Element {
  return (
    <div role="listbox" aria-label="Modes, skills and actions" className="menu menu--up mention-menu slash-menu">
      {options.map((option, index) => (
        <Fragment key={`${option.section}/${option.name}`}>
          {options[index - 1]?.section !== option.section && (
            <div role="presentation" className="menu__label">
              {option.section}
            </div>
          )}
          <div
            ref={index === active ? keepInView : undefined}
            role="option"
            aria-selected={index === active}
            aria-disabled={option.disabled ? true : undefined}
            className="menu__row mention-menu__row"
            data-active={index === active ? 'true' : undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(index);
            }}
          >
            <span className="mention-menu__label">{option.label}</span>
            <span className="menu__text mention-menu__hint">
              {option.section === 'Skills' ? '@' : '/'}
              {option.name}
              {option.hint ? ` · ${option.hint}` : ''}
            </span>
            {option.active && (
              <span className="menu__mark" aria-label="on">
                <Icon name="check" size={13} />
              </span>
            )}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
