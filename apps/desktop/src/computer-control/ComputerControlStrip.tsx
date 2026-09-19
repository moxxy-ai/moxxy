import type { ComputerPanelView } from './panel-model';
import './computer-control.css';

interface Props {
  view:ComputerPanelView;
  busy:boolean;
  error:string|null;
  onCommand(command:'pause'|'resume'|'stop'):void;
}
export function ComputerControlStrip({view,busy,error,onCommand}:Props):JSX.Element {
  return <section className="computer-control-strip" aria-label="Computer Use controls">
    <span role="status" aria-live="polite">{view.label}</span>
    <div className="computer-control-strip__buttons">
      {view.canPause && <button type="button" aria-label="Pause Computer Use" disabled={busy} onClick={()=>onCommand('pause')}>Pause</button>}
      {view.canResume && <button type="button" aria-label="Resume Computer Use" disabled={busy} onClick={()=>onCommand('resume')}>Resume</button>}
      {view.canStop && <button type="button" aria-label="Stop Computer Use" onClick={()=>onCommand('stop')}>Stop</button>}
    </div>
    {error && <span role="alert" className="computer-control-strip__error">{error}</span>}
  </section>;
}
