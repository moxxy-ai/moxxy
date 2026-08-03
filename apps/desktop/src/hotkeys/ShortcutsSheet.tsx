import { Modal } from '@moxxy/desktop-ui';
import { formatChord, parseChord } from './chord';
import { useHotkeyList$ } from './useHotkeys';

/**
 * The keyboard reference, rendered FROM the live registry rather than from a
 * hand-kept list, so it can never drift from what is actually bound.
 */
export function ShortcutsSheet({ onClose }: { readonly onClose: () => void }): JSX.Element {
  const bindings = useHotkeyList$().filter((b) => !b.hidden);
  const isMac = navigator.platform.toLowerCase().includes('mac');
  const groups = new Map<string, typeof bindings>();
  for (const binding of bindings) {
    const list = groups.get(binding.group) ?? [];
    groups.set(binding.group, [...list, binding]);
  }

  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width={520}>
      <div style={{ display: 'grid', gap: 20 }}>
        {[...groups.entries()].map(([group, items]) => (
          <section key={group} style={{ display: 'grid', gap: 6 }}>
            <h3
              style={{
                margin: 0,
                fontSize: 'var(--type-ui-sm)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--color-text-muted)',
              }}
            >
              {group}
            </h3>
            {items.map((binding) => (
              <div
                key={binding.id}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 16,
                  opacity: binding.disabled ? 0.45 : 1,
                }}
              >
                <span style={{ fontSize: 'var(--type-ui)' }}>{binding.label}</span>
                <kbd
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--type-ui-sm)',
                    padding: '2px 7px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-card-border)',
                    background: 'var(--color-card-bg)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatChord(parseChord(binding.chord), isMac)}
                </kbd>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
