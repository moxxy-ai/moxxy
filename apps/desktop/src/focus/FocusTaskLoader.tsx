import { style } from './focus-styles';

/** Static square whose four corners illuminate clockwise to communicate work. */
export function FocusTaskLoader(): JSX.Element {
  return (
    <span className="focus-task-loader" aria-hidden style={style.focusTaskLoader}>
      <i data-corner="top-left" />
      <i data-corner="top-right" />
      <i data-corner="bottom-right" />
      <i data-corner="bottom-left" />
    </span>
  );
}
