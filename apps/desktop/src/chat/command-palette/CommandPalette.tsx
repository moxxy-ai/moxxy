/**
 * The command palette: every place in the app and every action of the current
 * run, behind one filter field.
 *
 * Places go there at once. An action runs at once too, unless it takes
 * parameters; then every field is shown together in a form, not one step at a
 * time. Results land in the transcript as a dismissible `action_result` block.
 *
 * It opens from the keyboard, so it appears without an animation.
 *
 * This container owns the command fetch, the filter and the run/dispatch; the
 * args form lives in its own module.
 */

import { useEffect, useMemo, useState } from 'react';
import { toErrorMessage } from '@moxxy/client-core';
import { api } from '@moxxy/client-core';
import { chatStore } from '@moxxy/client-core';
import { Icon, Modal, type IconName } from '@moxxy/desktop-ui';
import type { DestinationId } from '../../shell/navigation/destinations';
import { ArgsForm } from './ArgsForm';
import { humanize, quote, stepsForCommand, subcommandForCommand } from './steppers';
import type { ArgStep, CommandInfo } from './types';

/** A place the palette can go to. */
export interface PalettePlace {
  readonly id: DestinationId;
  readonly label: string;
  readonly icon: IconName;
  readonly disabled: boolean;
  /** The shortcut that goes there, already formatted. */
  readonly hint?: string;
}

interface Props {
  readonly workspaceId: string;
  readonly onClose: () => void;
  /** Places to offer above the actions. None when the palette is not in the shell. */
  readonly places?: ReadonlyArray<PalettePlace>;
  readonly onPlace?: (id: DestinationId) => void;
}

type Row =
  | { readonly kind: 'place'; readonly place: PalettePlace }
  | { readonly kind: 'command'; readonly command: CommandInfo };

const NO_PLACES: ReadonlyArray<PalettePlace> = [];

export function CommandPalette({
  workspaceId,
  onClose,
  places = NO_PLACES,
  onPlace,
}: Props): JSX.Element {
  const [commands, setCommands] = useState<ReadonlyArray<CommandInfo>>([]);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const [running, setRunning] = useState(false);
  const [argsFor, setArgsFor] = useState<{
    command: CommandInfo;
    steps: ReadonlyArray<ArgStep>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api()
      .invoke('session.info', { workspaceId })
      .then((info) => {
        if (cancelled) return;
        if (info?.commands) setCommands(info.commands);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const rows = useMemo((): ReadonlyArray<Row> => {
    const q = filter.trim().toLowerCase();
    const matchingPlaces = q ? places.filter((p) => p.label.toLowerCase().includes(q)) : places;
    const matchingCommands = q
      ? commands.filter((c) => {
          if (c.name.toLowerCase().includes(q)) return true;
          if (c.description?.toLowerCase().includes(q)) return true;
          if (c.aliases?.some((a) => a.toLowerCase().includes(q))) return true;
          return false;
        })
      : commands;
    return [
      ...matchingPlaces.map((place): Row => ({ kind: 'place', place })),
      ...matchingCommands.map((command): Row => ({ kind: 'command', command })),
    ];
  }, [places, commands, filter]);

  const run = async (command: CommandInfo, values: ReadonlyArray<string>): Promise<void> => {
    setRunning(true);
    // Some commands dispatch a fixed subcommand parsed from their arg string
    // (e.g. `vault set <key> <value>`); prepend it so the runner's handler
    // routes to the right branch instead of treating the first value as the
    // subcommand ("unknown subcommand").
    const sub = subcommandForCommand(command.name);
    const argString = [...(sub ? [sub] : []), ...values.map(quote)].join(' ');
    try {
      const result = await api().invoke('session.runCommand', {
        workspaceId,
        name: command.name,
        args: argString,
      });
      // Session-action directives are side-effect-only. Wipe the transcript
      // BEFORE dispatching the notice card below, otherwise it would land in
      // the cleared transcript and immediately disappear.
      if (result.kind === 'session-action' && result.action === 'clear') {
        chatStore.clear(workspaceId);
      } else if (result.kind === 'session-action' && result.action === 'new') {
        // `/new`: clear the transcript AND reset the runner to a fresh, empty
        // session — dropping the model's context and the persisted history so
        // it doesn't resurrect on the next launch. Without the runner reset,
        // clearing only the renderer would leave the model still primed with
        // the old conversation (and a restart would replay it back).
        chatStore.clear(workspaceId);
        await api().invoke('session.newSession', { workspaceId });
      }
      // Don't render an action_result block for pure side-effects /
      // noops; the empty header bar that we used to leave in the
      // chat after a noop command was confusing.
      const text =
        result.kind === 'text'
          ? result.text ?? ''
          : result.kind === 'error'
            ? result.message ?? 'command failed'
            : result.kind === 'session-action'
              ? result.notice ?? ''
              : '';
      const isSilent =
        result.kind === 'noop' ||
        (result.kind === 'session-action' && !text.trim() && !result.notice);
      if (!isSilent) {
        const tone =
          result.kind === 'error'
            ? 'error'
            : result.kind === 'session-action'
              ? 'notice'
              : 'info';
        chatStore.dispatch(workspaceId, {
          type: 'action_result',
          commandName: command.name,
          argsLine: argString,
          tone,
          text,
        });
      }
      onClose();
    } catch (e) {
      chatStore.dispatch(workspaceId, {
        type: 'action_result',
        commandName: command.name,
        argsLine: argString,
        tone: 'error',
        text: toErrorMessage(e),
      });
      onClose();
    } finally {
      setRunning(false);
    }
  };

  const onSelect = (row: Row): void => {
    if (row.kind === 'place') {
      if (row.place.disabled) return;
      onPlace?.(row.place.id);
      onClose();
      return;
    }
    const steps = stepsForCommand(row.command.name);
    if (steps.length === 0) {
      void run(row.command, []);
      return;
    }
    setArgsFor({ command: row.command, steps });
  };

  if (argsFor) {
    return (
      <ArgsForm
        command={argsFor.command}
        steps={argsFor.steps}
        running={running}
        onBack={() => setArgsFor(null)}
        onRun={(values) => void run(argsFor.command, values)}
        onCancel={onClose}
      />
    );
  }

  return (
    <Modal title="Command palette" onClose={onClose} width={520}>
      <div className="palette">
        <input
          autoFocus
          // Combobox semantics: the input drives a roving selection in the
          // listbox below; aria-activedescendant tells a screen reader which
          // row is highlighted as the user arrows through.
          role="combobox"
          aria-expanded
          aria-controls="command-palette-list"
          aria-activedescendant={rows.length > 0 ? `command-palette-opt-${active}` : undefined}
          aria-label="Search places and actions"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(rows.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const row = rows[active];
              if (row && !running) onSelect(row);
            }
          }}
          placeholder="Search places and actions…"
          className="palette__input"
        />
        <ul
          id="command-palette-list"
          role="listbox"
          aria-label="Places and actions"
          className="palette__list"
        >
          {rows.length === 0 && <li className="palette__empty">Nothing matches.</li>}
          {rows.map((row, i) => (
            <li key={row.kind === 'place' ? `place-${row.place.id}` : `command-${row.command.name}`}>
              <button
                type="button"
                id={`command-palette-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onClick={() => onSelect(row)}
                onMouseEnter={() => setActive(i)}
                disabled={running || (row.kind === 'place' && row.place.disabled)}
                className="palette__row"
                data-active={i === active}
              >
                {row.kind === 'place' ? (
                  <>
                    <span className="palette__icon" aria-hidden>
                      <Icon name={row.place.icon} size={15} />
                    </span>
                    <span className="palette__name">{row.place.label}</span>
                    <span className="palette__desc" />
                    {row.place.hint && <span className="palette__hint">{row.place.hint}</span>}
                  </>
                ) : (
                  <>
                    <span className="palette__icon" aria-hidden>
                      <Icon name="spark" size={15} />
                    </span>
                    <span className="palette__name">{humanize(row.command.name)}</span>
                    <span className="palette__desc">
                      {row.command.description || 'No description'}
                    </span>
                    {stepsForCommand(row.command.name).length > 0 && (
                      <span className="palette__hint" title="Asks for details before running">
                        …
                      </span>
                    )}
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
        <p className="palette__keys">↑↓ to move · ↵ to choose · Esc to close</p>
      </div>
    </Modal>
  );
}
