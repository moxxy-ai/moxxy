import { BlinkingMoxxyMark } from '../components/BlinkingMoxxyMark';

export function WorkingMark(): JSX.Element {
  return (
    <span className="activity-row__icon" aria-hidden="true">
      <BlinkingMoxxyMark size={28} className="moxxy-avatar-loader" />
    </span>
  );
}
