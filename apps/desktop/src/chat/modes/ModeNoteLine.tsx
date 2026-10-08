import type { ModeNote } from './mode-events';

/** A step of a mode's run that neither side said: a round starting, a run steering itself. */
export function ModeNoteLine({ note }: { readonly note: ModeNote }): JSX.Element {
  return (
    <div className="mode-note" role="status" data-testid="mode-note" data-tone={note.tone}>
      <span className="mode-note__dot" aria-hidden />
      {note.text}
    </div>
  );
}
