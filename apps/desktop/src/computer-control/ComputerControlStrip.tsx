import { Icon } from '@moxxy/desktop-ui';
import type { ComputerPanelCommand, ComputerPanelView } from './panel-model';
import './computer-control.css';

interface Props {
  view:ComputerPanelView;
  busy:boolean;
  error:string|null;
  onCommand(command:ComputerPanelCommand):void;
}
export function ComputerControlStrip({view,busy,error,onCommand}:Props):JSX.Element {
  return <section className="computer-control-strip" aria-label="Computer Use controls">
    <Icon name={view.icon} size={14} aria-hidden="true" />
    <span role="status" aria-live="polite">{view.label}</span>
    {view.target && <span className="computer-control-strip__target">{view.target}</span>}
    <div className="computer-control-strip__buttons">
      {view.canTakeOver && <button type="button" aria-label="Take over from Computer Use" disabled={busy} onClick={()=>onCommand('takeover')}>Take over</button>}
      {view.canResume && <button type="button" aria-label="Resume Computer Use" disabled={busy} onClick={()=>onCommand('resume')}>Resume</button>}
      {view.canStop && <button type="button" aria-label="Stop Computer Use" onClick={()=>onCommand('stop')}>Stop</button>}
    </div>
    {error && <span role="alert" className="computer-control-strip__error">{error}</span>}
  </section>;
}
