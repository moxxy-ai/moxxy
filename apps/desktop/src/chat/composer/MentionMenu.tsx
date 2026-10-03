import type { MentionOption } from '@moxxy/client-core';

interface MentionMenuProps {
  readonly options: ReadonlyArray<MentionOption>;
  readonly active: number;
  readonly onPick: (index: number) => void;
}

/**
 * The @ menu above the composer: tools such as Computer Use or the Moxxy
 * Browser a prompt can call by name. The textarea keeps the focus and the keys
 * (useMentionPicker); a row is picked on mouse-down so the textarea never blurs.
 */
export function MentionMenu({ options, active, onPick }: MentionMenuProps): JSX.Element {
  return (
    <div role="listbox" aria-label="Mention a tool" className="menu menu--up mention-menu">
      <div className="menu__label">Use</div>
      {options.map((option, index) => (
        <div
          key={option.name}
          role="option"
          aria-selected={index === active}
          className="menu__row mention-menu__row"
          data-active={index === active ? 'true' : undefined}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(index);
          }}
        >
          <span className="mention-menu__label">{option.label}</span>
          <span className="menu__text mention-menu__hint">
            @{option.token}
            {option.description ? ` · ${option.description}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
